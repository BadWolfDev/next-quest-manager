import { authenticateClient, revokeRawToken } from "@/lib/core/oauth";
import { logError } from "@/lib/log-error";
import { isValidClientId, parseBasicAuth } from "@/lib/oauth";
import { boundedKeyPart, clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * RFC 7009 token revocation.
 *
 * Always answers 200 for an authenticated client, whether or not the token
 * existed: §2.2 requires it, and the alternative turns this endpoint into an
 * oracle for whether a given string is a live token. Revoking a refresh token
 * takes its whole family with it — a client asking to disconnect means the
 * session, not one string.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVOKE_RATE_LIMIT = { limit: 60, windowSeconds: 5 * 60 } as const;

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

export async function POST(request: Request) {
  let params: Record<string, string> = {};
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      for (const [key, value] of Object.entries(body ?? {})) {
        if (typeof value === "string") params[key] = value;
      }
    } else {
      const form = await request.formData();
      params = Object.fromEntries(
        [...form.entries()].filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "Malformed body." },
      { status: 400, headers: NO_STORE },
    );
  }

  const basic = parseBasicAuth(request.headers.get("authorization"));
  const clientId = basic?.clientId ?? params.client_id ?? null;
  const clientSecret = basic?.clientSecret ?? params.client_secret ?? null;

  // Shape-checked before any database work or any rate-limit write: an
  // unauthenticated caller must not get to choose the length of a key we store.
  if (!isValidClientId(clientId)) {
    return Response.json(
      {
        error: "invalid_client",
        error_description: "client_id is missing or malformed.",
      },
      {
        status: 401,
        headers: {
          ...NO_STORE,
          "WWW-Authenticate": 'Basic realm="oauth", charset="UTF-8"',
        },
      },
    );
  }

  const ip = clientIpFromHeaders(request.headers);
  const limited = await rateLimit({
    key: `oauth:revoke:${boundedKeyPart(clientId)}:${boundedKeyPart(ip)}`,
    ...REVOKE_RATE_LIMIT,
  });
  if (!limited.ok) {
    return Response.json(
      { error: "temporarily_unavailable" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(limited.retryAfter) },
      },
    );
  }

  const auth = await authenticateClient({ clientId, clientSecret });
  if (!auth.ok) {
    return Response.json(
      {
        error: "invalid_client",
        error_description: "Client authentication failed.",
      },
      {
        status: 401,
        headers: {
          ...NO_STORE,
          "WWW-Authenticate": 'Basic realm="oauth", charset="UTF-8"',
        },
      },
    );
  }

  const token = params.token;
  if (token) {
    try {
      // `token_type_hint` is accepted and ignored: the prefix already says what
      // the token is, and honouring a wrong hint would mean failing to revoke.
      await revokeRawToken(token, auth.client.id);
    } catch (error) {
      logError("[oauth/revoke]", error);
      // Still a 200 — see the note at the top of the file.
    }
  }

  return new Response(null, { status: 200, headers: NO_STORE });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
