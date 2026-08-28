"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { invites, users, workspaceMembers } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { requireUser, requireWorkspaceMember } from "@/lib/authorize";
import { AuthorizationError } from "@/lib/errors";
import {
  claimInviteUse,
  generateInviteToken,
  INVITE_COOKIE,
  resolveInvite,
} from "@/lib/invites";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { emailSchema, uuidSchema } from "@/lib/validation";

const EXPIRY_CHOICES = { "24h": 24, "7d": 24 * 7, never: null } as const;

const createInviteSchema = z.object({
  workspaceId: uuidSchema,
  role: z.enum(["admin", "member", "viewer"]),
  expiry: z.enum(["24h", "7d", "never"]).default("7d"),
  /** 1 = single use; null = unlimited; N = capped. */
  maxUses: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(1000)])
    .default(""),
  email: z.union([z.literal(""), emailSchema]).default(""),
});

export type CreateInviteState = ActionState & { inviteUrl?: string };

/**
 * Mint an invite link.
 *
 * Only owners may create `admin` invites — otherwise an admin could mint a link
 * and escalate an accomplice (or themselves via a second account) to admin.
 */
export async function createInviteAction(
  _prev: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  try {
    const input = createInviteSchema.parse({
      workspaceId: formData.get("workspaceId"),
      role: formData.get("role"),
      expiry: formData.get("expiry") ?? "7d",
      maxUses: formData.get("maxUses") ?? "",
      email: formData.get("email") ?? "",
    });

    const ctx = await requireWorkspaceMember(input.workspaceId, "admin");

    if (input.role === "admin" && ctx.role !== "owner") {
      return {
        ok: false,
        message: "Only a workspace owner can invite someone as an admin.",
      };
    }

    const ip = clientIpFromHeaders(new Headers(await headers()));
    const limited = await rateLimit({
      key: `invite:${ctx.workspace.id}:${ip}`,
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!limited.ok) {
      return {
        ok: false,
        message: "Too many invites created. Try again in a little while.",
      };
    }

    const { raw, hash, prefix } = generateInviteToken();
    const hours = EXPIRY_CHOICES[input.expiry];
    const expiresAt = hours ? new Date(Date.now() + hours * 3_600_000) : null;

    await db.transaction(async (tx) => {
      const [invite] = await tx
        .insert(invites)
        .values({
          workspaceId: input.workspaceId,
          email: input.email === "" ? null : input.email,
          role: input.role,
          tokenHash: hash,
          tokenPrefix: prefix,
          invitedBy: ctx.user.id,
          expiresAt,
          maxUses: input.maxUses === "" ? null : input.maxUses,
        })
        .returning({ id: invites.id });

      await recordActivity(tx, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        type: "invite.created",
        data: {
          inviteId: invite.id,
          role: input.role,
          email: input.email || null,
          maxUses: input.maxUses === "" ? null : input.maxUses,
        },
      });
    });

    const origin = (await headers()).get("origin") ?? "";
    revalidatePath(`/w/${ctx.workspace.slug}/settings/members`);
    return { ok: true, inviteUrl: `${origin}/invite/${raw}` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function revokeInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { inviteId, workspaceId } = z
      .object({ inviteId: uuidSchema, workspaceId: uuidSchema })
      .parse({
        inviteId: formData.get("inviteId"),
        workspaceId: formData.get("workspaceId"),
      });

    const ctx = await requireWorkspaceMember(workspaceId, "admin");

    await db.transaction(async (tx) => {
      const revoked = await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invites.id, inviteId),
            // Workspace is part of the predicate, so an invite belonging to a
            // different workspace is simply not matched.
            eq(invites.workspaceId, workspaceId),
            isNull(invites.revokedAt),
          ),
        )
        .returning({ id: invites.id });

      if (revoked.length === 0) return;

      await recordActivity(tx, {
        workspaceId,
        actorId: ctx.user.id,
        type: "invite.revoked",
        data: { inviteId },
      });
    });

    revalidatePath(`/w/${ctx.workspace.slug}/settings/members`);
    return { ok: true, message: "Invite revoked." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Redeem an invite as the signed-in user.
 *
 * Idempotent: an existing member is sent straight to the workspace without
 * consuming a use. A bound-email invite may only be redeemed by that address.
 */
export async function acceptInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let slug: string | null = null;

  try {
    const token = String(formData.get("token") ?? "");
    const user = await requireUser();

    const resolved = await resolveInvite(token);
    if (!resolved.ok) {
      return { ok: false, message: "This invite can no longer be used." };
    }
    const invite = resolved.invite;
    slug = invite.workspaceSlug;

    if (
      invite.email &&
      invite.email.toLowerCase() !== user.email.toLowerCase()
    ) {
      return {
        ok: false,
        message:
          "This invite was issued for a different email address.",
      };
    }

    const [existing] = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, invite.workspaceId),
          eq(workspaceMembers.userId, user.id),
        ),
      )
      .limit(1);

    if (!existing) {
      await db.transaction(async (tx) => {
        // Claim a use atomically; if the link was exhausted or revoked between
        // the read above and now, this returns false and nothing is granted.
        const claimed = await claimInviteUse(tx, invite.id);
        if (!claimed) throw new AuthorizationError("This invite is no longer usable.");

        await tx.insert(workspaceMembers).values({
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: invite.role,
        });

        await recordActivity(tx, {
          workspaceId: invite.workspaceId,
          actorId: user.id,
          type: "member.joined",
          data: { role: invite.role, inviteId: invite.id },
        });
      });
    }

    (await cookies()).delete(INVITE_COOKIE);
  } catch (error) {
    return toActionError(error);
  }

  redirect(`/w/${slug}`);
}

export type PendingInvite = {
  id: string;
  role: string;
  email: string | null;
  tokenPrefix: string;
  maxUses: number | null;
  useCount: number;
  expiresLabel: string | null;
  createdByName: string | null;
};

/** Pending (unrevoked) invites for a workspace. Requires admin. */
export async function listPendingInvites(
  workspaceId: string,
): Promise<PendingInvite[]> {
  await requireWorkspaceMember(workspaceId, "admin");

  const rows = await db
    .select({
      id: invites.id,
      role: invites.role,
      email: invites.email,
      tokenPrefix: invites.tokenPrefix,
      maxUses: invites.maxUses,
      useCount: invites.useCount,
      expiresAt: invites.expiresAt,
      createdByName: users.name,
    })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.invitedBy))
    .where(and(eq(invites.workspaceId, workspaceId), isNull(invites.revokedAt)))
    .orderBy(desc(invites.createdAt));

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    email: r.email,
    tokenPrefix: r.tokenPrefix,
    maxUses: r.maxUses,
    useCount: r.useCount,
    createdByName: r.createdByName,
    expiresLabel: r.expiresAt
      ? r.expiresAt.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null,
  }));
}
