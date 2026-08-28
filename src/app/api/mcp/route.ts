import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { resolveApiToken } from "@/lib/api-tokens";
import { rateLimit } from "@/lib/rate-limit";
import {
  registerTools,
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  SERVER_VERSION,
  type McpTokenExtra,
} from "@/mcp/server";

/**
 * Streamable HTTP MCP endpoint.
 *
 * Stateless by construction: `createMcpHandler` builds a fresh server per
 * request and this route stores nothing between calls, so it runs on a Vercel
 * free-tier function or a single self-hosted Node process with no Redis and no
 * session store. Node runtime because the tools reach Postgres.
 *
 * The acting user is *not* held anywhere at module scope. `withMcpAuth`
 * verifies the bearer token and sets `req.auth`; mcp-handler forwards that to
 * the SDK as the request's `authInfo`, and each tool handler reads it from its
 * own per-call context. Two concurrent requests can never see each other's
 * identity because there is no shared slot to race over.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(registerTools, {
  serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  instructions: SERVER_INSTRUCTIONS,
  // No SSE subscriptions: nothing to resume, nothing to store, no Redis.
  maxSubscriptions: 0,
});

const authed = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined;

    const resolved = await resolveApiToken(bearerToken);
    // Unknown, revoked, expired, or orphaned — all indistinguishable to the
    // caller, which gets a plain 401.
    if (!resolved) return undefined;

    // Generous ceiling: an agent walking a board legitimately makes many calls.
    // Keyed on the token, so one noisy agent cannot throttle another. Uses the
    // same Postgres limiter as sign-in, and fails closed.
    const limited = await rateLimit({
      key: `mcp:${resolved.tokenId}`,
      limit: 300,
      windowSeconds: 60,
    });
    if (!limited.ok) return undefined;

    const extra: McpTokenExtra = {
      userId: resolved.actor.id,
      email: resolved.actor.email,
      name: resolved.actor.name,
      image: resolved.actor.image,
      role: resolved.actor.role,
      tokenId: resolved.tokenId,
      readOnly: resolved.readOnly,
    };

    return {
      token: bearerToken,
      clientId: resolved.tokenId,
      scopes: resolved.readOnly ? ["nqm:read"] : ["nqm:read", "nqm:write"],
      extra: extra as unknown as Record<string, unknown>,
    };
  },
  { required: true },
);

export { authed as GET, authed as POST, authed as DELETE };
