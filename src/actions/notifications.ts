"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { notifications } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { requireUser } from "@/lib/authorize";
import { listMyNotifications, type NotificationRow } from "@/lib/notifications";
import { uuidSchema } from "@/lib/validation";

/** The caller's notifications. Ownership is enforced inside the query. */
export async function fetchMyNotificationsAction(): Promise<NotificationRow[]> {
  return listMyNotifications();
}

/**
 * Mark notifications read.
 *
 * With `ids`, marks just those; without, marks everything unread. Either way
 * the caller's user id is part of the WHERE clause, so another user's rows are
 * never matched — there is no ownership check that could be forgotten.
 */
export async function markNotificationsReadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const raw = formData.get("ids");
    const ids =
      typeof raw === "string" && raw.length > 0
        ? z.array(uuidSchema).max(200).parse(JSON.parse(raw))
        : null;

    const user = await requireUser();

    const mine = and(
      eq(notifications.userId, user.id),
      isNull(notifications.readAt),
    );

    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        ids && ids.length > 0
          ? and(mine, inArray(notifications.id, ids))
          : mine,
      );

    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
