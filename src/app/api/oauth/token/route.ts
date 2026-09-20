import {
  authenticateClient,
  exchangeAuthorizationCode,
  rotateRefreshToken,
  touchClient,
  type GrantResult,
} from "@/lib/core/oauth";
import { logError } from "@/lib/log-error";
import {
  isValidClientId,
  parseBasicAuth,
  publicOriginFromHeaders,
  resourceIdentifier,
} from "@/lib/oauth";
import { boundedKeyPart, clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * RFC 6749 §3.2 token endpoint — authorization code and refresh token grants.
 *
 * Two defences carry most of the weight here and both are detection rather
 * than mere refusal:
 *
 *  - An authorization code is claimed with a conditional UPDATE, so it is
 *    single-use even under a race. Presenting a spent code revokes every token
 *    it produced (RFC 6749 §4.1.2), because a code being redeemed twice means
 *    somebody other than the client has a copy.
 *  - Refresh tokens rotate. Presenting a rotated one destroys the whole family,
 *    so a stolen refresh token buys at most one window before both parties are
 *    locked out and the theft is visible.
 *
 * PKCE is required with S256 and there is no `plain` branch anywhere.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RATE_LIMIT = { limit: 60, windowSeconds: 5 * 60 } as const;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

const NO_STORE = {
  ...CORS_HEADERS,
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

/** RFC 6749 §5.2 error response. */
function oauthError(
  error: string,
  description: string,
  status = 400,
  extraHeaders: Record<string, string> = {},
) {
  return Response.json(
    { error, error_description: description },
    { status, headers: { ...NO_STORE, ...extraHeaders } },
  );
}

/** 401 for a failed *client authentication*, with the challenge RFC 6749 asks for. */
function invalidClient(description: string) {
  return oauthError("invalid_client", description, 401, {
    "WWW-Authenticate": 'Basic realm="oauth", charset="UTF-8"',
  });
}

/**
 * The spec says form-encoded. Some clients send JSON anyway, and answering
 * them with a parse error rather than a token helps nobody, so both are
 * accepted and normalised to the same map.
 */
async function readParams(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }

  const form = await request.formData();
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export async function POST(request: Request) {
  let params: Record<string, string>;
  try {
    params = await readParams(request);
  } catch {
    return oauthError("invalid_request", "Could not parse the request body.");
  }

  // Credentials may arrive in the body or as HTTP Basic. Basic wins, because a
  // client that sent both and disagrees with itself is not one to guess for.
  const basic = parseBasicAuth(request.headers.get("authorization"));
  const clientId = basic?.clientId ?? params.client_id ?? null;
  const clientSecret = basic?.clientSecret ?? params.client_secret ?? null;

  // Shape-checked before anything else touches it. `client_id` arrives from an
  // unauthenticated caller and would otherwise become part of a rate-limit key
  // and an indexed lookup at whatever length that caller chose; anything that
  // is not `nqc_` + 43 base64url characters cannot be a client we issued, so
  // the answer is the same 401 without a single row read.
  if (!isValidClientId(clientId)) {
    return invalidClient("client_id is missing or malformed.");
  }

  // Keyed on client *and* IP: one noisy client cannot throttle another, and one
  // host cannot grind through codes for many clients. Both halves go through
  // `boundedKeyPart` — the IP comes from a proxy header and is no more trusted
  // than the body. Fails closed.
  const ip = clientIpFromHeaders(request.headers);
  const limited = await rateLimit({
    key: `oauth:token:${boundedKeyPart(clientId)}:${boundedKeyPart(ip)}`,
    ...TOKEN_RATE_LIMIT,
  });
  if (!limited.ok) {
    return oauthError(
      "temporarily_unavailable",
      "Too many token requests. Try again shortly.",
      429,
      { "Retry-After": String(limited.retryAfter) },
    );
  }

  const auth = await authenticateClient({ clientId, clientSecret });
  if (!auth.ok) {
    return invalidClient("Client authentication failed.");
  }
  const client = auth.client;

  try {
    switch (params.grant_type) {
      case "authorization_code":
        return await authorizationCodeGrant(request, params, client);
      case "refresh_token":
        return await refreshTokenGrant(params, client);
      case undefined:
        return oauthError("invalid_request", "grant_type is required.");
      default:
        return oauthError(
          "unsupported_grant_type",
          `grant_type "${params.grant_type}" is not supported.`,
        );
    }
  } catch (error) {
    logError("[oauth/token]", error);
    return oauthError("server_error", "Something went wrong.", 500);
  }
}

async function authorizationCodeGrant(
  request: Request,
  params: Record<string, string>,
  client: { id: string; grantTypes: string[] },
) {
  const code = params.code;
  const redirectUri = params.redirect_uri;
  const codeVerifier = params.code_verifier;

  if (!code) return oauthError("invalid_request", "code is required.");
  if (!redirectUri) {
    return oauthError("invalid_request", "redirect_uri is required.");
  }
  if (!codeVerifier) {
    return oauthError("invalid_request", "code_verifier is required (PKCE).");
  }

  // Claim, validate and issue happen together inside one transaction in
  // `lib/core/oauth.ts`. Nothing here may sit between the two halves.
  const result = await exchangeAuthorizationCode({
    rawCode: code,
    clientId: client.id,
    grantTypes: client.grantTypes,
    redirectUri,
    codeVerifier,
    requestedResource: params.resource ?? null,
    expectedResource: resourceIdentifier(
      publicOriginFromHeaders(request.headers),
    ),
  });

  return grantResponse(result, client.id);
}

async function refreshTokenGrant(
  params: Record<string, string>,
  client: { id: string; grantTypes: string[] },
) {
  const refreshToken = params.refresh_token;
  if (!refreshToken) {
    return oauthError("invalid_request", "refresh_token is required.");
  }

  const result = await rotateRefreshToken({
    rawToken: refreshToken,
    clientId: client.id,
    grantTypes: client.grantTypes,
    requestedScope: params.scope ?? null,
  });

  return grantResponse(result, client.id);
}

async function grantResponse(result: GrantResult, clientId: string) {
  if (result.status !== "ok") {
    return oauthError(result.error, result.description);
  }

  await touchClient(clientId);
  return tokenResponse(result.tokens);
}

function tokenResponse(issued: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}) {
  return Response.json(
    {
      access_token: issued.accessToken,
      token_type: "Bearer",
      expires_in: issued.expiresIn,
      refresh_token: issued.refreshToken,
      scope: issued.scope,
    },
    { headers: NO_STORE },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
