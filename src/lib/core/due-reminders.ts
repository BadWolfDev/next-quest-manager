import "server-only";

import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  cardAssignees,
  cardWatchers,
  cards,
  lists,
  workspaceMembers,
} from "@/db/schema";
import { notify } from "@/lib/notifications";

/**
 * The due-date sweep behind `/api/cron/due-reminders`.
 *
 * This is a *system* job, not a user action: there is no session and therefore
 * no `authorize()` helper to call — the same structural split as
 * `public-board.ts`. Two properties stand in for one:
 *
 * - it returns no board data to its caller, only counts, so it cannot be used
 *   to read anything;
 * - every recipient is resolved through `workspace_members` **in SQL**, so a
 *   notification can only ever reach someone who could already open the card.
 *   Somebody removed from a workspace stops hearing about its cards even if
 *   their watcher row is still there.
 *
 * `cards.due_reminded_at` is what makes it idempotent: a card is announced
 * once, and `updateCard` clears the column when the due date moves so a
 * rescheduled deadline is announced again.
 */

/** How far ahead of a deadline the first reminder goes out. */
export const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How far *back* the sweep looks.
 *
 * Without a lower bound the query matches every card that has ever been
 * overdue, so the first run on an existing instance — where `due_reminded_at`
 * is NULL everywhere — would announce years of history in one burst. A card
 * that went past its deadline more than a day ago has been visibly red on the
 * board that whole time; nobody needs to be told now.
 */
export const OVERDUE_GRACE_MS = 24 * 60 * 60 * 1000;

export type DueReminderSummary = {
  cardsConsidered: number;
  notificationsSent: number;
};

export async function sendDueReminders(
  now = new Date(),
): Promise<DueReminderSummary> {
  const horizon = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
  const floor = new Date(now.getTime() - OVERDUE_GRACE_MS);

  const due = await db
    .select({
      cardId: cards.id,
      title: cards.title,
      dueDate: cards.dueDate,
      boardId: boards.id,
      boardName: boards.name,
      workspaceId: boards.workspaceId,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(lists, eq(lists.id, cards.listId))
    .where(
      and(
        isNotNull(cards.dueDate),
        lte(cards.dueDate, horizon),
        gte(cards.dueDate, floor),
        isNull(cards.dueRemindedAt),
        isNull(cards.archivedAt),
        isNull(lists.archivedAt),
        isNull(boards.archivedAt),
      ),
    );

  let notificationsSent = 0;

  for (const card of due) {
    // One transaction per card: the flag and the notifications it explains
    // commit together, and a failure on one card does not lose the others.
    notificationsSent += await db.transaction(async (tx) => {
      // Claim the card by *writing* the flag, conditional on it still being
      // NULL. A plain re-read would not help: two overlapping runs — a
      // self-hoster curling the endpoint while the scheduler fires — would
      // both read NULL and both notify. `UPDATE … WHERE due_reminded_at IS
      // NULL RETURNING id` makes the flag itself the lock: exactly one
      // transaction gets a row back, the loser gets none and skips.
      const claimed = await tx
        .update(cards)
        .set({ dueRemindedAt: now })
        .where(and(eq(cards.id, card.cardId), isNull(cards.dueRemindedAt)))
        .returning({ id: cards.id });

      if (claimed.length === 0) return 0;

      const [assignees, watchers] = await Promise.all([
        tx
          .select({ userId: cardAssignees.userId })
          .from(cardAssignees)
          .innerJoin(
            workspaceMembers,
            and(
              eq(workspaceMembers.userId, cardAssignees.userId),
              eq(workspaceMembers.workspaceId, card.workspaceId),
            ),
          )
          .where(eq(cardAssignees.cardId, card.cardId)),
        tx
          .select({ userId: cardWatchers.userId })
          .from(cardWatchers)
          .innerJoin(
            workspaceMembers,
            and(
              eq(workspaceMembers.userId, cardWatchers.userId),
              eq(workspaceMembers.workspaceId, card.workspaceId),
            ),
          )
          .where(eq(cardWatchers.cardId, card.cardId)),
      ]);

      const recipients = new Set(
        [...assignees, ...watchers].map((r) => r.userId),
      );

      if (recipients.size === 0) return 0;

      const overdue = card.dueDate !== null && card.dueDate.getTime() < now.getTime();

      for (const userId of recipients) {
        await notify(tx, {
          userId,
          // No actor: nobody *did* this, a clock did. Passing one would make
          // `notify` drop the copy for whoever happened to be named.
          actorId: null,
          type: overdue ? "card.overdue" : "card.due_soon",
          data: {
            cardId: card.cardId,
            cardTitle: card.title,
            boardId: card.boardId,
            boardName: card.boardName,
            dueDate: card.dueDate?.toISOString() ?? null,
          },
        });
      }

      return recipients.size;
    });
  }

  return { cardsConsidered: due.length, notificationsSent };
}
