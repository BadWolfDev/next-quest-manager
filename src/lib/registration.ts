import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, or, sql as raw } from "drizzle-orm";

import { db } from "@/db";
import { userInvites, users, workspaceMembers, workspaces } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/password";
import { emailSchema, passwordSchema, slugify } from "@/lib/validation";

/**
 * Closed-registration mode.
 *
 * Off by default: with `ADMIN_EMAIL` / `ADMIN_PASSWORD` unset the instance
 * behaves exactly as it always has — anyone can sign up. Setting **both** turns
 * public signup off and makes new accounts arrive only through an instance
 * invite minted by that one admin identity.
 */

export type AdminConfig = { email: string; password: string };

let cachedAdminConfig: AdminConfig | null | undefined;

/**
 * Read and validate the admin bootstrap credentials.
 *
 * Setting only one of the pair is a misconfiguration rather than a mode: it
 * would silently leave signup open on an instance whose operator believed they
 * had closed it, so it fails loudly instead.
 *
 * Deliberately reads `process.env` directly rather than going through
 * `lib/env.ts`, so asking "is registration closed?" does not also demand a
 * DATABASE_URL — that would make the check unusable during a build.
 */
export function getAdminConfig(): AdminConfig | null {
  if (cachedAdminConfig !== undefined) return cachedAdminConfig;

  const rawEmail = process.env.ADMIN_EMAIL?.trim();
  const rawPassword = process.env.ADMIN_PASSWORD;

  if (!rawEmail && !rawPassword) {
    cachedAdminConfig = null;
    return null;
  }

  if (!rawEmail || !rawPassword) {
    throw new Error(
      "\n[Next Quest Manager] Incomplete closed-registration configuration.\n\n" +
        "  ADMIN_EMAIL and ADMIN_PASSWORD must be set together.\n" +
        `  Currently set: ${rawEmail ? "ADMIN_EMAIL" : "ADMIN_PASSWORD"} only.\n\n` +
        "  Set both to run this instance invite-only, or neither to allow open signup.\n",
    );
  }

  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) {
    throw new Error(
      "\n[Next Quest Manager] ADMIN_EMAIL is not a valid email address.\n",
    );
  }

  // Same policy as any other account — never log the value itself.
  const password = passwordSchema.safeParse(rawPassword);
  if (!password.success) {
    throw new Error(
      "\n[Next Quest Manager] ADMIN_PASSWORD does not meet the password policy:\n" +
        `  ${password.error.issues.map((i) => i.message).join("; ")}\n`,
    );
  }

  cachedAdminConfig = { email: email.data, password: rawPassword };
  return cachedAdminConfig;
}

/** True when this instance only admits invited users. */
export function isClosedRegistration(): boolean {
  return getAdminConfig() !== null;
}

/**
 * Is this the env-configured admin?
 *
 * Instance invites are gated on *this identity*, not on the `admin` role. The
 * first user to sign up on an open instance also gets `role: "admin"`, and they
 * must not be able to mint accounts on an instance someone else operates.
 */
export function isEnvAdmin(email: string | null | undefined): boolean {
  const config = getAdminConfig();
  if (!config || !email) return false;
  return email.trim().toLowerCase() === config.email;
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

let bootstrapPromise: Promise<void> | null = null;

/**
 * Ensure the env-configured admin account exists.
 *
 * Runs **lazily, memoised per process**, from the credentials provider — the
 * first moment anyone actually tries to authenticate. Deliberately not at
 * module import (that would open a connection during `next build`) and not in
 * the migrate step (a build box may not be the thing holding the credentials).
 *
 * Idempotent: an existing account is elevated to `admin` if needed but its
 * **password is never overwritten** from the environment. The env password is a
 * bootstrap credential, not a continuously-enforced one — otherwise rotating it
 * in the environment would silently reset a password the admin had changed, and
 * anyone who could read the env could take over an established account.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const config = getAdminConfig();
  if (!config) return;

  bootstrapPromise ??= (async () => {
    const [existing] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, config.email))
      .limit(1);

    if (existing) {
      if (existing.role !== "admin") {
        await db
          .update(users)
          .set({ role: "admin", updatedAt: new Date() })
          .where(eq(users.id, existing.id));
        console.log("[bootstrap] elevated existing ADMIN_EMAIL user to admin.");
      }
      return;
    }

    const passwordHash = await hashPassword(config.password);
    const name = config.email.split("@")[0] ?? "Admin";

    await db.transaction(async (tx) => {
      // Re-check inside the transaction: two cold processes can race here.
      const [raced] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, config.email))
        .limit(1);
      if (raced) return;

      const [user] = await tx
        .insert(users)
        .values({
          email: config.email,
          name,
          passwordHash,
          role: "admin",
        })
        .returning({ id: users.id });

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: `${name}'s Workspace`,
          slug: `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`,
          createdBy: user.id,
          theme: { accent: "violet" },
        })
        .returning({ id: workspaces.id });

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });

      await recordActivity(tx, {
        workspaceId: workspace.id,
        actorId: user.id,
        type: "workspace.created",
        data: { name: `${name}'s Workspace`, reason: "admin-bootstrap" },
      });
    });

    console.log("[bootstrap] created the ADMIN_EMAIL account.");
  })().catch((error) => {
    // Let the next attempt retry rather than caching a failure forever.
    bootstrapPromise = null;
    throw error;
  });

  return bootstrapPromise;
}

/* -------------------------------------------------------------------------- */
/* Instance invite tokens                                                     */
/* -------------------------------------------------------------------------- */

export const USER_INVITE_PREFIX = "nqu_";
export const DISPLAY_PREFIX_LENGTH = 12;

export function generateUserInviteToken() {
  const rawToken = USER_INVITE_PREFIX + randomBytes(32).toString("base64url");
  return {
    raw: rawToken,
    hash: hashUserInviteToken(rawToken),
    prefix: rawToken.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export function hashUserInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export type UserInviteProblem =
  | "not_found"
  | "revoked"
  | "expired"
  | "exhausted"
  | "wrong_email";

export const USER_INVITE_PROBLEM_MESSAGE: Record<UserInviteProblem, string> = {
  not_found: "This invite link is not valid.",
  revoked: "This invite has been revoked.",
  expired: "This invite link has expired.",
  exhausted:
    "This invite link has already been used the maximum number of times.",
  wrong_email: "This invite was issued for a different email address.",
};

export type ResolvedUserInvite = {
  id: string;
  email: string | null;
  maxUses: number | null;
  useCount: number;
};

/** Look up an instance invite and say whether it can currently be redeemed. */
export async function resolveUserInvite(
  rawToken: string,
): Promise<
  | { ok: true; invite: ResolvedUserInvite }
  | { ok: false; problem: UserInviteProblem }
> {
  if (!rawToken.startsWith(USER_INVITE_PREFIX)) {
    return { ok: false, problem: "not_found" };
  }

  const [row] = await db
    .select({
      id: userInvites.id,
      email: userInvites.email,
      maxUses: userInvites.maxUses,
      useCount: userInvites.useCount,
      expiresAt: userInvites.expiresAt,
      revokedAt: userInvites.revokedAt,
    })
    .from(userInvites)
    .where(eq(userInvites.tokenHash, hashUserInviteToken(rawToken)))
    .limit(1);

  if (!row) return { ok: false, problem: "not_found" };
  if (row.revokedAt) return { ok: false, problem: "revoked" };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, problem: "expired" };
  }
  if (row.maxUses !== null && row.useCount >= row.maxUses) {
    return { ok: false, problem: "exhausted" };
  }

  return {
    ok: true,
    invite: {
      id: row.id,
      email: row.email,
      maxUses: row.maxUses,
      useCount: row.useCount,
    },
  };
}

/**
 * Atomically claim one use of an instance invite.
 *
 * Every guard lives in the WHERE clause, so two people redeeming the last seat
 * at the same instant cannot both succeed — exactly one UPDATE matches. Must be
 * called inside the same transaction that creates the user.
 */
export async function claimUserInviteUse(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  inviteId: string,
): Promise<boolean> {
  const claimed = await tx
    .update(userInvites)
    .set({ useCount: raw`${userInvites.useCount} + 1` })
    .where(
      and(
        eq(userInvites.id, inviteId),
        isNull(userInvites.revokedAt),
        or(isNull(userInvites.expiresAt), raw`${userInvites.expiresAt} > now()`),
        or(
          isNull(userInvites.maxUses),
          raw`${userInvites.useCount} < ${userInvites.maxUses}`,
        ),
      ),
    )
    .returning({ id: userInvites.id });

  return claimed.length > 0;
}
