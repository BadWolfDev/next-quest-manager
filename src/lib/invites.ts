import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, or, sql as raw } from "drizzle-orm";

import { db } from "@/db";
import { invites, users, workspaces } from "@/db/schema";
import type { WorkspaceRole } from "@/db/schema";

/**
 * Workspace invite links.
 *
 * Same shape as personal access tokens: `nqi_<43 chars base64url>` (32 bytes of
 * CSPRNG entropy), stored as a SHA-256 digest under a unique index, shown once.
 * A 256-bit random secret has nothing to brute-force, so a plain digest with an
 * indexed lookup is both correct and fast.
 */

export const INVITE_PREFIX = "nqi_";
export const DISPLAY_PREFIX_LENGTH = 12;

export function generateInviteToken() {
  const raw = INVITE_PREFIX + randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashInviteToken(raw),
    prefix: raw.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Why an invite cannot be redeemed, for a specific error page. */
export type InviteProblem =
  | "not_found"
  | "revoked"
  | "expired"
  | "exhausted"
  | "wrong_email";

export type ResolvedInvite = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  email: string | null;
  inviterName: string | null;
  maxUses: number | null;
  useCount: number;
};

/**
 * Look an invite up by its raw token and say whether it is currently usable.
 *
 * Every failure mode is distinguished here so the accept page can explain
 * itself — this is a link the user was legitimately given, so "expired" versus
 * "revoked" is helpful rather than an information leak. Nothing about the
 * workspace is revealed for a token that does not exist.
 */
export async function resolveInvite(
  rawToken: string,
): Promise<
  | { ok: true; invite: ResolvedInvite }
  | { ok: false; problem: InviteProblem; invite?: ResolvedInvite }
> {
  if (!rawToken.startsWith(INVITE_PREFIX)) {
    return { ok: false, problem: "not_found" };
  }

  const [row] = await db
    .select({
      id: invites.id,
      workspaceId: invites.workspaceId,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      role: invites.role,
      email: invites.email,
      maxUses: invites.maxUses,
      useCount: invites.useCount,
      expiresAt: invites.expiresAt,
      revokedAt: invites.revokedAt,
      inviterName: users.name,
    })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .leftJoin(users, eq(users.id, invites.invitedBy))
    .where(eq(invites.tokenHash, hashInviteToken(rawToken)))
    .limit(1);

  if (!row) return { ok: false, problem: "not_found" };

  const invite: ResolvedInvite = {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    workspaceSlug: row.workspaceSlug,
    role: row.role,
    email: row.email,
    inviterName: row.inviterName,
    maxUses: row.maxUses,
    useCount: row.useCount,
  };

  if (row.revokedAt) return { ok: false, problem: "revoked", invite };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, problem: "expired", invite };
  }
  if (row.maxUses !== null && row.useCount >= row.maxUses) {
    return { ok: false, problem: "exhausted", invite };
  }

  return { ok: true, invite };
}

/** Human-readable explanation for a redemption failure. */
export const INVITE_PROBLEM_MESSAGE: Record<InviteProblem, string> = {
  not_found: "This invite link is not valid.",
  revoked: "This invite has been revoked by the workspace.",
  expired: "This invite link has expired.",
  exhausted: "This invite link has already been used the maximum number of times.",
  wrong_email:
    "This invite was issued for a different email address. Sign in with that address to accept it.",
};

/**
 * Atomically claim one use of an invite.
 *
 * The guards live in the WHERE clause, so two people redeeming the last seat of
 * a capped link at the same moment cannot both succeed: exactly one UPDATE
 * matches. Returns false when the invite was not claimable.
 */
export async function claimInviteUse(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  inviteId: string,
): Promise<boolean> {
  const claimed = await tx
    .update(invites)
    .set({
      useCount: raw`${invites.useCount} + 1`,
      acceptedAt: raw`coalesce(${invites.acceptedAt}, now())`,
    })
    .where(
      and(
        eq(invites.id, inviteId),
        isNull(invites.revokedAt),
        or(isNull(invites.expiresAt), raw`${invites.expiresAt} > now()`),
        or(
          isNull(invites.maxUses),
          raw`${invites.useCount} < ${invites.maxUses}`,
        ),
      ),
    )
    .returning({ id: invites.id });

  return claimed.length > 0;
}

/** Cookie that carries an invite token across the login/signup detour. */
export const INVITE_COOKIE = "nqm_invite";
export const INVITE_COOKIE_MAX_AGE = 60 * 30; // 30 minutes
