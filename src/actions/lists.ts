"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { lists } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { requireListAccess } from "@/lib/authorize";
import { createList } from "@/lib/core/board-ops";
import { listNameSchema, uuidSchema } from "@/lib/validation";

const createListSchema = z.object({
  boardId: uuidSchema,
  name: listNameSchema,
});

const renameListSchema = z.object({
  listId: uuidSchema,
  name: listNameSchema,
});

const listIdSchema = z.object({ listId: uuidSchema });

/** Append a list to the right-hand end of a board. */
export async function createListAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { boardId, name } = createListSchema.parse({
      boardId: formData.get("boardId"),
      name: formData.get("name"),
    });

    await createList({ boardId, name }, { source: "ui" });

    revalidatePath(`/b/${boardId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Rename a list in place. */
export async function renameListAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { listId, name } = renameListSchema.parse({
      listId: formData.get("listId"),
      name: formData.get("name"),
    });

    const ctx = await requireListAccess(listId, "member");

    await db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ name: lists.name })
        .from(lists)
        .where(and(eq(lists.id, listId), eq(lists.boardId, ctx.board.id)))
        .limit(1);

      await tx
        .update(lists)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(lists.id, listId), eq(lists.boardId, ctx.board.id)));

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId: ctx.board.id,
        actorId: ctx.user.id,
        type: "list.renamed",
        data: { listId, from: previous?.name ?? null, to: name },
      });
    });

    revalidatePath(`/b/${ctx.board.id}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Archive a list (soft delete). Its cards stay in the database and come back
 * with the list if it is restored.
 */
export async function archiveListAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { listId } = listIdSchema.parse({ listId: formData.get("listId") });

    const ctx = await requireListAccess(listId, "member");

    await db.transaction(async (tx) => {
      const [list] = await tx
        .select({ name: lists.name })
        .from(lists)
        .where(and(eq(lists.id, listId), eq(lists.boardId, ctx.board.id)))
        .limit(1);

      if (!list) return;

      await tx
        .update(lists)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(lists.id, listId), eq(lists.boardId, ctx.board.id)));

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId: ctx.board.id,
        actorId: ctx.user.id,
        type: "list.archived",
        data: { listId, name: list.name },
      });
    });

    revalidatePath(`/b/${ctx.board.id}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
