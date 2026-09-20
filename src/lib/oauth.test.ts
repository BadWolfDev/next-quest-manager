import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_PREFIX,
  AUTHORIZATION_CODE_PREFIX,
  CLIENT_ID_PREFIX,
  CLIENT_SECRET_PREFIX,
  DEFAULT_SCOPE,
  REFRESH_TOKEN_PREFIX,
  SCOPE_READ,
  SCOPE_WRITE,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  errorRedirect,
  formatScope,
  generateSecret,
  hashSecret,
  isAllowedRedirectUri,
  isHttpRedirect,
  isReadOnlyScope,
  isValidClientId,
  isValidCodeChallenge,
  isValidCodeVerifier,
  matchRedirectUri,
  narrowScope,
  parseBasicAuth,
  parseScope,
  publicOriginFromHeaders,
  resourceIdentifier,
  secretMatches,
  successRedirect,
  validateAuthorizationRequest,
  verifyPkceS256,
} from "./oauth";

/** The reference S256 transformation, written out rather than reused. */
function challengeFor(verifier: string) {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

const VERIFIER = randomBytes(32).toString("base64url"); // 43 chars

/* -------------------------------------------------------------------------- */
/* PKCE                                                                       */
/* -------------------------------------------------------------------------- */

describe("PKCE S256", () => {
  it("accepts a verifier that hashes to the challenge", () => {
    expect(verifyPkceS256(VERIFIER, challengeFor(VERIFIER))).toBe(true);
  });

  it("rejects a different verifier", () => {
    const other = randomBytes(32).toString("base64url");
    expect(verifyPkceS256(other, challengeFor(VERIFIER))).toBe(false);
  });

  it("rejects a one-character tamper", () => {
    const tampered = VERIFIER.slice(0, -1) + (VERIFIER.endsWith("A") ? "B" : "A");
    expect(verifyPkceS256(tampered, challengeFor(VERIFIER))).toBe(false);
  });

  it("rejects a verifier that is too short or too long", () => {
    const short = "a".repeat(42);
    const long = "a".repeat(129);
    expect(isValidCodeVerifier(short)).toBe(false);
    expect(isValidCodeVerifier(long)).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(128))).toBe(true);
    expect(verifyPkceS256(short, challengeFor(short))).toBe(false);
    expect(verifyPkceS256(long, challengeFor(long))).toBe(false);
  });

  it("rejects a verifier containing characters outside the unreserved set", () => {
    const bad = "a".repeat(42) + "/";
    expect(isValidCodeVerifier(bad)).toBe(false);
    expect(verifyPkceS256(bad, challengeFor(bad))).toBe(false);
  });

  it("rejects a malformed challenge instead of comparing against it", () => {
    expect(isValidCodeChallenge("short")).toBe(false);
    expect(verifyPkceS256(VERIFIER, "short")).toBe(false);
  });

  it("never accepts the plain transformation", () => {
    // A `plain` challenge *is* the verifier. If this ever passed, anyone who
    // saw the authorization request could complete the exchange.
    expect(verifyPkceS256(VERIFIER, VERIFIER)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Redirect URIs                                                              */
/* -------------------------------------------------------------------------- */

describe("redirect URI registration", () => {
  it("allows https anywhere", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(
      true,
    );
  });

  it("allows http only on loopback", () => {
    expect(isAllowedRedirectUri("http://localhost:6274/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:41234/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:5000/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://example.com/cb")).toBe(false);
  });

  it("allows private-use schemes for native clients", () => {
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-mcp/oauth")).toBe(true);
    expect(isAllowedRedirectUri("vscode://callback")).toBe(true);
    expect(isAllowedRedirectUri("com.example.app:/oauth2redirect")).toBe(true);
  });

  it("rejects schemes that would execute in the browser", () => {
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,x")).toBe(false);
    expect(isAllowedRedirectUri("file:///etc/passwd")).toBe(false);
  });

  it("rejects a URI carrying a fragment", () => {
    expect(isAllowedRedirectUri("https://example.com/cb#frag")).toBe(false);
  });

  it("rejects anything that is not a URL", () => {
    expect(isAllowedRedirectUri("not a url")).toBe(false);
    expect(isAllowedRedirectUri("")).toBe(false);
  });
});

describe("redirect URI matching", () => {
  const registered = [
    "https://claude.ai/api/mcp/auth_callback",
    "http://127.0.0.1:6274/oauth/callback",
  ];

  it("matches the exact registered string", () => {
    expect(matchRedirectUri(registered, registered[0])).toBe(registered[0]);
  });

  it("rejects a different path, trailing slash or query", () => {
    expect(matchRedirectUri(registered, "https://claude.ai/api/mcp/")).toBeNull();
    expect(
      matchRedirectUri(registered, "https://claude.ai/api/mcp/auth_callback/"),
    ).toBeNull();
    expect(
      matchRedirectUri(registered, "https://claude.ai/api/mcp/auth_callback?a=1"),
    ).toBeNull();
  });

  it("does NOT relax the loopback port (RFC 8252 §7.3 is not implemented)", () => {
    // Deliberate: allowing an arbitrary port on a registered loopback URI would
    // let any other local process receive a code meant for this client.
    expect(matchRedirectUri(registered, "http://127.0.0.1:9999/oauth/callback"))
      .toBeNull();
    expect(matchRedirectUri(registered, "http://localhost:6274/oauth/callback"))
      .toBeNull();
  });

  it("rejects a missing candidate", () => {
    expect(matchRedirectUri(registered, null)).toBeNull();
    expect(matchRedirectUri(registered, undefined)).toBeNull();
  });
});

describe("redirect construction", () => {
  it("appends error and state without disturbing existing query", () => {
    const url = new URL(
      errorRedirect("https://app.test/cb?x=1", "access_denied", "abc"),
    );
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("abc");
  });

  it("omits state when there was none", () => {
    const url = new URL(successRedirect("https://app.test/cb", "nqa_x", null));
    expect(url.searchParams.get("code")).toBe("nqa_x");
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("knows which redirects the browser can be sent to with a Location header", () => {
    expect(isHttpRedirect("https://app.test/cb")).toBe(true);
    expect(isHttpRedirect("http://127.0.0.1:1/cb")).toBe(true);
    expect(isHttpRedirect("cursor://cb")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Scopes                                                                     */
/* -------------------------------------------------------------------------- */

describe("scopes", () => {
  it("parses and canonicalises", () => {
    expect(parseScope("nqm:write nqm:read")).toEqual([SCOPE_READ, SCOPE_WRITE]);
    expect(parseScope("nqm:read  nqm:read")).toEqual([SCOPE_READ]);
    expect(formatScope([SCOPE_WRITE, SCOPE_READ])).toBe(DEFAULT_SCOPE);
  });

  it("rejects an unknown scope rather than dropping it", () => {
    expect(parseScope("nqm:read nqm:admin")).toBeNull();
    expect(parseScope("openid")).toBeNull();
    expect(parseScope("")).toBeNull();
    expect(parseScope(null)).toBeNull();
  });

  it("narrows on refresh but never widens", () => {
    const granted = [SCOPE_READ, SCOPE_WRITE] as const;
    expect(narrowScope(granted, "nqm:read")).toEqual([SCOPE_READ]);
    expect(narrowScope(granted, undefined)).toEqual([SCOPE_READ, SCOPE_WRITE]);
    expect(narrowScope([SCOPE_READ], "nqm:write")).toBeNull();
    expect(narrowScope([SCOPE_READ], "nqm:read nqm:write")).toBeNull();
    expect(narrowScope(granted, "nqm:bogus")).toBeNull();
  });

  it("treats the absence of write as read-only, so a new scope fails closed", () => {
    expect(isReadOnlyScope("nqm:read")).toBe(true);
    expect(isReadOnlyScope("nqm:read nqm:write")).toBe(false);
    expect(isReadOnlyScope("")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Token material                                                             */
/* -------------------------------------------------------------------------- */

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

describe("OAuth secrets", () => {
  const prefixes = [
    CLIENT_ID_PREFIX,
    CLIENT_SECRET_PREFIX,
    AUTHORIZATION_CODE_PREFIX,
    ACCESS_TOKEN_PREFIX,
    REFRESH_TOKEN_PREFIX,
  ];

  it("uses five distinct prefixes, none of which is the PAT prefix", () => {
    expect(new Set(prefixes).size).toBe(5);
    expect(prefixes).not.toContain("nqm_");
  });

  it("carries 32 bytes of entropy as base64url behind the prefix", () => {
    for (const prefix of prefixes) {
      const { raw } = generateSecret(prefix);
      expect(raw.startsWith(prefix)).toBe(true);
      const body = raw.slice(prefix.length);
      expect(body).toHaveLength(43);
      expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("stores a SHA-256 digest, deterministically", () => {
    const { raw, hash } = generateSecret(ACCESS_TOKEN_PREFIX);
    expect(hash).toBe(sha256(raw));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(raw)).toBe(hash);
    expect(hash).not.toContain(raw);
  });

  it("never repeats", () => {
    const seen = new Set(
      Array.from({ length: 200 }, () => generateSecret(ACCESS_TOKEN_PREFIX).raw),
    );
    expect(seen.size).toBe(200);
  });

  it("compares secrets against their stored digest", () => {
    const { raw, hash } = generateSecret(CLIENT_SECRET_PREFIX);
    expect(secretMatches(raw, hash)).toBe(true);
    expect(secretMatches(raw + "x", hash)).toBe(false);
    expect(secretMatches(raw, "")).toBe(false);
    expect(secretMatches(raw, "not-hex")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Discovery metadata                                                         */
/* -------------------------------------------------------------------------- */

describe("discovery metadata", () => {
  const origin = "https://board.example.com";

  it("describes the protected resource per RFC 9728", () => {
    const metadata = buildProtectedResourceMetadata(origin);
    expect(metadata.resource).toBe(`${origin}/api/mcp`);
    expect(metadata.authorization_servers).toEqual([origin]);
    expect(metadata.scopes_supported).toEqual([SCOPE_READ, SCOPE_WRITE]);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  it("describes the authorization server per RFC 8414", () => {
    const metadata = buildAuthorizationServerMetadata(origin);
    expect(metadata.issuer).toBe(origin);
    expect(metadata.authorization_endpoint).toBe(`${origin}/oauth/authorize`);
    expect(metadata.token_endpoint).toBe(`${origin}/api/oauth/token`);
    expect(metadata.registration_endpoint).toBe(`${origin}/api/oauth/register`);
    expect(metadata.revocation_endpoint).toBe(`${origin}/api/oauth/revoke`);
    expect(metadata.response_types_supported).toEqual(["code"]);
    expect(metadata.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    // S256 only — advertising `plain` would invite a client to use it.
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual([
      "none",
      "client_secret_post",
      "client_secret_basic",
    ]);
    expect(metadata.resource_indicators_supported).toBe(true);
  });

  it("keeps the audience identifier and the resource document in step", () => {
    expect(buildProtectedResourceMetadata(origin).resource).toBe(
      resourceIdentifier(origin),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Request plumbing                                                           */
/* -------------------------------------------------------------------------- */

describe("public origin", () => {
  it("ignores NEXT_PUBLIC_APP_URL and AUTH_URL", () => {
    // Deliberate: one build answers on many origins (a preview URL, a custom
    // domain, localhost), and an origin that disagrees with the host the
    // client reached breaks discovery and the `resource` check.
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://configured.example.com";
    try {
      expect(
        publicOriginFromHeaders(new Headers({ host: "preview.example.com" })),
      ).toBe("https://preview.example.com");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it("prefers the forwarded headers a proxy sets", () => {
    const headers = new Headers({
      host: "internal:3000",
      "x-forwarded-host": "board.example.com",
      "x-forwarded-proto": "https",
    });
    expect(publicOriginFromHeaders(headers)).toBe("https://board.example.com");
  });

  it("assumes http for a loopback host with no forwarded proto", () => {
    expect(publicOriginFromHeaders(new Headers({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("assumes https for a real host with no forwarded proto", () => {
    expect(publicOriginFromHeaders(new Headers({ host: "board.example.com" })))
      .toBe("https://board.example.com");
  });
});

describe("HTTP Basic client authentication", () => {
  it("decodes a well-formed header", () => {
    const header = "Basic " + Buffer.from("nqc_abc:nqs_xyz").toString("base64");
    expect(parseBasicAuth(header)).toEqual({
      clientId: "nqc_abc",
      clientSecret: "nqs_xyz",
    });
  });

  it("returns null for anything else", () => {
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth("Bearer nqo_x")).toBeNull();
    expect(parseBasicAuth("Basic")).toBeNull();
    expect(
      parseBasicAuth("Basic " + Buffer.from("no-colon").toString("base64")),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* client_id shape                                                            */
/* -------------------------------------------------------------------------- */

describe("client_id shape", () => {
  const real = CLIENT_ID_PREFIX + generateSecret("").raw;

  it("accepts an id this server could have issued", () => {
    expect(isValidClientId(real)).toBe(true);
  });

  it("rejects anything else, without a database lookup", () => {
    expect(isValidClientId(null)).toBe(false);
    expect(isValidClientId("")).toBe(false);
    expect(isValidClientId("nqc_short")).toBe(false);
    expect(isValidClientId(real.slice(4))).toBe(false); // prefix missing
    expect(isValidClientId(real + "a")).toBe(false); // too long
    expect(isValidClientId("nqc_" + "a".repeat(43) + "!")).toBe(false);
    // The point of the check: an unbounded, attacker-chosen key never reaches
    // the rate limiter or an indexed lookup.
    expect(isValidClientId("nqc_" + "a".repeat(100_000))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Authorization request validation                                           */
/* -------------------------------------------------------------------------- */

describe("validateAuthorizationRequest", () => {
  const ORIGIN = "https://board.example.com";
  const REDIRECT = "https://client.example.com/cb";
  const CLIENT = { redirectUris: [REDIRECT], scope: DEFAULT_SCOPE };
  const CHALLENGE = challengeFor(VERIFIER);

  const request = (overrides: Record<string, unknown> = {}) => ({
    responseType: "code",
    redirectUri: REDIRECT,
    scope: null,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: "S256",
    resource: null,
    ...overrides,
  });

  it("accepts a well-formed request and defaults the scope", () => {
    const result = validateAuthorizationRequest(CLIENT, request(), ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirectUri).toBe(REDIRECT);
    expect(result.scope).toBe(DEFAULT_SCOPE);
    expect(result.scopes).toEqual([SCOPE_READ, SCOPE_WRITE]);
    expect(result.codeChallengeMethod).toBe("S256");
    expect(result.resource).toBeNull();
  });

  it("refuses an unregistered redirect and forbids redirecting the error", () => {
    const result = validateAuthorizationRequest(
      CLIENT,
      request({ redirectUri: "https://attacker.example.com/cb" }),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // §4.1.2.1: redirecting here would make the endpoint an open forwarder.
    expect(result.redirectable).toBe(false);
    expect(result.redirectUri).toBeNull();
  });

  it("reports every other failure back to the verified redirect", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ responseType: "token" }, "unsupported_response_type"],
      [{ codeChallengeMethod: "plain" }, "invalid_request"],
      [{ codeChallengeMethod: null }, "invalid_request"],
      [{ codeChallenge: "too-short" }, "invalid_request"],
      [{ codeChallenge: null }, "invalid_request"],
      [{ scope: "nqm:admin" }, "invalid_scope"],
      [{ resource: "https://elsewhere.example.com/api/mcp" }, "invalid_target"],
    ];

    for (const [overrides, error] of cases) {
      const result = validateAuthorizationRequest(
        CLIENT,
        request(overrides),
        ORIGIN,
      );
      expect(result.ok, JSON.stringify(overrides)).toBe(false);
      if (result.ok) continue;
      expect(result.error, JSON.stringify(overrides)).toBe(error);
      expect(result.redirectable).toBe(true);
      expect(result.redirectUri).toBe(REDIRECT);
    }
  });

  it("treats the registration as a ceiling on scope", () => {
    const readOnly = { redirectUris: [REDIRECT], scope: SCOPE_READ };
    expect(
      validateAuthorizationRequest(
        readOnly,
        request({ scope: `${SCOPE_READ} ${SCOPE_WRITE}` }),
        ORIGIN,
      ),
    ).toMatchObject({ ok: false, error: "invalid_scope" });

    // …and defaulting cannot climb over it either.
    expect(validateAuthorizationRequest(readOnly, request(), ORIGIN)).toMatchObject(
      { ok: false, error: "invalid_scope" },
    );
  });

  it("accepts this instance's own resource identifier", () => {
    const result = validateAuthorizationRequest(
      CLIENT,
      request({ resource: resourceIdentifier(ORIGIN) }),
      ORIGIN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resource).toBe(resourceIdentifier(ORIGIN));
  });

  it("skips response_type when the submission does not carry one", () => {
    // The consent form posts the request back, not the response format.
    const withoutResponseType = { ...request(), responseType: undefined };
    expect(
      validateAuthorizationRequest(CLIENT, withoutResponseType, ORIGIN).ok,
    ).toBe(true);
  });
});
