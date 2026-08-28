"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import { assignCard, unassignCard } from "@/lib/core/board-ops";
import { uuidSchema } from "@/lib/validation";

const refSchema = z.object({ cardId: uuidSchema, userId: uuidSchema });

export async function assignCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = refSchema.parse({
      cardId: formData.get("cardId"),
      userId: formData.get("userId"),
    });
    const { boardId } = await assignCard(input, { source: "ui" });
    revalidatePath(`/b/${boardId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function unassignCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = refSchema.parse({
      cardId: formData.get("cardId"),
      userId: formData.get("userId"),
    });
    const { boardId } = await unassignCard(input, { source: "ui" });
    revalidatePath(`/b/${boardId}`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
