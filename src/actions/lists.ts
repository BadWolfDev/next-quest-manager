"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import { archiveList, createList, renameList } from "@/lib/core/board-ops";
import { listNameSchema, uuidSchema } from "@/lib/validation";

/**
 * List actions.
 *
 * Every one is a thin wrapper over `lib/core/board-ops`, which authorises at
 * the `member` floor, writes the activity row and touches
 * `boards.updated_at` inside a single transaction — the same implementation
 * MCP's `create_list` / `rename_list` / `archive_list` call.
 */

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
    const input = renameListSchema.parse({
      listId: formData.get("listId"),
      name: formData.get("name"),
    });

    const { boardId } = await renameList(input, { source: "ui" });

    revalidatePath(`/b/${boardId}`);
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

    const { boardId } = await archiveList({ listId }, { source: "ui" });

    revalidatePath(`/b/${boardId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
