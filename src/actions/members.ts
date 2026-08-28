"use server";

import { and, asc, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { users, workspaceMembers, type WorkspaceRole } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { requireWorkspaceMember } from "@/lib/authorize";
import { AuthorizationError } from "@/lib/errors";
import { listAssignableMembersFor } from "@/lib/core/members";
import { notify } from "@/lib/notifications";
import { uuidSchema } from "@/lib/validation";

/**
 * Membership management.
 *
 * The rules, all enforced here rather than in the UI:
 *  - only an owner may grant or revoke `owner`/`admin`;
 *  - an admin may manage `member` and `viewer` only;
 *  - nobody may act on someone of equal or higher rank than themselves
 *    (an admin cannot remove another admin or an owner);
 *  - the last owner can never be demoted, removed, or leave.
 */

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

const changeRoleSchema = z.object({
  workspaceId: uuidSchema,
  userId: uuidSchema,
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

const memberRefSchema = z.object({
  workspaceId: uuidSchema,
  userId: uuidSchema,
});

/** How many owners the workspace has, counted inside the caller's transaction. */
async function ownerCount(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "owner"),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function changeMemberRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = changeRoleSchema.parse({
      workspaceId: formData.get("workspaceId"),
      userId: formData.get("userId"),
      role: formData.get("role"),
    });

    const ctx = await requireWorkspaceMember(input.workspaceId, "admin");

    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        )
        .limit(1);

      if (!target) throw new AuthorizationError("That person is not a member.");

      const actorRank = ROLE_RANK[ctx.role];
      const targetRank = ROLE_RANK[target.role];
      const nextRank = ROLE_RANK[input.role];

      // Granting or removing owner/admin is owner-only. This is what stops an
      // admin promoting themselves (or a confederate) to admin/owner.
      if (
        (nextRank >= ROLE_RANK.admin || targetRank >= ROLE_RANK.admin) &&
        ctx.role !== "owner"
      ) {
        throw new AuthorizationError(
          "Only a workspace owner can change admin or owner roles.",
        );
      }

      // Never act on a peer or a superior.
      if (targetRank >= actorRank && ctx.user.id !== input.userId) {
        throw new AuthorizationError(
          "You cannot change the role of someone at your own level or above.",
        );
      }

      // The workspace must always retain an owner.
      if (target.role === "owner" && input.role !== "owner") {
        if ((await ownerCount(tx, input.workspaceId)) <= 1) {
          throw new AuthorizationError(
            "This is the last owner. Promote someone else to owner first.",
          );
        }
      }

      if (target.role === input.role) return;

      await tx
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        );

      await recordActivity(tx, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        type: "member.role_changed",
        data: {
          userId: input.userId,
          from: target.role,
          to: input.role,
        },
      });

      await notify(tx, {
        userId: input.userId,
        actorId: ctx.user.id,
        type: "workspace.role_changed",
        data: {
          workspaceId: input.workspaceId,
          workspaceName: ctx.workspace.name,
          role: input.role,
        },
      });
    });

    revalidatePath(`/w/${ctx.workspace.slug}/settings/members`);
    revalidatePath("/app", "layout");
    return { ok: true, message: "Role updated." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = memberRefSchema.parse({
      workspaceId: formData.get("workspaceId"),
      userId: formData.get("userId"),
    });

    const ctx = await requireWorkspaceMember(input.workspaceId, "admin");

    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        )
        .limit(1);

      if (!target) return;

      if (
        ROLE_RANK[target.role] >= ROLE_RANK[ctx.role] &&
        ctx.user.id !== input.userId
      ) {
        throw new AuthorizationError(
          "You cannot remove someone at your own level or above.",
        );
      }

      if (target.role === "owner" && (await ownerCount(tx, input.workspaceId)) <= 1) {
        throw new AuthorizationError(
          "This is the last owner and cannot be removed.",
        );
      }

      await tx
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        );

      await recordActivity(tx, {
        workspaceId: input.workspaceId,
        actorId: ctx.user.id,
        type: "member.removed",
        data: { userId: input.userId, role: target.role },
      });

      await notify(tx, {
        userId: input.userId,
        actorId: ctx.user.id,
        type: "workspace.removed",
        data: {
          workspaceId: input.workspaceId,
          workspaceName: ctx.workspace.name,
        },
      });
    });

    revalidatePath(`/w/${ctx.workspace.slug}/settings/members`);
    revalidatePath("/app", "layout");
    return { ok: true, message: "Member removed." };
  } catch (error) {
    return toActionError(error);
  }
}

/** Leave a workspace. Allowed for anyone except the last owner. */
export async function leaveWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { workspaceId } = z
      .object({ workspaceId: uuidSchema })
      .parse({ workspaceId: formData.get("workspaceId") });

    // Any membership level may leave, so authorise at the read floor.
    const ctx = await requireWorkspaceMember(workspaceId, "viewer");

    await db.transaction(async (tx) => {
      if (ctx.role === "owner" && (await ownerCount(tx, workspaceId)) <= 1) {
        throw new AuthorizationError(
          "You are the last owner. Promote someone else to owner, or delete the workspace.",
        );
      }

      await tx
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, ctx.user.id),
          ),
        );

      await recordActivity(tx, {
        workspaceId,
        actorId: ctx.user.id,
        type: "member.left",
        data: { role: ctx.role },
      });
    });
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/app", "layout");
  redirect("/app");
}

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  joinedLabel: string;
  isSelf: boolean;
};

/** Members of a workspace. Any member may see the roster. */
export async function listWorkspaceMembers(
  workspaceId: string,
): Promise<MemberRow[]> {
  const ctx = await requireWorkspaceMember(workspaceId, "viewer");

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    image: r.image,
    role: r.role,
    isSelf: r.userId === ctx.user.id,
    joinedLabel: r.createdAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  }));
}

/**
 * Members assignable to a card — used by the card assignee popover.
 *
 * Deliberately takes no actor: this is a "use server" export and therefore a
 * public endpoint, so the caller is always resolved from the session.
 */
export async function listAssignableMembers(workspaceId: string) {
  return listAssignableMembersFor(workspaceId);
}
