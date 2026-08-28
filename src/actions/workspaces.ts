"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { workspaceMembers, workspaces } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { requireUser, requireWorkspaceMember } from "@/lib/authorize";
import { redirect } from "next/navigation";
import { ACCENTS } from "@/lib/palette";
import { slugify, uuidSchema, workspaceNameSchema } from "@/lib/validation";

const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
});

const renameWorkspaceSchema = z.object({
  workspaceId: uuidSchema,
  name: workspaceNameSchema,
});

const themeSchema = z.object({
  workspaceId: uuidSchema,
  accent: z.enum(ACCENTS),
});

/** Create a workspace; the creator becomes its owner. */
export async function createWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const { name } = createWorkspaceSchema.parse({
      name: formData.get("name"),
    });

    const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;

    await db.transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name, slug, createdBy: user.id, theme: { accent: "violet" } })
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
        data: { name },
      });
    });

    revalidatePath("/app", "layout");
    return { ok: true, message: `Created “${name}”.` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Rename a workspace. Requires admin. */
export async function renameWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { workspaceId, name } = renameWorkspaceSchema.parse({
      workspaceId: formData.get("workspaceId"),
      name: formData.get("name"),
    });

    const ctx = await requireWorkspaceMember(workspaceId, "admin");

    await db.transaction(async (tx) => {
      await tx
        .update(workspaces)
        .set({ name, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId));

      await recordActivity(tx, {
        workspaceId,
        actorId: ctx.user.id,
        type: "workspace.renamed",
        data: { from: ctx.workspace.name, to: name },
      });
    });

    revalidatePath("/app", "layout");
    revalidatePath(`/w/${ctx.workspace.slug}`);
    return { ok: true, message: "Workspace renamed." };
  } catch (error) {
    return toActionError(error);
  }
}

/** Change the workspace accent colour. Requires admin. */
export async function updateWorkspaceThemeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { workspaceId, accent } = themeSchema.parse({
      workspaceId: formData.get("workspaceId"),
      accent: formData.get("accent"),
    });

    const ctx = await requireWorkspaceMember(workspaceId, "admin");

    await db.transaction(async (tx) => {
      await tx
        .update(workspaces)
        .set({ theme: { ...ctx.workspace.theme, accent }, updatedAt: new Date() })
        .where(eq(workspaces.id, workspaceId));

      await recordActivity(tx, {
        workspaceId,
        actorId: ctx.user.id,
        type: "workspace.theme_updated",
        data: { accent },
      });
    });

    revalidatePath("/app", "layout");
    return { ok: true, message: "Theme updated." };
  } catch (error) {
    return toActionError(error);
  }
}

const deleteWorkspaceSchema = z.object({
  workspaceId: uuidSchema,
  /** The user must retype the workspace name; guards against a misclick. */
  confirmName: z.string(),
});

/**
 * Delete a workspace and everything in it. Owner only.
 *
 * Boards, lists, cards, invites and memberships all cascade from the
 * foreign keys, so this is one statement rather than a manual teardown.
 */
export async function deleteWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = deleteWorkspaceSchema.parse({
      workspaceId: formData.get("workspaceId"),
      confirmName: formData.get("confirmName"),
    });

    const ctx = await requireWorkspaceMember(input.workspaceId, "owner");

    if (input.confirmName.trim() !== ctx.workspace.name) {
      return {
        ok: false,
        message: "The name you typed does not match. Nothing was deleted.",
        fields: { confirmName: "Does not match." },
      };
    }

    await db.delete(workspaces).where(eq(workspaces.id, input.workspaceId));
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/app", "layout");
  redirect("/app");
}
