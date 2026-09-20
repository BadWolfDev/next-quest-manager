"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { requireBoardAccess } from "@/lib/authorize";
import { archiveBoard, createBoard, restoreBoard } from "@/lib/core/board-ops";
import { boardNameSchema, hexColorSchema, uuidSchema } from "@/lib/validation";

const createBoardSchema = z.object({
  workspaceId: uuidSchema,
  name: boardNameSchema,
  background: hexColorSchema.catch("#6366f1"),
});

const renameBoardSchema = z.object({
  boardId: uuidSchema,
  name: boardNameSchema,
});

const boardIdSchema = z.object({ boardId: uuidSchema });

/** Create a board, seeded with three lists and a starter label set. */
export async function createBoardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = createBoardSchema.parse({
      workspaceId: formData.get("workspaceId"),
      name: formData.get("name"),
      background: formData.get("background"),
    });

    const { workspaceSlug } = await createBoard(input, { source: "ui" });

    revalidatePath(`/w/${workspaceSlug}`);
    revalidatePath("/app", "layout");
    return { ok: true, message: `Created “${input.name}”.` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Rename a board. */
export async function renameBoardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { boardId, name } = renameBoardSchema.parse({
      boardId: formData.get("boardId"),
      name: formData.get("name"),
    });

    const ctx = await requireBoardAccess(boardId, "member");

    await db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ name, updatedAt: new Date() })
        .where(eq(boards.id, boardId));

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId,
        actorId: ctx.user.id,
        type: "board.renamed",
        data: { from: ctx.board.name, to: name },
      });
    });

    revalidatePath(`/b/${boardId}`);
    revalidatePath(`/w/${ctx.workspace.slug}`);
    return { ok: true, message: "Board renamed." };
  } catch (error) {
    return toActionError(error);
  }
}

/** Archive a board (soft delete). Requires admin — enforced by the core op. */
export async function archiveBoardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { boardId } = boardIdSchema.parse({
      boardId: formData.get("boardId"),
    });

    const { name, workspaceSlug } = await archiveBoard(
      { boardId },
      { source: "ui" },
    );

    revalidatePath(`/w/${workspaceSlug}`);
    revalidatePath("/app", "layout");
    return { ok: true, message: `Archived “${name}”.` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Restore an archived board. Requires admin — enforced by the core op. */
export async function restoreBoardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { boardId } = boardIdSchema.parse({
      boardId: formData.get("boardId"),
    });

    const { name, workspaceSlug } = await restoreBoard(
      { boardId },
      { source: "ui" },
    );

    revalidatePath(`/w/${workspaceSlug}`);
    revalidatePath("/app", "layout");
    return { ok: true, message: `Restored “${name}”.` };
  } catch (error) {
    return toActionError(error);
  }
}
