"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import {
  listArchivedItems,
  restoreCard,
  restoreList,
} from "@/lib/core/board-ops";
import { logError } from "@/lib/log-error";
import { uuidSchema } from "@/lib/validation";

/**
 * Bringing archived things back.
 *
 * Archiving lives next to the thing being archived (`lists.ts`, `cards.ts`);
 * restoring is grouped here because it is driven by one screen — the board's
 * archive panel — and both halves go through the same `require*Access` floor,
 * so a viewer cannot un-archive anything.
 */

export async function restoreCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { cardId } = z
      .object({ cardId: uuidSchema })
      .parse({ cardId: formData.get("cardId") });

    const { boardId } = await restoreCard({ cardId }, { source: "ui" });

    revalidatePath(`/b/${boardId}`);
    return { ok: true, message: "Card restored." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function restoreListAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { listId } = z
      .object({ listId: uuidSchema })
      .parse({ listId: formData.get("listId") });

    const { boardId } = await restoreList({ listId }, { source: "ui" });

    revalidatePath(`/b/${boardId}`);
    return { ok: true, message: "List restored." };
  } catch (error) {
    return toActionError(error);
  }
}

export type ArchivedItems = {
  lists: { id: string; name: string; archivedLabel: string }[];
  cards: {
    id: string;
    title: string;
    listName: string;
    archivedLabel: string;
  }[];
};

export type ArchivedItemsResult =
  | { ok: true; items: ArchivedItems }
  | { ok: false; message: string };

function archivedLabel(at: Date | null): string {
  if (!at) return "";
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Everything archived on one board, for the board's archive drawer.
 *
 * `listArchivedItems` runs `requireBoardAccess` first, so a board the caller
 * cannot see behaves exactly like one that does not exist.
 */
export async function listArchivedItemsAction(
  boardId: string,
): Promise<ArchivedItemsResult> {
  try {
    const parsed = uuidSchema.safeParse(boardId);
    if (!parsed.success) return { ok: false, message: "Unknown board." };

    const { lists: archivedLists, cards: archivedCards } =
      await listArchivedItems(parsed.data);

    return {
      ok: true,
      items: {
        lists: archivedLists.map((list) => ({
          id: list.id,
          name: list.name,
          archivedLabel: archivedLabel(list.archivedAt),
        })),
        cards: archivedCards.map((card) => ({
          id: card.id,
          title: card.title,
          listName: card.listName,
          archivedLabel: archivedLabel(card.archivedAt),
        })),
      },
    };
  } catch (error) {
    logError("[archive]", error);
    return { ok: false, message: "Could not load the archive." };
  }
}
