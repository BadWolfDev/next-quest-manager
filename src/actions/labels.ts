"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import { deleteLabel, updateLabel } from "@/lib/core/board-ops";
import { hexColorSchema, uuidSchema } from "@/lib/validation";

/**
 * Board label management.
 *
 * Creating a label lives in `card-detail.ts` alongside the picker that offers
 * it; editing and deleting live here because they belong to the board's label
 * settings rather than to one card. Both delegate to `lib/core/board-ops`, so
 * MCP's `update_label` / `delete_label` share the implementation.
 */

const labelNameSchema = z
  .string()
  .trim()
  .min(1, "Give the label a name.")
  .max(40, "Keep it under 40 characters.");

export async function updateLabelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const rawName = formData.get("name");
    const rawColor = formData.get("color");

    const input = z
      .object({
        labelId: uuidSchema,
        name: labelNameSchema.optional(),
        color: hexColorSchema.optional(),
      })
      .parse({
        labelId: formData.get("labelId"),
        ...(typeof rawName === "string" ? { name: rawName } : {}),
        ...(typeof rawColor === "string" ? { color: rawColor } : {}),
      });

    const { boardId } = await updateLabel(input, { source: "ui" });

    revalidatePath(`/b/${boardId}`);
    return { ok: true, message: "Label updated." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteLabelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { labelId } = z
      .object({ labelId: uuidSchema })
      .parse({ labelId: formData.get("labelId") });

    const { boardId, detached } = await deleteLabel(
      { labelId },
      { source: "ui" },
    );

    revalidatePath(`/b/${boardId}`);
    return {
      ok: true,
      message:
        detached > 0
          ? `Label deleted and removed from ${detached} card${detached === 1 ? "" : "s"}.`
          : "Label deleted.",
    };
  } catch (error) {
    return toActionError(error);
  }
}
