"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { recordActivity } from "@/lib/activity";
import { requireBoardAccess } from "@/lib/authorize";
import { generatePublicToken } from "@/lib/core/public-board";
import { uuidSchema } from "@/lib/validation";

/**
 * Public board sharing.
 *
 * Changing the share state requires **admin** on the workspace — a plain member
 * can see whether a board is shared but cannot publish one.
 */

export type ShareState = ActionState & { shareUrl?: string | null };

const boardRef = z.object({ boardId: uuidSchema });

async function origin(): Promise<string> {
  return (await headers()).get("origin") ?? "";
}

/** Enable sharing, or rotate an existing link. Both mint a fresh token. */
export async function enablePublicBoardAction(
  _prev: ShareState,
  formData: FormData,
): Promise<ShareState> {
  try {
    const { boardId } = boardRef.parse({ boardId: formData.get("boardId") });
    const ctx = await requireBoardAccess(boardId, "admin");

    const [existing] = await db
      .select({ publicToken: boards.publicToken })
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1);

    const rotating = Boolean(existing?.publicToken);
    const token = generatePublicToken();

    await db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ publicToken: token, updatedAt: new Date() })
        .where(eq(boards.id, boardId));

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId,
        actorId: ctx.user.id,
        type: rotating ? "board.link_rotated" : "board.public_enabled",
        data: { name: ctx.board.name },
      });
    });

    revalidatePath(`/b/${boardId}`);
    return { ok: true, shareUrl: `${await origin()}/p/${token}` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function disablePublicBoardAction(
  _prev: ShareState,
  formData: FormData,
): Promise<ShareState> {
  try {
    const { boardId } = boardRef.parse({ boardId: formData.get("boardId") });
    const ctx = await requireBoardAccess(boardId, "admin");

    await db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ publicToken: null, updatedAt: new Date() })
        .where(eq(boards.id, boardId));

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId,
        actorId: ctx.user.id,
        type: "board.public_disabled",
        data: { name: ctx.board.name },
      });
    });

    revalidatePath(`/b/${boardId}`);
    return { ok: true, shareUrl: null, message: "Public link turned off." };
  } catch (error) {
    return toActionError(error);
  }
}
