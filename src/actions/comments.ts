"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import { addComment, deleteComment, updateComment } from "@/lib/core/board-ops";
import { uuidSchema } from "@/lib/validation";

/**
 * Card comment actions.
 *
 * Thin wrappers: validate, delegate to `lib/core/board-ops` (which authorises,
 * applies the author-or-moderator rule, notifies watchers and mentions, and
 * touches `boards.updated_at`), revalidate the *authorised* board path the
 * core returns rather than any id the form supplied.
 *
 * None of these takes an `actor` — every export here is a public endpoint, so
 * the caller is always session-resolved.
 */

const commentBodySchema = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(20_000, "That comment is too long.");

const boardPath = (boardId: string) => `/b/${boardId}`;

export async function addCommentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({ cardId: uuidSchema, body: commentBodySchema })
      .parse({
        cardId: formData.get("cardId"),
        body: formData.get("body"),
      });

    const { boardId } = await addComment(input, { source: "ui" });

    revalidatePath(boardPath(boardId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateCommentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = z
      .object({ commentId: uuidSchema, body: commentBodySchema })
      .parse({
        commentId: formData.get("commentId"),
        body: formData.get("body"),
      });

    const { boardId } = await updateComment(input, { source: "ui" });

    revalidatePath(boardPath(boardId));
    return { ok: true, message: "Comment updated." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteCommentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { commentId } = z
      .object({ commentId: uuidSchema })
      .parse({ commentId: formData.get("commentId") });

    const { boardId } = await deleteComment(
      { commentId },
      { source: "ui" },
    );

    revalidatePath(boardPath(boardId));
    return { ok: true, message: "Comment deleted." };
  } catch (error) {
    return toActionError(error);
  }
}
