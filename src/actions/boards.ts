"use server";

import { eq } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { boards, labels, lists } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { requireBoardAccess, requireWorkspaceMember } from "@/lib/authorize";
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

const DEFAULT_LISTS = ["Backlog", "In Progress", "Done"];

const DEFAULT_LABELS = [
  { name: "Bug", color: "#ef4444" },
  { name: "Feature", color: "#22c55e" },
  { name: "Chore", color: "#64748b" },
];

/** Create a board, seeded with three lists and a starter label set. */
export async function createBoardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let slug: string | null = null;

  try {
    const input = createBoardSchema.parse({
      workspaceId: formData.get("workspaceId"),
      name: formData.get("name"),
      background: formData.get("background"),
    });

    const ctx = await requireWorkspaceMember(input.workspaceId, "member");
    slug = ctx.workspace.slug;

    await db.transaction(async (tx) => {
      const [board] = await tx
        .insert(boards)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          background: { type: "color", value: input.background },
          createdBy: ctx.user.id,
        })
        .returning({ id: boards.id });

      // Fractional indices: evenly spaced keys that later drag & drop can
      // insert between without renumbering neighbours.
      const positions = generateNKeysBetween(null, null, DEFAULT_LISTS.length);

      await tx.insert(lists).values(
        DEFAULT_LISTS.map((name, i) => ({
          boardId: board.id,
          name,
          position: positions[i],
        })),
      );

      await tx
        .insert(labels)
        .values(DEFAULT_LABELS.map((l) => ({ ...l, boardId: board.id })));

      await recordActivity(tx, {
        workspaceId: input.workspaceId,
        boardId: board.id,
        actorId: ctx.user.id,
        type: "board.created",
        data: { name: input.name },
      });
    });

    revalidatePath(`/w/${slug}`);
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

/** Archive a board (soft delete). Requires admin. */
export async function archiveBoardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { boardId } = boardIdSchema.parse({
      boardId: formData.get("boardId"),
    });

    const ctx = await requireBoardAccess(boardId, "admin");

    await db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(boards.id, boardId));

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId,
        actorId: ctx.user.id,
        type: "board.archived",
        data: { name: ctx.board.name },
      });
    });

    revalidatePath(`/w/${ctx.workspace.slug}`);
    revalidatePath("/app", "layout");
    return { ok: true, message: `Archived “${ctx.board.name}”.` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Restore an archived board. Requires admin. */
export async function restoreBoardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { boardId } = boardIdSchema.parse({
      boardId: formData.get("boardId"),
    });

    const ctx = await requireBoardAccess(boardId, "admin");

    await db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(boards.id, boardId));

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId,
        actorId: ctx.user.id,
        type: "board.restored",
        data: { name: ctx.board.name },
      });
    });

    revalidatePath(`/w/${ctx.workspace.slug}`);
    revalidatePath("/app", "layout");
    return { ok: true, message: `Restored “${ctx.board.name}”.` };
  } catch (error) {
    return toActionError(error);
  }
}
