"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { lists } from "@/db/schema";
import { eq } from "drizzle-orm";
import { toActionError, type ActionState } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { requireBoardAccess } from "@/lib/authorize";
import { moveCard } from "@/lib/core/board-ops";
import { AuthorizationError } from "@/lib/errors";
import { placeBetween } from "@/lib/positions";
import { uuidSchema } from "@/lib/validation";
import { and, asc, isNull, ne } from "drizzle-orm";

/**
 * Move actions for the board UI.
 *
 * The client sends *neighbour ids*, never a position string — positions are
 * computed server-side from rows re-read inside the transaction. Card moves
 * delegate to `moveCard` in `lib/core/board-ops`, the same implementation the
 * MCP `move_card` tool uses.
 */

const moveCardSchema = z.object({
  cardId: uuidSchema,
  targetListId: uuidSchema,
  /** The card this one should land after (its predecessor). */
  afterCardId: uuidSchema.nullable().default(null),
  /** The card this one should land before (its successor). */
  beforeCardId: uuidSchema.nullable().default(null),
});

const moveListSchema = z.object({
  listId: uuidSchema,
  afterListId: uuidSchema.nullable().default(null),
  beforeListId: uuidSchema.nullable().default(null),
});

export async function moveCardAction(input: {
  cardId: string;
  targetListId: string;
  afterCardId?: string | null;
  beforeCardId?: string | null;
}): Promise<ActionState> {
  try {
    const parsed = moveCardSchema.parse({
      cardId: input.cardId,
      targetListId: input.targetListId,
      afterCardId: input.afterCardId ?? null,
      beforeCardId: input.beforeCardId ?? null,
    });

    const { boardId } = await moveCard(parsed, { source: "ui" });

    revalidatePath(`/b/${boardId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function moveListAction(input: {
  listId: string;
  afterListId?: string | null;
  beforeListId?: string | null;
}): Promise<ActionState> {
  try {
    const parsed = moveListSchema.parse({
      listId: input.listId,
      afterListId: input.afterListId ?? null,
      beforeListId: input.beforeListId ?? null,
    });

    // Resolve the board from the list, then authorise membership on it.
    const [owning] = await db
      .select({ boardId: lists.boardId })
      .from(lists)
      .where(eq(lists.id, parsed.listId))
      .limit(1);

    if (!owning) throw new AuthorizationError();
    const ctx = await requireBoardAccess(owning.boardId, "member");

    await db.transaction(async (tx) => {
      const [list] = await tx
        .select({ id: lists.id, name: lists.name })
        .from(lists)
        .where(
          and(
            eq(lists.id, parsed.listId),
            eq(lists.boardId, ctx.board.id),
            isNull(lists.archivedAt),
          ),
        )
        .limit(1);

      if (!list) throw new AuthorizationError();

      const siblings = await tx
        .select({ id: lists.id, position: lists.position })
        .from(lists)
        .where(
          and(
            eq(lists.boardId, ctx.board.id),
            isNull(lists.archivedAt),
            ne(lists.id, parsed.listId),
          ),
        )
        .orderBy(asc(lists.position));

      const siblingIds = new Set(siblings.map((s) => s.id));
      const afterId =
        parsed.afterListId && siblingIds.has(parsed.afterListId)
          ? parsed.afterListId
          : null;
      const beforeId =
        parsed.beforeListId && siblingIds.has(parsed.beforeListId)
          ? parsed.beforeListId
          : null;

      if (
        (parsed.afterListId && !afterId) ||
        (parsed.beforeListId && !beforeId)
      ) {
        throw new AuthorizationError(
          "That list moved somewhere else. Refresh and try again.",
        );
      }

      const placement = placeBetween(siblings, afterId, beforeId);

      for (const row of placement.rebalanced) {
        await tx
          .update(lists)
          .set({ position: row.position })
          .where(eq(lists.id, row.id));
      }

      await tx
        .update(lists)
        .set({ position: placement.position, updatedAt: new Date() })
        .where(eq(lists.id, parsed.listId));

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId: ctx.board.id,
        actorId: ctx.user.id,
        type: "list.moved",
        data: {
          listId: list.id,
          name: list.name,
          rebalanced: placement.rebalanced.length,
        },
      });
    });

    revalidatePath(`/b/${ctx.board.id}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
