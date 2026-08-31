"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { activityLog, userInvites, users, workspaceMembers } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { requireUser } from "@/lib/authorize";
import { AuthorizationError } from "@/lib/errors";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import {
  generateUserInviteToken,
  isClosedRegistration,
  isEnvAdmin,
} from "@/lib/registration";
import { emailSchema, uuidSchema } from "@/lib/validation";

/**
 * Instance invites — accounts, not workspace membership.
 *
 * Every export here is gated on `requireEnvAdmin()`, which checks the caller's
 * email against ADMIN_EMAIL. Deliberately *not* the `admin` role: on an open
 * instance the first person to sign up also holds `role: "admin"`, and they
 * must not be able to mint accounts on an instance somebody else operates.
 */

const EXPIRY_CHOICES = { "24h": 24, "7d": 24 * 7, never: null } as const;

/** The one identity allowed to mint accounts. */
async function requireEnvAdmin() {
  const user = await requireUser();
  if (!isClosedRegistration()) {
    throw new AuthorizationError(
      "This instance is not running in invite-only mode.",
    );
  }
  if (!isEnvAdmin(user.email)) {
    throw new AuthorizationError("You do not have access to this.");
  }
  return user;
}

const createSchema = z.object({
  expiry: z.enum(["24h", "7d", "never"]).default("7d"),
  maxUses: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(1000)])
    .default(""),
  email: z.union([z.literal(""), emailSchema]).default(""),
});

export type CreateUserInviteState = ActionState & { inviteUrl?: string };

export async function createUserInviteAction(
  _prev: CreateUserInviteState,
  formData: FormData,
): Promise<CreateUserInviteState> {
  try {
    const admin = await requireEnvAdmin();
    const input = createSchema.parse({
      expiry: formData.get("expiry") ?? "7d",
      maxUses: formData.get("maxUses") ?? "",
      email: formData.get("email") ?? "",
    });

    const ip = clientIpFromHeaders(new Headers(await headers()));
    const limited = await rateLimit({
      key: `user-invite:${ip}`,
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!limited.ok) {
      return {
        ok: false,
        message: "Too many invites created. Try again in a little while.",
      };
    }

    const { raw, hash, prefix } = generateUserInviteToken();
    const hours = EXPIRY_CHOICES[input.expiry];
    const expiresAt = hours ? new Date(Date.now() + hours * 3_600_000) : null;

    await db.transaction(async (tx) => {
      const [invite] = await tx
        .insert(userInvites)
        .values({
          tokenHash: hash,
          tokenPrefix: prefix,
          createdBy: admin.id,
          email: input.email === "" ? null : input.email,
          maxUses: input.maxUses === "" ? null : input.maxUses,
          expiresAt,
        })
        .returning({ id: userInvites.id });

      // Instance-level events have no workspace, so they are logged against the
      // admin's own workspace to keep activity_log's NOT NULL contract.
      const [home] = await tx
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, admin.id))
        .limit(1);

      if (home) {
        await tx.insert(activityLog).values({
          workspaceId: home.workspaceId,
          actorId: admin.id,
          type: "user_invite.created",
          data: {
            inviteId: invite.id,
            email: input.email || null,
            maxUses: input.maxUses === "" ? null : input.maxUses,
          },
        });
      }
    });

    const origin = (await headers()).get("origin") ?? "";
    revalidatePath("/settings/users");
    return { ok: true, inviteUrl: `${origin}/join/${raw}` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function revokeUserInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const admin = await requireEnvAdmin();
    const { inviteId } = z
      .object({ inviteId: uuidSchema })
      .parse({ inviteId: formData.get("inviteId") });

    await db
      .update(userInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(userInvites.id, inviteId), isNull(userInvites.revokedAt)));

    const [home] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, admin.id))
      .limit(1);

    if (home) {
      await db.insert(activityLog).values({
        workspaceId: home.workspaceId,
        actorId: admin.id,
        type: "user_invite.revoked",
        data: { inviteId },
      });
    }

    revalidatePath("/settings/users");
    return { ok: true, message: "Invite revoked." };
  } catch (error) {
    return toActionError(error);
  }
}

export type UserInviteRow = {
  id: string;
  tokenPrefix: string;
  email: string | null;
  maxUses: number | null;
  useCount: number;
  expiresLabel: string | null;
  createdLabel: string;
};

/** Open instance invites. Env-admin only. */
export async function listUserInvites(): Promise<UserInviteRow[]> {
  await requireEnvAdmin();

  const rows = await db
    .select({
      id: userInvites.id,
      tokenPrefix: userInvites.tokenPrefix,
      email: userInvites.email,
      maxUses: userInvites.maxUses,
      useCount: userInvites.useCount,
      expiresAt: userInvites.expiresAt,
      createdAt: userInvites.createdAt,
    })
    .from(userInvites)
    .where(isNull(userInvites.revokedAt))
    .orderBy(desc(userInvites.createdAt));

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return rows.map((r) => ({
    id: r.id,
    tokenPrefix: r.tokenPrefix,
    email: r.email,
    maxUses: r.maxUses,
    useCount: r.useCount,
    expiresLabel: r.expiresAt ? fmt(r.expiresAt) : null,
    createdLabel: fmt(r.createdAt),
  }));
}

export type InstanceUserRow = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  joinedLabel: string;
};

/** Everyone with an account. Env-admin only. */
export async function listInstanceUsers(): Promise<InstanceUserRow[]> {
  await requireEnvAdmin();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    joinedLabel: r.createdAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  }));
}
