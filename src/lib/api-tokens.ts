import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, or, sql as raw } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens, users } from "@/db/schema";
import type { Actor } from "@/lib/authorize";

/**
 * Personal access tokens for the MCP endpoint.
 *
 * Format: `nqm_<43 chars base64url>` — 32 bytes of CSPRNG entropy. Stored as a
 * SHA-256 hex digest under a unique index, so verification is one indexed
 * lookup with no scanning and no per-candidate comparison. A 256-bit random
 * secret has nothing to brute-force, which is why this is a plain digest and
 * not argon2 (that would add ~20ms to every MCP call for no security gain).
 */

export const TOKEN_PREFIX = "nqm_";
/** Characters of the raw token kept for display, e.g. `nqm_A1b2C3d4`. */
export const DISPLAY_PREFIX_LENGTH = 12;

export function generateToken(): { raw: string; hash: string; prefix: string } {
  const raw = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashToken(raw),
    prefix: raw.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export type TokenActor = {
  actor: Actor;
  tokenId: string;
  readOnly: boolean;
};

/**
 * Resolve a raw bearer token to the owning user.
 *
 * Returns null for anything not currently valid — unknown, revoked, expired,
 * or belonging to a deleted user. The caller must not distinguish between
 * those cases in its response.
 */
export async function resolveApiToken(
  rawToken: string,
): Promise<TokenActor | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;

  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      readOnly: apiTokens.readOnly,
      lastUsedAt: apiTokens.lastUsedAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(rawToken)),
        isNull(apiTokens.revokedAt),
        or(
          isNull(apiTokens.expiresAt),
          raw`${apiTokens.expiresAt} > now()`,
        ),
      ),
    )
    .limit(1);

  if (!row) return null;

  await touchToken(row.tokenId, row.lastUsedAt);

  return {
    tokenId: row.tokenId,
    readOnly: row.readOnly,
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
 * `last_used_at` is for the "when did this token last do anything" column in
 * settings, not an audit log — so it is written at most once a minute rather
 * than on every tool call. Fire-and-forget: a failed bookkeeping write must
 * never fail the request it was bookkeeping for.
 */
const TOUCH_INTERVAL_MS = 60_000;

async function touchToken(tokenId: string, lastUsedAt: Date | null) {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < TOUCH_INTERVAL_MS) {
    return;
  }
  try {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, tokenId));
  } catch (error) {
    console.error("[api-tokens] could not update last_used_at:", error);
  }
}
