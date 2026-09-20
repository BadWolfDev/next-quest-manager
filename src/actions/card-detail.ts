"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import {
  addChecklistItem,
  archiveCard,
  copyCard,
  createChecklist,
  createLabel,
  deleteChecklistItem,
  moveCard,
  moveCardToBoard,
  moveChecklistItem,
  resolvePlacement,
  setCardLabel,
  toggleChecklistItem,
  unwatchCard,
  updateCard,
  watchCard,
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

/**
 * An ISO 8601 timestamp, or null to clear the due date.
 *
 * Parsed here rather than handed to `new Date()` downstream: an unparseable
 * string would become `Invalid Date` and reach Postgres as a range error
 * rather than a field-level message.
 */
const dueDateSchema = z
  .string()
  .trim()
  .nullable()
  .transform((value, ctx) => {
    if (value === null || value === "") return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: "That is not a valid date." });
      return z.NEVER;
    }
    return parsed;
  });

const updateCardSchema = z.object({
  cardId: uuidSchema,
  boardId: uuidSchema,
  title: cardTitleSchema.optional(),
  description: z.string().max(20_000).nullable().optional(),
  dueDate: dueDateSchema.optional(),
});

export async function updateCardDetailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const rawTitle = formData.get("title");
    const rawDescription = formData.get("description");
    const rawDueDate = formData.get("dueDate");

    const input = updateCardSchema.parse({
      cardId: formData.get("cardId"),
      boardId: formData.get("boardId"),
      ...(typeof rawTitle === "string" ? { title: rawTitle } : {}),
      ...(typeof rawDescription === "string"
        ? { description: rawDescription.length > 0 ? rawDescription : null }
        : {}),
      // A field absent from the form leaves the due date alone; an empty
      // string clears it. That distinction is why this is read from FormData
      // rather than defaulted in the schema.
      ...(typeof rawDueDate === "string" ? { dueDate: rawDueDate } : {}),
    });

    const { boardId } = await updateCard(
      {
        cardId: input.cardId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
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

/** Duplicate a card into a list, which may be on another board. */
export async function copyCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const rawTitle = formData.get("title");

    const input = z
      .object({
        cardId: uuidSchema,
        targetListId: uuidSchema,
        title: cardTitleSchema.optional(),
      })
      .parse({
        cardId: formData.get("cardId"),
        targetListId: formData.get("targetListId"),
        ...(typeof rawTitle === "string" && rawTitle.trim().length > 0
          ? { title: rawTitle }
          : {}),
      });

    const { boardId } = await copyCard(input, { source: "ui" });

    revalidatePath(boardPath(boardId));
    return { ok: true, message: "Card copied." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Move a card to a list on another board.
 *
 * Both boards are revalidated from the ids the *core* returns, so the card
 * disappears from the old board for everyone who is looking at it.
 */
export async function moveCardToBoardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({ cardId: uuidSchema, targetListId: uuidSchema })
      .parse({
        cardId: formData.get("cardId"),
        targetListId: formData.get("targetListId"),
      });

    const { boardId, fromBoardId } = await moveCardToBoard(input, {
      source: "ui",
    });

    revalidatePath(boardPath(fromBoardId));
    revalidatePath(boardPath(boardId));
    return { ok: true, message: "Card moved." };
  } catch (error) {
    return toActionError(error);
  }
}

/* ------------------------------ watching -------------------------------- */

export async function watchCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { cardId } = z
      .object({ cardId: uuidSchema })
      .parse({ cardId: formData.get("cardId") });

    const { boardId } = await watchCard({ cardId }, { source: "ui" });

    revalidatePath(boardPath(boardId));
    return { ok: true, message: "Watching this card." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function unwatchCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { cardId } = z
      .object({ cardId: uuidSchema })
      .parse({ cardId: formData.get("cardId") });

    const { boardId } = await unwatchCard({ cardId }, { source: "ui" });

    revalidatePath(boardPath(boardId));
    return { ok: true, message: "No longer watching." };
  } catch (error) {
    return toActionError(error);
  }
}

/* -------------------------- checklist ordering -------------------------- */

/**
 * Reorder a checklist item, or move it to another checklist on the same card.
 *
 * Neighbour ids only, exactly like `moveCardAction`: the client never sends a
 * position string, and the index is computed server-side inside the
 * transaction.
 */
export async function moveChecklistItemAction(input: {
  itemId: string;
  targetChecklistId?: string | null;
  afterId?: string | null;
  beforeId?: string | null;
}): Promise<ActionState> {
  try {
    const parsed = z
      .object({
        itemId: uuidSchema,
        targetChecklistId: uuidSchema.nullable().default(null),
        afterId: uuidSchema.nullable().default(null),
        beforeId: uuidSchema.nullable().default(null),
      })
      .parse({
        itemId: input.itemId,
        targetChecklistId: input.targetChecklistId ?? null,
        afterId: input.afterId ?? null,
        beforeId: input.beforeId ?? null,
      });

    const { boardId } = await moveChecklistItem(
      {
        itemId: parsed.itemId,
        ...(parsed.targetChecklistId
          ? { targetChecklistId: parsed.targetChecklistId }
          : {}),
        afterId: parsed.afterId,
        beforeId: parsed.beforeId,
      },
      { source: "ui" },
    );

    revalidatePath(boardPath(boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
