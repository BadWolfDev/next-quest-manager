"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import {
  addChecklistItem,
  archiveCard,
  createChecklist,
  createLabel,
  deleteChecklistItem,
  moveCard,
  resolvePlacement,
  setCardLabel,
  toggleChecklistItem,
  updateCard,
} from "@/lib/core/board-ops";
import { cardTitleSchema, hexColorSchema, uuidSchema } from "@/lib/validation";

/**
 * Card detail modal actions.
 *
 * The `boardId` field in these forms is only ever a hint. Every action
 * revalidates the path derived from the *authorised* context the core returns,
 * so a mismatched or forged boardId cannot make us revalidate — or fail to
 * revalidate — the wrong board.
 *
 * Every one is a thin wrapper: validate, delegate to `lib/core/board-ops`
 * (which authorises at the `member` floor and touches `boards.updated_at`),
 * revalidate. Viewers are refused by the core, not by the absence of a button.
 */

const boardPath = (boardId: string) => `/b/${boardId}`;

/* ------------------------------- card ---------------------------------- */

const updateCardSchema = z.object({
  cardId: uuidSchema,
  boardId: uuidSchema,
  title: cardTitleSchema.optional(),
  description: z.string().max(20_000).nullable().optional(),
});

export async function updateCardDetailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const rawTitle = formData.get("title");
    const rawDescription = formData.get("description");

    const input = updateCardSchema.parse({
      cardId: formData.get("cardId"),
      boardId: formData.get("boardId"),
      ...(typeof rawTitle === "string" ? { title: rawTitle } : {}),
      ...(typeof rawDescription === "string"
        ? { description: rawDescription.length > 0 ? rawDescription : null }
        : {}),
    });

    const { boardId } = await updateCard(
      {
        cardId: input.cardId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      },
      { source: "ui" },
    );

    revalidatePath(boardPath(boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function archiveCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { cardId } = z
      .object({ cardId: uuidSchema, boardId: uuidSchema })
      .parse({
        cardId: formData.get("cardId"),
        boardId: formData.get("boardId"),
      });

    const authorised = await archiveCard({ cardId }, { source: "ui" });
    revalidatePath(boardPath(authorised.boardId));
    return { ok: true, message: "Card archived." };
  } catch (error) {
    return toActionError(error);
  }
}

/** Move a card to another list from the modal's list picker. */
export async function moveCardToListAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { cardId, targetListId } = z
      .object({
        cardId: uuidSchema,
        targetListId: uuidSchema,
        boardId: uuidSchema,
      })
      .parse({
        cardId: formData.get("cardId"),
        targetListId: formData.get("targetListId"),
        boardId: formData.get("boardId"),
      });

    const { afterCardId, beforeCardId } = await resolvePlacement(
      targetListId,
      "bottom",
      cardId,
    );
    const authorised = await moveCard(
      { cardId, targetListId, afterCardId, beforeCardId },
      { source: "ui" },
    );

    revalidatePath(boardPath(authorised.boardId));
    return { ok: true, message: "Card moved." };
  } catch (error) {
    return toActionError(error);
  }
}

/* ------------------------------ labels --------------------------------- */

export async function createLabelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({
        boardId: uuidSchema,
        name: z.string().trim().min(1).max(40),
        color: hexColorSchema,
      })
      .parse({
        boardId: formData.get("boardId"),
        name: formData.get("name"),
        color: formData.get("color"),
      });

    await createLabel(input, { source: "ui" });
    revalidatePath(boardPath(input.boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setCardLabelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({
        cardId: uuidSchema,
        labelId: uuidSchema,
        boardId: uuidSchema,
        attached: z.enum(["true", "false"]),
      })
      .parse({
        cardId: formData.get("cardId"),
        labelId: formData.get("labelId"),
        boardId: formData.get("boardId"),
        attached: formData.get("attached"),
      });

    const { boardId } = await setCardLabel(
      {
        cardId: input.cardId,
        labelId: input.labelId,
        attached: input.attached === "true",
      },
      { source: "ui" },
    );

    revalidatePath(boardPath(boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/* ---------------------------- checklists ------------------------------- */

export async function createChecklistAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({
        cardId: uuidSchema,
        boardId: uuidSchema,
        title: z.string().trim().min(1).max(80),
      })
      .parse({
        cardId: formData.get("cardId"),
        boardId: formData.get("boardId"),
        title: formData.get("title"),
      });

    const { boardId } = await createChecklist(
      { cardId: input.cardId, title: input.title },
      { source: "ui" },
    );
    revalidatePath(boardPath(boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function addChecklistItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({
        checklistId: uuidSchema,
        boardId: uuidSchema,
        content: z.string().trim().min(1).max(500),
      })
      .parse({
        checklistId: formData.get("checklistId"),
        boardId: formData.get("boardId"),
        content: formData.get("content"),
      });

    const { boardId } = await addChecklistItem(
      { checklistId: input.checklistId, content: input.content },
      { source: "ui" },
    );
    revalidatePath(boardPath(boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function toggleChecklistItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({
        itemId: uuidSchema,
        boardId: uuidSchema,
        completed: z.enum(["true", "false"]),
      })
      .parse({
        itemId: formData.get("itemId"),
        boardId: formData.get("boardId"),
        completed: formData.get("completed"),
      });

    const { boardId } = await toggleChecklistItem(
      { itemId: input.itemId, completed: input.completed === "true" },
      { source: "ui" },
    );
    revalidatePath(boardPath(boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteChecklistItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({ itemId: uuidSchema, boardId: uuidSchema })
      .parse({
        itemId: formData.get("itemId"),
        boardId: formData.get("boardId"),
      });

    const { boardId } = await deleteChecklistItem(
      { itemId: input.itemId },
      { source: "ui" },
    );
    revalidatePath(boardPath(boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
