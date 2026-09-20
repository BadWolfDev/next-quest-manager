import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { resolveApiToken, TOKEN_PREFIX } from "@/lib/api-tokens";
import type { Actor } from "@/lib/authorize";
import { resolveOauthAccessToken } from "@/lib/core/oauth";
import { ACCESS_TOKEN_PREFIX, SCOPE_READ, SCOPE_WRITE } from "@/lib/oauth";
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

/**
 * Resolve a bearer token to an acting user.
 *
 * Two token families reach this endpoint and they are told apart by prefix, not
 * by trying one lookup and falling through to the other:
 *
 *  - `nqm_` — a personal access token, pasted by a human into a headless client.
 *  - `nqo_` — an OAuth access token, issued by this instance's own
 *    authorization server after a browser consent flow.
 *
 * Both collapse to the same `McpTokenExtra`, so nothing downstream — not the
 * tools, not `lib/authorize.ts`, not `board-ops` — has any idea which one was
 * used. That is the point: adding OAuth added a front door, not a code path.
 */
async function resolveBearer(
  bearerToken: string,
): Promise<{ extra: McpTokenExtra; scopes: string[]; rateKey: string } | null> {
  if (bearerToken.startsWith(TOKEN_PREFIX)) {
    const resolved = await resolveApiToken(bearerToken);
    if (!resolved) return null;
    return authenticated(
      resolved,
      resolved.readOnly ? [SCOPE_READ] : [SCOPE_READ, SCOPE_WRITE],
    );
  }

  if (bearerToken.startsWith(ACCESS_TOKEN_PREFIX)) {
    const resolved = await resolveOauthAccessToken(bearerToken);
    if (!resolved) return null;
    // `readOnly` is derived from the absence of `nqm:write`, so a grant that
    // never asked for write is refused by `mutating()` exactly as a read-only
    // personal access token is.
    return authenticated(resolved, resolved.scope.split(/\s+/).filter(Boolean));
  }

  return null;
}

/**
 * The one shape both token families collapse to. Written once so the two
 * branches above cannot drift — an OAuth grant that carried, say, a different
 * `readOnly` rule would be a second authorization path, which is the thing this
 * endpoint exists not to have.
 */
function authenticated(
  resolved: { actor: Actor; tokenId: string; readOnly: boolean },
  scopes: string[],
): { extra: McpTokenExtra; scopes: string[]; rateKey: string } {
  return {
    rateKey: `mcp:${resolved.tokenId}`,
    scopes,
    extra: {
      userId: resolved.actor.id,
      email: resolved.actor.email,
      name: resolved.actor.name,
      image: resolved.actor.image,
      role: resolved.actor.role,
      tokenId: resolved.tokenId,
      readOnly: resolved.readOnly,
    },
  };
}

const authed = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined;

    const resolved = await resolveBearer(bearerToken);
    // Unknown, revoked, expired, or orphaned — all indistinguishable to the
    // caller, which gets a plain 401 carrying the resource metadata pointer.
    if (!resolved) return undefined;

    // Generous ceiling: an agent walking a board legitimately makes many calls.
    // Keyed on the token, so one noisy agent cannot throttle another. Uses the
    // same Postgres limiter as sign-in, and fails closed.
    const limited = await rateLimit({
      key: resolved.rateKey,
      limit: 300,
      windowSeconds: 60,
    });
    if (!limited.ok) return undefined;

    return {
      token: bearerToken,
      clientId: resolved.extra.tokenId,
      scopes: resolved.scopes,
      extra: resolved.extra as unknown as Record<string, unknown>,
    };
  },
  {
    required: true,
    // Makes the 401 carry
    // `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`,
    // which is how an MCP client discovers that this instance *is* its own
    // authorization server and starts the consent flow unprompted.
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  },
);

export { authed as GET, authed as POST, authed as DELETE };
