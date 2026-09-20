import { z } from "zod";

import { registerClient } from "@/lib/core/oauth";
import { logError } from "@/lib/log-error";
import {
  DEFAULT_SCOPE,
  SUPPORTED_AUTH_METHODS,
  SUPPORTED_GRANT_TYPES,
  isAllowedRedirectUri,
  isHttpsInfoUri,
  parseScope,
  formatScope,
  type TokenEndpointAuthMethod,
} from "@/lib/oauth";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * RFC 7591 dynamic client registration.
 *
 * Open and unauthenticated, because that is the only way a hosted client such
 * as Claude.ai can introduce itself to a self-hosted instance it has never seen.
 * A registration grants *nothing*: the row it creates is a name and a redirect
 * allowlist, and access only ever comes from a signed-in human approving the
 * consent screen. The two things that matter are therefore (a) the redirect
 * allowlist is validated here and exact-matched later, and (b) the endpoint is
 * throttled so it cannot be used to fill the table.
 *
 * Throttling is per client IP through the same Postgres limiter as sign-in,
 * and like every other use of it, it fails closed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTER_RATE_LIMIT = { limit: 20, windowSeconds: 60 * 60 } as const;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

/**
 * RFC 7591 §2 says a server must ignore metadata it does not understand, so
 * unknown fields are dropped silently rather than rejected. Values we *do*
 * understand but cannot honour are `invalid_client_metadata`.
 */
const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z
    .array(z.string().trim().min(1).max(2048))
    .min(1, "At least one redirect URI is required.")
    .max(10, "Register at most 10 redirect URIs."),
  grant_types: z.array(z.string()).max(10).optional(),
  response_types: z.array(z.string()).max(10).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().max(200).optional(),
  client_uri: z.string().trim().max(2048).optional(),
  logo_uri: z.string().trim().max(2048).optional(),
});

function invalid(description: string, error = "invalid_client_metadata") {
  return Response.json(
    { error, error_description: description },
    { status: 400, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const ip = clientIpFromHeaders(request.headers);
  const limited = await rateLimit({
    key: `oauth:register:${ip}`,
    ...REGISTER_RATE_LIMIT,
  });
  if (!limited.ok) {
    return Response.json(
      {
        error: "temporarily_unavailable",
        error_description: "Too many registration attempts. Try again later.",
      },
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store",
          "Retry-After": String(limited.retryAfter),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("Request body must be JSON.");
  }

  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return invalid(
      parsed.error.issues[0]?.message ?? "Invalid client metadata.",
    );
  }
  const input = parsed.data;

  for (const uri of input.redirect_uris) {
    if (!isAllowedRedirectUri(uri)) {
      return invalid(
        `redirect_uri "${uri}" is not allowed. Use https, http on loopback, ` +
          "or a private-use scheme such as cursor:// — and no URL fragment.",
        "invalid_redirect_uri",
      );
    }
  }

  const grantTypes = input.grant_types ?? [...SUPPORTED_GRANT_TYPES];
  for (const grant of grantTypes) {
    if (!(SUPPORTED_GRANT_TYPES as readonly string[]).includes(grant)) {
      return invalid(`Unsupported grant_type "${grant}".`);
    }
  }
  if (!grantTypes.includes("authorization_code")) {
    return invalid("grant_types must include authorization_code.");
  }

  const responseTypes = input.response_types ?? ["code"];
  if (responseTypes.some((type) => type !== "code")) {
    return invalid(
      "Only the authorization code flow is supported (response_types: [\"code\"]).",
      "invalid_client_metadata",
    );
  }

  const authMethod = input.token_endpoint_auth_method ?? "none";
  if (!(SUPPORTED_AUTH_METHODS as readonly string[]).includes(authMethod)) {
    return invalid(
      `Unsupported token_endpoint_auth_method "${authMethod}".`,
    );
  }

  const scopes = input.scope ? parseScope(input.scope) : null;
  if (input.scope && !scopes) {
    return invalid(
      `scope may only contain the supported scopes (${DEFAULT_SCOPE}).`,
      "invalid_client_metadata",
    );
  }

  if (input.client_uri && !isHttpsInfoUri(input.client_uri)) {
    return invalid("client_uri must be an https URL.");
  }
  // Stored for display only — never fetched. Rendering a remote image the
  // client chose is already a tracking pixel; fetching it server-side would
  // additionally make this endpoint an SSRF probe.
  if (input.logo_uri && !isHttpsInfoUri(input.logo_uri)) {
    return invalid("logo_uri must be an https URL.");
  }

  try {
    const { client, clientSecret } = await registerClient({
      name: input.client_name ?? "Unnamed MCP client",
      clientUri: input.client_uri ?? null,
      logoUri: input.logo_uri ?? null,
      redirectUris: input.redirect_uris,
      grantTypes,
      tokenEndpointAuthMethod: authMethod as TokenEndpointAuthMethod,
      scope: scopes ? formatScope(scopes) : DEFAULT_SCOPE,
    });

    return Response.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        ...(clientSecret
          ? {
              client_secret: clientSecret,
              // 0 means "does not expire" (RFC 7591 §3.2.1).
              client_secret_expires_at: 0,
            }
          : {}),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        response_types: ["code"],
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        scope: client.scope,
        ...(client.clientUri ? { client_uri: client.clientUri } : {}),
        ...(client.logoUri ? { logo_uri: client.logoUri } : {}),
      },
      {
        status: 201,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      },
    );
  } catch (error) {
    logError("[oauth/register]", error);
    return Response.json(
      { error: "server_error" },
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
      },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
