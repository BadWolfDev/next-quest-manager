import "server-only";

import { and, count, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireUser } from "@/lib/authorize";

export type NotificationType =
  | "card.assigned"
  | "card.commented"
  | "card.mentioned"
  | "card.due_soon"
  | "card.overdue"
  | "workspace.role_changed"
  | "workspace.added"
  | "workspace.removed";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Queue a notification inside the transaction that caused it, so a user is
 * never told about something that then rolled back.
 *
 * Self-directed events are dropped here rather than at each call site — you do
 * not get a notification for assigning a card to yourself.
 */
export async function notify(
  tx: Tx | typeof db,
  input: {
    userId: string;
    actorId?: string | null;
    type: NotificationType;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.actorId && input.actorId === input.userId) return;

  await tx.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    data: { ...(input.data ?? {}), actorId: input.actorId ?? null },
  });
}

export type NotificationRow = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAtIso: string;
};

/** The caller's own notifications. Scoped by user id in the WHERE clause. */
export async function listMyNotifications(
  limit = 30,
): Promise<NotificationRow[]> {
  const user = await requireUser();

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(limit, 100));

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    data: r.data,
    read: r.readAt !== null,
    createdAtIso: r.createdAt.toISOString(),
  }));
}

export async function countMyUnread(): Promise<number> {
  const user = await requireUser();
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(eq(notifications.userId, user.id), isNull(notifications.readAt)),
    );
  return Number(row?.n ?? 0);
}
