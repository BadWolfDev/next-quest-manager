"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import { createCard } from "@/lib/core/board-ops";
import { cardTitleSchema, uuidSchema } from "@/lib/validation";

const createCardSchema = z.object({
  listId: uuidSchema,
  title: cardTitleSchema,
});

/**
 * Append a card to the end of a list.
 *
 * Delegates to `createCard` in `lib/core/board-ops` — the same implementation
 * the MCP `create_card` tool uses, so authorization and position logic exist
 * once.
 */
export async function createCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = createCardSchema.parse({
      listId: formData.get("listId"),
      title: formData.get("title"),
    });

    const { boardId } = await createCard(input, { source: "ui" });

    revalidatePath(`/b/${boardId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
