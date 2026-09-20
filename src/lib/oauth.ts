import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth 2.1 primitives — the half that needs no database.
 *
 * Next Quest Manager is its own authorization server. Everything an MCP client
 * needs to connect over the browser consent flow lives in this repo and in
 * Postgres: no Auth0, no Clerk, no second required service. That is the same
 * constraint that produced the `rate_limits` table instead of Redis.
 *
 * This module deliberately imports **nothing from `@/db`** so the PKCE, scope,
 * redirect-URI and metadata logic can be unit-tested without a Postgres
 * connection. The stateful half lives in `lib/core/oauth.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Scopes                                                                     */
/* -------------------------------------------------------------------------- */

export const SCOPE_READ = "nqm:read";
export const SCOPE_WRITE = "nqm:write";

/** Every scope this server will ever issue, in canonical order. */
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;
export type Scope = (typeof SUPPORTED_SCOPES)[number];

/** What a client gets when it asks for nothing in particular. */
export const DEFAULT_SCOPE = `${SCOPE_READ} ${SCOPE_WRITE}`;

/**
 * Human sentences for the consent screen. A scope string is a developer
 * artefact; the person clicking Approve is entitled to a sentence.
 */
export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  [SCOPE_READ]:
    "Read your boards, lists, cards, comments and labels — everything you can already see.",
  [SCOPE_WRITE]:
    "Create and edit boards, lists and cards, move them, comment, and archive or restore them.",
};

/**
 * Parse a space-separated scope string into a canonical, de-duplicated,
 * ordered list. Returns null if any token is not a scope we support — an
 * unknown scope is `invalid_scope`, never something to silently drop.
 */
export function parseScope(value: string | null | undefined): Scope[] | null {
  if (value === null || value === undefined) return null;
  const requested = value.split(/\s+/).filter(Boolean);
  if (requested.length === 0) return null;

  const seen = new Set<string>();
  for (const token of requested) {
    if (!(SUPPORTED_SCOPES as readonly string[]).includes(token)) return null;
    seen.add(token);
  }
  return SUPPORTED_SCOPES.filter((scope) => seen.has(scope));
}

/** Canonical scope string, or the default when nothing was asked for. */
export function formatScope(scopes: readonly Scope[]): string {
  return SUPPORTED_SCOPES.filter((scope) => scopes.includes(scope)).join(" ");
}

/** Does `granted` cover everything in `requested`? */
export function scopeCovers(
  granted: readonly Scope[],
  requested: readonly Scope[],
): boolean {
  return requested.every((scope) => granted.includes(scope));
}

/**
 * Narrow a grant on refresh. RFC 6749 §6: a refresh may request a *subset* of
 * the original scope and never more. Returns null when the request widens.
 */
export function narrowScope(
  granted: readonly Scope[],
  requested: string | null | undefined,
): Scope[] | null {
  if (!requested) return [...granted];
  const parsed = parseScope(requested);
  if (!parsed) return null;
  return scopeCovers(granted, parsed) ? parsed : null;
}

/** Read-only is the absence of write, so a new scope fails closed. */
export function isReadOnlyScope(scope: string): boolean {
  return !scope.split(/\s+/).includes(SCOPE_WRITE);
}

/* -------------------------------------------------------------------------- */
/* Token material                                                             */
/* -------------------------------------------------------------------------- */

/** `nqm_` is the personal access token; these four must never collide with it. */
export const CLIENT_ID_PREFIX = "nqc_";
export const CLIENT_SECRET_PREFIX = "nqs_";
export const AUTHORIZATION_CODE_PREFIX = "nqa_";
export const ACCESS_TOKEN_PREFIX = "nqo_";
export const REFRESH_TOKEN_PREFIX = "nqr_";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60; // 10 minutes

/**
 * 32 bytes of CSPRNG entropy behind a family prefix.
 *
 * Same reasoning as `lib/api-tokens.ts`: a 256-bit random secret has nothing to
 * brute-force, so it is stored as a plain SHA-256 digest under a unique index
 * rather than argon2 — verification must be one indexed lookup, not ~20ms of
 * key derivation on every MCP call.
 */
export function generateSecret(prefix: string): { raw: string; hash: string } {
  const raw = prefix + randomBytes(32).toString("base64url");
  return { raw, hash: hashSecret(raw) };
}

/**
 * Does this string even have the shape of a `client_id` we could have issued?
 *
 * `registerClient` mints `nqc_` + `randomBytes(32).toString("base64url")`, and
 * base64url of 32 bytes is always exactly 43 characters. Checking that before
 * any database work keeps an unbounded, attacker-chosen string out of a rate
 * limit key and out of an indexed lookup — the answer for anything else is
 * `invalid_client` regardless, so there is nothing to learn from the shortcut.
 */
const CLIENT_ID_RE = new RegExp(`^${CLIENT_ID_PREFIX}[A-Za-z0-9_-]{43}$`);

export function isValidClientId(value: string | null | undefined): boolean {
  return typeof value === "string" && CLIENT_ID_RE.test(value);
}

export function hashSecret(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests of equal length. */
export function secretMatches(rawCandidate: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashSecret(rawCandidate), "hex");
  const expected = Buffer.from(storedHash, "hex");
  if (candidate.length !== expected.length || expected.length === 0) {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

/* -------------------------------------------------------------------------- */
/* PKCE (RFC 7636)                                                            */
/* -------------------------------------------------------------------------- */

export const CODE_CHALLENGE_METHOD = "S256";

/** RFC 7636 §4.1: 43–128 characters of unreserved ASCII. */
const CODE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
/** base64url of a SHA-256 digest is always exactly 43 characters. */
const CODE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43,128}$/;

export function isValidCodeVerifier(value: string): boolean {
  return CODE_VERIFIER_RE.test(value);
}

export function isValidCodeChallenge(value: string): boolean {
  return CODE_CHALLENGE_RE.test(value);
}

/**
 * Verify a PKCE code verifier against the challenge bound to the code.
 *
 * S256 only — `plain` is refused everywhere in this server, because a `plain`
 * challenge is the verifier, so an attacker who can see the authorization
 * request can complete the exchange. OAuth 2.1 requires S256 for public
 * clients and we apply it to confidential ones too.
 */
export function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  if (!isValidCodeVerifier(codeVerifier)) return false;
  if (!isValidCodeChallenge(codeChallenge)) return false;

  const computed = createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(codeChallenge, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* -------------------------------------------------------------------------- */
/* Redirect URIs                                                              */
/* -------------------------------------------------------------------------- */

/** Schemes that would turn a redirect into code execution in the browser. */
const FORBIDDEN_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Is this an acceptable redirect URI to *register*?
 *
 * - `https://…` anywhere,
 * - `http://…` only on loopback (RFC 8252 §7.3 native apps, and local dev),
 * - a private scheme such as `cursor://` or `vscode://` for native clients.
 *
 * Fragments are rejected outright (RFC 6749 §3.1.2): the authorization
 * response is appended to the query, and a pre-existing fragment makes the
 * result ambiguous.
 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.hash) return false;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;

  if (url.protocol === "https:") return url.hostname.length > 0;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);

  // Private-use scheme (RFC 8252 §7.1): `com.example.app:/cb`, `cursor://…`.
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/**
 * Exact string match against the registered list.
 *
 * Deliberately *not* RFC 8252 §7.3 loopback-port relaxation: allowing an
 * arbitrary port on a registered `http://127.0.0.1` redirect means any local
 * process can receive a code meant for another. Native clients that need a
 * dynamic port can register several, or re-register — registration is free.
 */
export function matchRedirectUri(
  registered: readonly string[],
  candidate: string | null | undefined,
): string | null {
  if (!candidate) return null;
  return registered.includes(candidate) ? candidate : null;
}

/** Build the error redirect an authorization failure must go back on. */
export function errorRedirect(
  redirectUri: string,
  error: string,
  state: string | null,
  description?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state !== null) url.searchParams.set("state", state);
  return url.toString();
}

/** Build the success redirect carrying the authorization code. */
export function successRedirect(
  redirectUri: string,
  code: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state !== null) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Can the browser actually navigate here with an HTTP redirect?
 *
 * Private-use schemes cannot be a `Location:` target, so GET-stage errors for
 * those clients are rendered rather than redirected.
 */
export function isHttpRedirect(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Public origin                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The origin this instance is reachable at, derived from the request — and
 * from nothing else.
 *
 * No new environment variable: the deployment promise is `DATABASE_URL` and
 * `AUTH_SECRET` and nothing else, and an operator who has to set a third one to
 * make OAuth work will discover that on the first broken redirect.
 *
 * `NEXT_PUBLIC_APP_URL` / `AUTH_URL` are deliberately *not* consulted. A build
 * carries one value of them while the same build answers on many origins — a
 * Vercel preview URL, a custom domain, `localhost` — and an origin that
 * disagrees with the host the client actually reached breaks discovery and the
 * RFC 8707 `resource` check, which compares against `resourceIdentifier(origin)`.
 * The host the request arrived on is the only thing that is true per request.
 */
export function publicOriginFromHeaders(headers: Headers): string {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host") || "localhost:3000";
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${proto}://${host}`;
}

/* -------------------------------------------------------------------------- */
/* Discovery documents                                                        */
/* -------------------------------------------------------------------------- */

/** The one protected resource this authorization server issues tokens for. */
export function resourceIdentifier(origin: string): string {
  return `${origin}/api/mcp`;
}

/** RFC 9728 protected resource metadata. */
export function buildProtectedResourceMetadata(origin: string) {
  return {
    resource: resourceIdentifier(origin),
    authorization_servers: [origin],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/settings/tokens`,
  } as const;
}

/** RFC 8414 authorization server metadata. */
export function buildAuthorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: [CODE_CHALLENGE_METHOD],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    revocation_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    scopes_supported: [...SUPPORTED_SCOPES],
    // Advertised because `resource` really is validated against
    // `resourceIdentifier(origin)` at both the authorize and token endpoints.
    resource_indicators_supported: true,
    service_documentation:
      "https://github.com/BadWolfDev/next-quest-manager#readme",
  } as const;
}

/* -------------------------------------------------------------------------- */
/* Client metadata validation (RFC 7591)                                      */
/* -------------------------------------------------------------------------- */

export const SUPPORTED_GRANT_TYPES = [
  "authorization_code",
  "refresh_token",
] as const;

export const SUPPORTED_AUTH_METHODS = [
  "none",
  "client_secret_post",
  "client_secret_basic",
] as const;

export type TokenEndpointAuthMethod = (typeof SUPPORTED_AUTH_METHODS)[number];

/** A client that authenticates is confidential and gets a secret. */
export function isConfidential(method: string): boolean {
  return method === "client_secret_post" || method === "client_secret_basic";
}

/** `https://…` only, no fragment — for `client_uri` and `logo_uri`. */
export function isHttpsInfoUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0 && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Decode `Authorization: Basic base64(client_id:client_secret)`.
 *
 * RFC 6749 §2.3.1 form-encodes both halves before joining them, which matters
 * for a `client_id` that could contain a `:` — ours cannot, but decoding
 * correctly costs nothing.
 */
export function parseBasicAuth(
  header: string | null,
): { clientId: string; clientSecret: string } | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !value) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) return null;

  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Authorization request validation                                           */
/* -------------------------------------------------------------------------- */

/** The part of a registered client this validation needs. Nothing secret. */
export type AuthorizationRequestClient = {
  redirectUris: string[];
  /** The registration's scope ceiling, space-separated. */
  scope: string;
};

export type AuthorizationRequestParams = {
  /**
   * Only the GET stage carries `response_type` — the consent form posts back
   * the request, not the response format — so `undefined` means "not part of
   * this submission" and is skipped rather than rejected.
   */
  responseType?: string | null;
  redirectUri: string | null;
  scope: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  resource: string | null;
};

export type AuthorizationRequestResult =
  | {
      ok: true;
      /** Exact-matched against the registration. Safe to redirect to. */
      redirectUri: string;
      scopes: Scope[];
      /** `scopes`, canonically formatted — what gets stored on the code. */
      scope: string;
      codeChallenge: string;
      codeChallengeMethod: typeof CODE_CHALLENGE_METHOD;
      resource: string | null;
    }
  | {
      ok: false;
      error: string;
      description: string;
      /**
       * Whether this failure may be reported back to the client as an `error`
       * parameter (RFC 6749 §4.1.2.1). An unregistered `redirect_uri` is the
       * one case where it may not: redirecting then would turn the authorize
       * endpoint into an open forwarder.
       */
      redirectable: boolean;
      /** Set exactly when `redirectable` — the verified address to fail to. */
      redirectUri: string | null;
    };

/**
 * Validate an authorization request against the client that registered.
 *
 * Pure: no session, no database, no headers. Both callers run it — the page
 * that renders the consent screen and the server action that mints the code —
 * because the action must not trust that the page checked anything. Its form
 * fields are values the browser sent, and that form is as reachable by a script
 * as by the consent screen.
 */
export function validateAuthorizationRequest(
  client: AuthorizationRequestClient,
  params: AuthorizationRequestParams,
  origin: string,
): AuthorizationRequestResult {
  const redirectUri = matchRedirectUri(client.redirectUris, params.redirectUri);
  if (!redirectUri) {
    return {
      ok: false,
      error: "invalid_request",
      description:
        "That redirect address is not registered for this application.",
      redirectable: false,
      redirectUri: null,
    };
  }

  const fail = (
    error: string,
    description: string,
  ): AuthorizationRequestResult => ({
    ok: false,
    error,
    description,
    redirectable: true,
    redirectUri,
  });

  if (params.responseType !== undefined && params.responseType !== "code") {
    return fail(
      "unsupported_response_type",
      "Only the authorization code flow is supported (response_type=code).",
    );
  }

  if (params.codeChallengeMethod !== CODE_CHALLENGE_METHOD) {
    return fail(
      "invalid_request",
      "PKCE is required: send code_challenge_method=S256. This server has no 'plain' mode.",
    );
  }
  if (!params.codeChallenge || !isValidCodeChallenge(params.codeChallenge)) {
    return fail(
      "invalid_request",
      "code_challenge must be 43–128 base64url characters.",
    );
  }

  const scopes = parseScope(params.scope || DEFAULT_SCOPE);
  if (!scopes) {
    return fail("invalid_scope", "Unknown scope requested.");
  }
  // The registration is a ceiling: a client cannot ask for more at authorize
  // time than it registered for.
  const registered = parseScope(client.scope) ?? [];
  if (!scopes.every((scope) => registered.includes(scope))) {
    return fail(
      "invalid_scope",
      "The requested scope exceeds this application's registration.",
    );
  }

  const resource = params.resource ? params.resource : null;
  if (resource && resource !== resourceIdentifier(origin)) {
    return fail(
      "invalid_target",
      "The requested resource is not served by this instance.",
    );
  }

  return {
    ok: true,
    redirectUri,
    scopes,
    scope: formatScope(scopes),
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: CODE_CHALLENGE_METHOD,
    resource,
  };
}
