import "server-only";

import { and, desc, eq, isNull, sql as raw } from "drizzle-orm";

import { db } from "@/db";
import {
  oauthAuthorizationCodes,
  oauthClients,
  oauthConsents,
  oauthTokens,
  users,
} from "@/db/schema";
import type { Actor } from "@/lib/authorize";
import { logError } from "@/lib/log-error";
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_PREFIX,
  AUTHORIZATION_CODE_TTL_SECONDS,
  CLIENT_ID_PREFIX,
  CLIENT_SECRET_PREFIX,
  CODE_CHALLENGE_METHOD,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  formatScope,
  generateSecret,
  hashSecret,
  isConfidential,
  isReadOnlyScope,
  isValidClientId,
  narrowScope,
  parseScope,
  secretMatches,
  verifyPkceS256,
  type TokenEndpointAuthMethod,
} from "@/lib/oauth";

/** Drizzle's transaction handle, as `board-ops.ts` names it. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The stateful half of the OAuth 2.1 authorization server.
 *
 * Everything that touches Postgres lives here; the pure format, PKCE, scope and
 * metadata logic is in `lib/oauth.ts` so it can be tested without a database.
 *
 * Note what is *not* here: any branch in `lib/authorize.ts`. An OAuth access
 * token resolves to an `Actor` and then goes through exactly the same
 * membership joins as a browser session or a personal access token. There is
 * one authorization code path in this codebase and OAuth does not add a second.
 */

/* -------------------------------------------------------------------------- */
/* Clients                                                                    */
/* -------------------------------------------------------------------------- */

export type RegisteredClient = {
  id: string;
  name: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: string;
  scope: string;
  createdAt: Date;
};

export type RegisterClientInput = {
  name: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  scope: string;
};

/**
 * Create a client from an RFC 7591 registration request.
 *
 * The secret is returned once and stored only as a digest, exactly like a
 * personal access token. Public clients (`token_endpoint_auth_method: "none"`,
 * which is what every MCP client in practice uses) get no secret at all — PKCE
 * is what binds the code to the requester.
 */
export async function registerClient(
  input: RegisterClientInput,
): Promise<{ client: RegisteredClient; clientSecret: string | null }> {
  const clientId = CLIENT_ID_PREFIX + generateSecret("").raw;
  const secret = isConfidential(input.tokenEndpointAuthMethod)
    ? generateSecret(CLIENT_SECRET_PREFIX)
    : null;

  const [row] = await db
    .insert(oauthClients)
    .values({
      id: clientId,
      name: input.name,
      clientUri: input.clientUri,
      logoUri: input.logoUri,
      redirectUris: input.redirectUris,
      grantTypes: input.grantTypes,
      tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      secretHash: secret?.hash ?? null,
      scope: input.scope,
    })
    .returning();

  return {
    client: toRegisteredClient(row),
    clientSecret: secret?.raw ?? null,
  };
}

function toRegisteredClient(row: typeof oauthClients.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    clientUri: row.clientUri,
    logoUri: row.logoUri,
    redirectUris: row.redirectUris,
    grantTypes: row.grantTypes,
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    scope: row.scope,
    createdAt: row.createdAt,
  };
}

/**
 * The whole row, secret digest included. Private to this module: everything
 * that leaves it goes through `toRegisteredClient`, which drops `secretHash`.
 */
async function selectClientRow(clientId: string | null | undefined) {
  if (!isValidClientId(clientId)) return null;
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId!))
    .limit(1);
  return row ?? null;
}

export async function getClient(
  clientId: string | null | undefined,
): Promise<RegisteredClient | null> {
  const row = await selectClientRow(clientId);
  return row ? toRegisteredClient(row) : null;
}

export type ClientAuthResult =
  | { ok: true; client: RegisteredClient }
  | { ok: false; reason: "invalid_client" };

/**
 * Authenticate the client at the token / revocation endpoint.
 *
 * A public client authenticates with nothing but its `client_id` — that is what
 * "none" means, and PKCE carries the binding instead. A confidential client
 * must present the secret it was issued, compared as digests in constant time.
 * Presenting a secret for a public client is rejected rather than ignored: it
 * means the client and the server disagree about what this registration is.
 *
 * One row is read, secret digest included, and the digest is stripped on the
 * way out — authenticating a client should not cost two round trips.
 */
export async function authenticateClient({
  clientId,
  clientSecret,
}: {
  clientId: string | null | undefined;
  clientSecret: string | null | undefined;
}): Promise<ClientAuthResult> {
  const row = await selectClientRow(clientId);
  if (!row) return { ok: false, reason: "invalid_client" };

  if (isConfidential(row.tokenEndpointAuthMethod)) {
    if (!clientSecret || !row.secretHash) {
      return { ok: false, reason: "invalid_client" };
    }
    if (!secretMatches(clientSecret, row.secretHash)) {
      return { ok: false, reason: "invalid_client" };
    }
  } else if (clientSecret) {
    return { ok: false, reason: "invalid_client" };
  }

  return { ok: true, client: toRegisteredClient(row) };
}

/** Bookkeeping only; never fails the request it was bookkeeping for. */
export async function touchClient(clientId: string) {
  try {
    await db
      .update(oauthClients)
      .set({ lastUsedAt: new Date() })
      .where(eq(oauthClients.id, clientId));
  } catch (error) {
    logError("[oauth] could not update client last_used_at:", error);
  }
}

/* -------------------------------------------------------------------------- */
/* Authorization codes                                                        */
/* -------------------------------------------------------------------------- */

export type IssueCodeInput = {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
};

/** Mint a single-use authorization code. The raw value exists in one redirect. */
export async function issueAuthorizationCode(
  input: IssueCodeInput,
): Promise<string> {
  const { raw: code, hash } = generateSecret(AUTHORIZATION_CODE_PREFIX);

  await db.insert(oauthAuthorizationCodes).values({
    codeHash: hash,
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    scope: input.scope,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    resource: input.resource,
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
  });

  return code;
}

export type ClaimedCode = {
  id: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
};

export type ClaimCodeResult =
  | { status: "ok"; code: ClaimedCode }
  | { status: "not_found" }
  | { status: "expired" }
  /** Seen before. Everything it produced has just been revoked. */
  | { status: "replayed" };

/**
 * Claim an authorization code, atomically and exactly once.
 *
 * The single-use guarantee is the `used_at IS NULL` predicate in the UPDATE,
 * not a read followed by a write — two clients redeeming the same code at the
 * same instant cannot both match.
 *
 * A code presented twice is the signature of a stolen code: RFC 6749 §4.1.2
 * asks the server to revoke everything that code produced, and because
 * `oauth_tokens.family_id` *is* the code's id, that is one indexed UPDATE.
 */
async function claimAuthorizationCode(
  tx: Tx,
  rawCode: string,
): Promise<ClaimCodeResult> {
  if (!rawCode.startsWith(AUTHORIZATION_CODE_PREFIX)) {
    return { status: "not_found" };
  }
  const codeHash = hashSecret(rawCode);

  const claimed = await tx
    .update(oauthAuthorizationCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(oauthAuthorizationCodes.codeHash, codeHash),
        isNull(oauthAuthorizationCodes.usedAt),
        raw`${oauthAuthorizationCodes.expiresAt} > now()`,
      ),
    )
    .returning();

  const row = claimed[0];
  if (row) {
    return {
      status: "ok",
      code: {
        id: row.id,
        clientId: row.clientId,
        userId: row.userId,
        redirectUri: row.redirectUri,
        scope: row.scope,
        codeChallenge: row.codeChallenge,
        codeChallengeMethod: row.codeChallengeMethod,
        resource: row.resource,
      },
    };
  }

  // Nothing was claimed: either the code never existed, has expired, or has
  // already been spent. Only the last of those calls for revocation.
  const [existing] = await tx
    .select({
      id: oauthAuthorizationCodes.id,
      usedAt: oauthAuthorizationCodes.usedAt,
      expiresAt: oauthAuthorizationCodes.expiresAt,
    })
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, codeHash))
    .limit(1);

  if (!existing) return { status: "not_found" };

  if (existing.usedAt) {
    await revokeFamily(tx, existing.id);
    return { status: "replayed" };
  }

  return { status: "expired" };
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                     */
/* -------------------------------------------------------------------------- */

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

/**
 * Issue an access + refresh pair into one family.
 *
 * `familyId` is the originating authorization code's id, so revoking a family
 * covers both defences — a replayed code and a reused refresh token — with the
 * same indexed UPDATE.
 */
async function issueTokenPair(
  tx: Tx,
  {
    familyId,
    clientId,
    userId,
    scope,
    resource,
  }: {
    familyId: string;
    clientId: string;
    userId: string;
    scope: string;
    resource: string | null;
  },
): Promise<IssuedTokens> {
  const access = generateSecret(ACCESS_TOKEN_PREFIX);
  const refresh = generateSecret(REFRESH_TOKEN_PREFIX);
  const now = Date.now();

  await tx
    .insert(oauthTokens)
    .values([
      {
        familyId,
        kind: "access",
        tokenHash: access.hash,
        clientId,
        userId,
        scope,
        resource,
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
      },
      {
        familyId,
        kind: "refresh",
        tokenHash: refresh.hash,
        clientId,
        userId,
        scope,
        resource,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    ]);

  return {
    accessToken: access.raw,
    refreshToken: refresh.raw,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scope,
  };
}

export type RefreshLookup =
  | {
      status: "ok";
      token: {
        id: string;
        familyId: string;
        clientId: string;
        userId: string;
        scope: string;
        resource: string | null;
      };
    }
  | { status: "not_found" }
  /** Rotated, revoked or expired — the family has been torn down. */
  | { status: "invalid" };

/**
 * Look up a refresh token and mark it superseded in one atomic step.
 *
 * Reuse of an already-rotated refresh token means two parties hold the same
 * secret, so the entire family is revoked rather than just refusing the call.
 * That is the whole point of rotation: detection, not merely expiry.
 */
async function claimRefreshToken(
  tx: Tx,
  rawToken: string,
): Promise<RefreshLookup> {
  if (!rawToken.startsWith(REFRESH_TOKEN_PREFIX)) {
    return { status: "not_found" };
  }
  const tokenHash = hashSecret(rawToken);

  const claimed = await tx
    .update(oauthTokens)
    .set({ revokedAt: new Date(), lastUsedAt: new Date() })
    .where(
      and(
        eq(oauthTokens.tokenHash, tokenHash),
        eq(oauthTokens.kind, "refresh"),
        isNull(oauthTokens.revokedAt),
        raw`${oauthTokens.expiresAt} > now()`,
      ),
    )
    .returning();

  const row = claimed[0];
  if (row) {
    return {
      status: "ok",
      token: {
        id: row.id,
        familyId: row.familyId,
        clientId: row.clientId,
        userId: row.userId,
        scope: row.scope,
        resource: row.resource,
      },
    };
  }

  const [existing] = await tx
    .select({
      id: oauthTokens.id,
      familyId: oauthTokens.familyId,
      revokedAt: oauthTokens.revokedAt,
    })
    .from(oauthTokens)
    .where(
      and(eq(oauthTokens.tokenHash, tokenHash), eq(oauthTokens.kind, "refresh")),
    )
    .limit(1);

  if (!existing) return { status: "not_found" };

  // Presented after it was rotated away or revoked: somebody kept a copy.
  await revokeFamily(tx, existing.familyId);
  return { status: "invalid" };
}

/** Revoke every live token descended from one authorization code. */
async function revokeFamily(tx: Tx, familyId: string) {
  await tx
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)));
}

/* -------------------------------------------------------------------------- */
/* Grants — the two transactional entry points the token endpoint calls       */
/* -------------------------------------------------------------------------- */

export type GrantResult =
  | { status: "ok"; tokens: IssuedTokens }
  /** Ready to hand straight to the RFC 6749 §5.2 error response. */
  | { status: "error"; error: string; description: string };

export type ExchangeCodeInput = {
  rawCode: string;
  clientId: string;
  grantTypes: string[];
  redirectUri: string;
  codeVerifier: string;
  /** The `resource` this token request named, if any. */
  requestedResource: string | null;
  /** The only audience this instance serves: `resourceIdentifier(origin)`. */
  expectedResource: string;
};

/**
 * Redeem an authorization code for a token pair — claim, validate and issue in
 * **one** transaction.
 *
 * Splitting those across statements left a window in which a code was marked
 * used but its tokens had not been written: a crash there burned the grant and
 * left the client with nothing to retry. Inside one transaction the exchange
 * either happens completely or not at all.
 *
 * A validation failure after the claim is *not* rolled back. It returns an
 * error and lets the transaction commit, because the code is single-use by
 * design: a wrong `redirect_uri` or a failed PKCE check is an attacker's
 * signature, and handing them another attempt at the same code would be the
 * bug. Replay of an already-spent code likewise commits its family revocation.
 */
export async function exchangeAuthorizationCode(
  input: ExchangeCodeInput,
): Promise<GrantResult> {
  if (!input.grantTypes.includes("authorization_code")) {
    return {
      status: "error",
      error: "unauthorized_client",
      description:
        "This client is not registered for the authorization_code grant.",
    };
  }

  // RFC 8707: the audience a client names here must be the one we serve.
  if (
    input.requestedResource &&
    input.requestedResource !== input.expectedResource
  ) {
    return {
      status: "error",
      error: "invalid_target",
      description: "resource must be this instance's MCP endpoint.",
    };
  }

  return db.transaction(async (tx): Promise<GrantResult> => {
    const claimed = await claimAuthorizationCode(tx, input.rawCode);
    if (claimed.status !== "ok") {
      // Deliberately one message for all four outcomes. "Already used" would
      // tell an attacker holding a stolen code that it had been redeemed, and
      // the legitimate client cannot act differently on any of them anyway.
      return {
        status: "error",
        error: "invalid_grant",
        description:
          "The authorization code is invalid, expired, or has already been used.",
      };
    }
    const record = claimed.code;

    const reject = (description: string): GrantResult => ({
      status: "error",
      error: "invalid_grant",
      description,
    });

    if (record.clientId !== input.clientId) {
      return reject("This code was issued to another client.");
    }
    if (record.redirectUri !== input.redirectUri) {
      return reject(
        "redirect_uri does not match the one the code was issued for.",
      );
    }
    if (record.codeChallengeMethod !== CODE_CHALLENGE_METHOD) {
      return reject("Unsupported code_challenge_method.");
    }
    if (!verifyPkceS256(input.codeVerifier, record.codeChallenge)) {
      return reject("PKCE verification failed.");
    }
    if (
      record.resource &&
      input.requestedResource &&
      record.resource !== input.requestedResource
    ) {
      return {
        status: "error",
        error: "invalid_target",
        description: "resource does not match the grant.",
      };
    }

    const tokens = await issueTokenPair(tx, {
      // The family *is* the code: revoking it covers both a replayed code and
      // a reused refresh token with the same indexed UPDATE.
      familyId: record.id,
      clientId: input.clientId,
      userId: record.userId,
      scope: record.scope,
      resource: record.resource ?? input.requestedResource,
    });

    return { status: "ok", tokens };
  });
}

export type RotateRefreshInput = {
  rawToken: string;
  clientId: string;
  grantTypes: string[];
  /** The raw `scope` parameter, when the client asked to narrow the grant. */
  requestedScope: string | null;
};

/**
 * Rotate a refresh token: claim, narrow the scope and issue the replacement in
 * one transaction.
 *
 * Rotation is only a detection mechanism if the old token dies exactly when the
 * new one is born. Claiming in one statement and issuing in another could leave
 * a client holding a revoked refresh token and no replacement — locked out of
 * a grant it never misused.
 *
 * Presenting an already-rotated token still revokes the whole family, and that
 * revocation commits: the failure path returns rather than throws.
 */
export async function rotateRefreshToken(
  input: RotateRefreshInput,
): Promise<GrantResult> {
  if (!input.grantTypes.includes("refresh_token")) {
    return {
      status: "error",
      error: "unauthorized_client",
      description: "This client is not registered for the refresh_token grant.",
    };
  }

  return db.transaction(async (tx): Promise<GrantResult> => {
    const claimed = await claimRefreshToken(tx, input.rawToken);
    if (claimed.status !== "ok") {
      return {
        status: "error",
        error: "invalid_grant",
        description:
          "The refresh token is invalid, expired, or has been superseded.",
      };
    }
    const previous = claimed.token;

    if (previous.clientId !== input.clientId) {
      return {
        status: "error",
        error: "invalid_grant",
        description: "This refresh token was issued to another client.",
      };
    }

    const granted = parseScope(previous.scope) ?? [];
    const narrowed = narrowScope(granted, input.requestedScope);
    if (!narrowed) {
      return {
        status: "error",
        error: "invalid_scope",
        description:
          "A refresh may only request a subset of the scopes originally granted.",
      };
    }

    const tokens = await issueTokenPair(tx, {
      familyId: previous.familyId,
      clientId: input.clientId,
      userId: previous.userId,
      scope: formatScope(narrowed),
      resource: previous.resource,
    });

    return { status: "ok", tokens };
  });
}

export type RevokeOutcome = "revoked" | "unknown";

/**
 * RFC 7009 revocation. Revoking a refresh token takes its family with it —
 * a caller asking to revoke a session means the session, not one string.
 */
export async function revokeRawToken(
  rawToken: string,
  clientId: string,
): Promise<RevokeOutcome> {
  const tokenHash = hashSecret(rawToken);

  return db.transaction(async (tx): Promise<RevokeOutcome> => {
    const [row] = await tx
      .select({
        id: oauthTokens.id,
        kind: oauthTokens.kind,
        familyId: oauthTokens.familyId,
        clientId: oauthTokens.clientId,
      })
      .from(oauthTokens)
      .where(eq(oauthTokens.tokenHash, tokenHash))
      .limit(1);

    // A token belonging to another client is "unknown" to this one — RFC 7009
    // §2.1 says to answer 200 either way, and confirming existence would let
    // one registered client probe another's tokens.
    if (!row || row.clientId !== clientId) return "unknown";

    if (row.kind === "refresh") {
      await revokeFamily(tx, row.familyId);
    } else {
      await tx
        .update(oauthTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthTokens.id, row.id));
    }

    return "revoked";
  });
}

/* -------------------------------------------------------------------------- */
/* Resource server                                                            */
/* -------------------------------------------------------------------------- */

export type OauthTokenActor = {
  actor: Actor;
  tokenId: string;
  clientId: string;
  scope: string;
  readOnly: boolean;
};

/**
 * Resolve a raw OAuth access token to the user who consented.
 *
 * Returns null for anything not currently valid — unknown, revoked, expired,
 * or belonging to a deleted account. The caller must not distinguish between
 * those in its response; the MCP endpoint answers a plain 401 for all of them.
 */
export async function resolveOauthAccessToken(
  rawToken: string,
): Promise<OauthTokenActor | null> {
  if (!rawToken.startsWith(ACCESS_TOKEN_PREFIX)) return null;

  const [row] = await db
    .select({
      tokenId: oauthTokens.id,
      clientId: oauthTokens.clientId,
      scope: oauthTokens.scope,
      lastUsedAt: oauthTokens.lastUsedAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
    })
    .from(oauthTokens)
    .innerJoin(users, eq(users.id, oauthTokens.userId))
    .where(
      and(
        eq(oauthTokens.tokenHash, hashSecret(rawToken)),
        eq(oauthTokens.kind, "access"),
        isNull(oauthTokens.revokedAt),
        raw`${oauthTokens.expiresAt} > now()`,
      ),
    )
    .limit(1);

  if (!row) return null;

  await touchOauthToken(row.tokenId, row.lastUsedAt);

  return {
    tokenId: row.tokenId,
    clientId: row.clientId,
    scope: row.scope,
    readOnly: isReadOnlyScope(row.scope),
    actor: {
      id: row.userId,
      email: row.email,
      name: row.name,
      image: row.image,
      role: row.role,
    },
  };
}

/**
 * Same throttle as personal access tokens: `last_used_at` drives a "last used"
 * column in settings, not an audit log, so once a minute is plenty and a failed
 * bookkeeping write must never fail the request it was bookkeeping for.
 */
const TOUCH_INTERVAL_MS = 60_000;

async function touchOauthToken(tokenId: string, lastUsedAt: Date | null) {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < TOUCH_INTERVAL_MS) {
    return;
  }
  try {
    await db
      .update(oauthTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(oauthTokens.id, tokenId));
  } catch (error) {
    logError("[oauth] could not update token last_used_at:", error);
  }
}

/* -------------------------------------------------------------------------- */
/* Consents                                                                   */
/* -------------------------------------------------------------------------- */

/** Remember that this person connected this app, and with what scopes. */
export async function recordConsent(
  userId: string,
  clientId: string,
  scope: string,
) {
  await db
    .insert(oauthConsents)
    .values({ userId, clientId, scope })
    .onConflictDoUpdate({
      target: [oauthConsents.userId, oauthConsents.clientId],
      set: { scope, updatedAt: new Date() },
    });
}

export type ConnectedApp = {
  clientId: string;
  name: string;
  clientUri: string | null;
  scopes: string[];
  authorisedAt: Date;
  lastUsedAt: Date | null;
  activeTokens: number;
};

/** Every app the caller has connected. Scoped to their own id in the WHERE. */
export async function listConnectedApps(
  userId: string,
): Promise<ConnectedApp[]> {
  const rows = await db
    .select({
      clientId: oauthConsents.clientId,
      scope: oauthConsents.scope,
      authorisedAt: oauthConsents.createdAt,
      name: oauthClients.name,
      clientUri: oauthClients.clientUri,
      lastUsedAt: raw<Date | null>`(
        SELECT max(${oauthTokens.lastUsedAt})
        FROM ${oauthTokens}
        WHERE ${oauthTokens.userId} = ${oauthConsents.userId}
          AND ${oauthTokens.clientId} = ${oauthConsents.clientId}
      )`,
      activeTokens: raw<number>`(
        SELECT count(*)
        FROM ${oauthTokens}
        WHERE ${oauthTokens.userId} = ${oauthConsents.userId}
          AND ${oauthTokens.clientId} = ${oauthConsents.clientId}
          AND ${oauthTokens.revokedAt} IS NULL
          AND ${oauthTokens.expiresAt} > now()
      )`,
    })
    .from(oauthConsents)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthConsents.clientId))
    .where(eq(oauthConsents.userId, userId))
    .orderBy(desc(oauthConsents.createdAt));

  return rows.map((row) => ({
    clientId: row.clientId,
    name: row.name,
    clientUri: row.clientUri,
    scopes: row.scope.split(/\s+/).filter(Boolean),
    authorisedAt: row.authorisedAt,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : null,
    activeTokens: Number(row.activeTokens),
  }));
}

/**
 * Disconnect an app: every token this user holds for it dies, and so does the
 * consent record. Both statements are scoped by `user_id` in the WHERE clause,
 * so one person can never revoke another's grant.
 */
export async function revokeClientGrant(userId: string, clientId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.clientId, clientId),
          isNull(oauthTokens.revokedAt),
        ),
      );

    await tx
      .delete(oauthAuthorizationCodes)
      .where(
        and(
          eq(oauthAuthorizationCodes.userId, userId),
          eq(oauthAuthorizationCodes.clientId, clientId),
          isNull(oauthAuthorizationCodes.usedAt),
        ),
      );

    await tx
      .delete(oauthConsents)
      .where(
        and(
          eq(oauthConsents.userId, userId),
          eq(oauthConsents.clientId, clientId),
        ),
      );
  });
}
