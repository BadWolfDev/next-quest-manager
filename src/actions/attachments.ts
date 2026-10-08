"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import { deleteAttachment } from "@/lib/core/attachments";
import { uuidSchema } from "@/lib/validation";

/**
 * Card attachment actions.
 *
 * Only delete lives here. Uploads go through `POST /api/attachments` — a route
 * handler, so the multi-megabyte body allowance stays on that one URL instead
 * of raising the body cap of every server action (see that route's comment).
 *
 * No `actor` parameter: every export of this file is a public endpoint, so the
 * caller is always session-resolved.
 */
export async function deleteAttachmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { attachmentId } = z
      .object({ attachmentId: uuidSchema })
      .parse({ attachmentId: formData.get("attachmentId") });

    const { boardId } = await deleteAttachment(
      { attachmentId },
      { source: "ui" },
    );

    revalidatePath(`/b/${boardId}`);
    return { ok: true, message: "Attachment deleted." };
  } catch (error) {
    return toActionError(error);
  }
}
