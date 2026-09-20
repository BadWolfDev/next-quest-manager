import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  or,
} from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

import { db } from "@/db";
import {
  boards,
  cardAssignees,
  cardLabels,
  cardWatchers,
  cards,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
  users,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import {
  requireBoardAccess,
  requireCardAccess,
  requireListAccess,
  requireUser,
  requireWorkspaceMember,
  READ_MIN_ROLE,
  type Actor,
} from "@/lib/authorize";
import { AuthorizationError } from "@/lib/errors";
import { resolveMentions } from "@/lib/mentions";
import { notify } from "@/lib/notifications";
import { placeBetween } from "@/lib/positions";

/**
 * Domain operations shared by the web UI's server actions and the MCP tools.
 *
 * Each takes an explicit `actor` (undefined = resolve from the browser session)
 * and a `source` recorded on the activity entry, so a board's history shows
 * whether a change came from a person in the UI or an agent over MCP. There is
 * exactly one implementation of each mutation and one authorization path;
 * nothing here is duplicated for MCP.
 */

export type MutationSource = "ui" | "mcp";

export type OpContext = {
  actor?: Actor;
  source?: MutationSource;
};

function sourceData(source: MutationSource | undefined) {
  return source && source !== "ui" ? { source } : {};
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Bump a board's `updated_at`.
 *
 * Every mutation that changes what the board *looks like* — lists, cards,
 * moves, assignees — calls this inside its own transaction. That single column
 * is what the freshness endpoint reads, so other viewers notice the change on
 * their next poll. Board metadata edits (rename, archive) set updatedAt
 * directly and do not need it.
 */
async function touchBoard(tx: Tx, boardId: string) {
  await tx
    .update(boards)
    .set({ updatedAt: new Date() })
    .where(eq(boards.id, boardId));
}

/**
 * Subscribe someone to a card, idempotently.
 *
 * Called both explicitly (`watchCard`) and as a side effect of assigning or
 * commenting, so it must never fail on a duplicate.
 */
async function watch(tx: Tx, cardId: string, userId: string) {
  await tx.insert(cardWatchers).values({ cardId, userId }).onConflictDoNothing();
}

const DEFAULT_LISTS = ["Backlog", "In Progress", "Done"];
const DEFAULT_LABELS = [
  { name: "Bug", color: "#ef4444" },
  { name: "Feature", color: "#22c55e" },
  { name: "Chore", color: "#64748b" },
];

/* -------------------------------------------------------------------------- */
/* Boards                                                                     */
/* -------------------------------------------------------------------------- */

export async function createBoard(
  input: { workspaceId: string; name: string; background: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; workspaceSlug: string }> {
  const ctx = await requireWorkspaceMember(input.workspaceId, "member", actor);

  const boardId = await db.transaction(async (tx) => {
    const [board] = await tx
      .insert(boards)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        background: { type: "color", value: input.background },
        createdBy: ctx.user.id,
      })
      .returning({ id: boards.id });

    // Evenly spaced keys later drops can insert between without renumbering.
    const positions = generateNKeysBetween(null, null, DEFAULT_LISTS.length);

    await tx.insert(lists).values(
      DEFAULT_LISTS.map((name, i) => ({
        boardId: board.id,
        name,
        position: positions[i],
      })),
    );

    await tx
      .insert(labels)
      .values(DEFAULT_LABELS.map((l) => ({ ...l, boardId: board.id })));

    await recordActivity(tx, {
      workspaceId: input.workspaceId,
      boardId: board.id,
      actorId: ctx.user.id,
      type: "board.created",
      data: { name: input.name, ...sourceData(source) },
    });

    return board.id;
  });

  return { boardId, workspaceSlug: ctx.workspace.slug };
}

/**
 * Archive a board (soft delete). Requires `admin`: this hides every list and
 * card on it from the whole workspace, which is not a member-level decision.
 *
 * Board metadata changes set `updated_at` directly rather than going through
 * `touchBoard` — same column, but there is no separate content mutation to
 * bundle with.
 */
export async function archiveBoard(
  input: { boardId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; name: string; workspaceSlug: string }> {
  const ctx = await requireBoardAccess(input.boardId, "admin", actor);

  await db.transaction(async (tx) => {
    await tx
      .update(boards)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(boards.id, input.boardId));

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: input.boardId,
      actorId: ctx.user.id,
      type: "board.archived",
      data: { name: ctx.board.name, ...sourceData(source) },
    });
  });

  return {
    boardId: ctx.board.id,
    name: ctx.board.name,
    workspaceSlug: ctx.workspace.slug,
  };
}

/** Restore an archived board. Requires `admin`, like archiving it. */
export async function restoreBoard(
  input: { boardId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; name: string; workspaceSlug: string }> {
  const ctx = await requireBoardAccess(input.boardId, "admin", actor);

  await db.transaction(async (tx) => {
    await tx
      .update(boards)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(boards.id, input.boardId));

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: input.boardId,
      actorId: ctx.user.id,
      type: "board.restored",
      data: { name: ctx.board.name, ...sourceData(source) },
    });
  });

  return {
    boardId: ctx.board.id,
    name: ctx.board.name,
    workspaceSlug: ctx.workspace.slug,
  };
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                      */
/* -------------------------------------------------------------------------- */

export async function createList(
  input: { boardId: string; name: string },
  { actor, source }: OpContext = {},
): Promise<{ listId: string }> {
  const ctx = await requireBoardAccess(input.boardId, "member", actor);

  const listId = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ position: lists.position })
      .from(lists)
      .where(and(eq(lists.boardId, input.boardId), isNull(lists.archivedAt)))
      .orderBy(desc(lists.position))
      .limit(1);

    const [list] = await tx
      .insert(lists)
      .values({
        boardId: input.boardId,
        name: input.name,
        position: generateKeyBetween(last?.position ?? null, null),
      })
      .returning({ id: lists.id });

    await touchBoard(tx, input.boardId);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: input.boardId,
      actorId: ctx.user.id,
      type: "list.created",
      data: { name: input.name, listId: list.id, ...sourceData(source) },
    });

    return list.id;
  });

  return { listId };
}

export async function renameList(
  input: { listId: string; name: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await requireListAccess(input.listId, "member", actor);

  await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ name: lists.name })
      .from(lists)
      .where(
        and(eq(lists.id, input.listId), eq(lists.boardId, ctx.board.id)),
      )
      .limit(1);

    if (!previous) throw new AuthorizationError();

    await tx
      .update(lists)
      .set({ name: input.name, updatedAt: new Date() })
      .where(and(eq(lists.id, input.listId), eq(lists.boardId, ctx.board.id)));

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      actorId: ctx.user.id,
      type: "list.renamed",
      data: {
        listId: input.listId,
        from: previous.name,
        to: input.name,
        ...sourceData(source),
      },
    });
  });

  return { boardId: ctx.board.id };
}

/**
 * Archive a list (soft delete). Its cards stay in the database and come back
 * with the list if it is restored.
 */
export async function archiveList(
  input: { listId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await requireListAccess(input.listId, "member", actor);

  await db.transaction(async (tx) => {
    const [list] = await tx
      .select({ name: lists.name })
      .from(lists)
      .where(
        and(eq(lists.id, input.listId), eq(lists.boardId, ctx.board.id)),
      )
      .limit(1);

    if (!list) throw new AuthorizationError();

    await tx
      .update(lists)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(lists.id, input.listId), eq(lists.boardId, ctx.board.id)));

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      actorId: ctx.user.id,
      type: "list.archived",
      data: { listId: input.listId, name: list.name, ...sourceData(source) },
    });
  });

  return { boardId: ctx.board.id };
}

/**
 * Restore an archived list.
 *
 * The list keeps its old `position`, so it reappears where it was rather than
 * at the end — fractional keys make that free, there is nothing to renumber.
 * Cards inside it that were archived individually stay archived; only the
 * list's own `archived_at` is cleared.
 */
export async function restoreList(
  input: { listId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await requireListAccess(input.listId, "member", actor);

  await db.transaction(async (tx) => {
    const [list] = await tx
      .select({ name: lists.name, archivedAt: lists.archivedAt })
      .from(lists)
      .where(
        and(eq(lists.id, input.listId), eq(lists.boardId, ctx.board.id)),
      )
      .limit(1);

    if (!list) throw new AuthorizationError();
    if (!list.archivedAt) return;

    await tx
      .update(lists)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(lists.id, input.listId), eq(lists.boardId, ctx.board.id)));

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      actorId: ctx.user.id,
      type: "list.restored",
      data: { listId: input.listId, name: list.name, ...sourceData(source) },
    });
  });

  return { boardId: ctx.board.id };
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

export async function createCard(
  input: { listId: string; title: string; description?: string | null },
  { actor, source }: OpContext = {},
): Promise<{ cardId: string; boardId: string }> {
  const ctx = await requireListAccess(input.listId, "member", actor);

  const cardId = await db.transaction(async (tx) => {
    const [list] = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(
        and(
          eq(lists.id, input.listId),
          eq(lists.boardId, ctx.board.id),
          isNull(lists.archivedAt),
        ),
      )
      .limit(1);

    if (!list) throw new AuthorizationError();

    const [last] = await tx
      .select({ position: cards.position })
      .from(cards)
      .where(and(eq(cards.listId, input.listId), isNull(cards.archivedAt)))
      .orderBy(desc(cards.position))
      .limit(1);

    const [card] = await tx
      .insert(cards)
      .values({
        listId: input.listId,
        boardId: ctx.board.id,
        title: input.title,
        description: input.description ?? null,
        position: generateKeyBetween(last?.position ?? null, null),
        createdBy: ctx.user.id,
      })
      .returning({ id: cards.id });

    // Creating a card is interest: the author follows it from now on. The
    // watcher row is the *only* record of that — nothing unions `created_by`
    // back in — so unwatching later actually silences the card.
    await watch(tx, card.id, ctx.user.id);

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: card.id,
      actorId: ctx.user.id,
      type: "card.created",
      data: {
        title: input.title,
        listId: input.listId,
        ...sourceData(source),
      },
    });

    return card.id;
  });

  return { cardId, boardId: ctx.board.id };
}

export async function updateCard(
  input: {
    cardId: string;
    title?: string;
    description?: string | null;
    dueDate?: Date | null;
  },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.dueDate !== undefined) {
    patch.dueDate = input.dueDate;
    // Moving a deadline re-arms the reminder: the card becomes eligible for
    // the due-date cron again rather than staying silent because it was
    // announced against the *old* date.
    patch.dueRemindedAt = null;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(cards)
      .set(patch)
      .where(
        and(eq(cards.id, input.cardId), eq(cards.boardId, ctx.board.id)),
      );

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: input.cardId,
      actorId: ctx.user.id,
      type: "card.updated",
      data: {
        fields: Object.keys(patch).filter(
          (k) => k !== "updatedAt" && k !== "dueRemindedAt",
        ),
        ...sourceData(source),
      },
    });
  });

  return { boardId: ctx.board.id };
}

export async function archiveCard(
  input: { cardId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  await db.transaction(async (tx) => {
    const [card] = await tx
      .select({ title: cards.title })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.boardId, ctx.board.id)))
      .limit(1);

    if (!card) throw new AuthorizationError();

    await tx
      .update(cards)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(cards.id, input.cardId));

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: input.cardId,
      actorId: ctx.user.id,
      type: "card.archived",
      data: { title: card.title, ...sourceData(source) },
    });
  });

  return { boardId: ctx.board.id };
}

/**
 * Un-archive a card.
 *
 * If the list it belonged to has since been archived the card is pulled back
 * to the board's first live list, because restoring something into an
 * invisible list is indistinguishable from the restore having failed. When
 * that happens the card is also re-placed at the bottom of its new home, since
 * its old fractional key means nothing there.
 */
export async function restoreCard(
  input: { cardId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; listId: string }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  const listId = await db.transaction(async (tx) => {
    const [card] = await tx
      .select({
        title: cards.title,
        listId: cards.listId,
        archivedAt: cards.archivedAt,
      })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.boardId, ctx.board.id)))
      .limit(1);

    if (!card) throw new AuthorizationError();

    const [liveList] = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(and(eq(lists.id, card.listId), isNull(lists.archivedAt)))
      .limit(1);

    let targetListId = liveList?.id ?? null;
    const patch: Record<string, unknown> = {
      archivedAt: null,
      updatedAt: new Date(),
    };

    if (!targetListId) {
      const [fallback] = await tx
        .select({ id: lists.id })
        .from(lists)
        .where(and(eq(lists.boardId, ctx.board.id), isNull(lists.archivedAt)))
        .orderBy(asc(lists.position))
        .limit(1);

      if (!fallback) {
        throw new AuthorizationError(
          "This board has no active list to restore the card into.",
        );
      }

      const [last] = await tx
        .select({ position: cards.position })
        .from(cards)
        .where(and(eq(cards.listId, fallback.id), isNull(cards.archivedAt)))
        .orderBy(desc(cards.position))
        .limit(1);

      targetListId = fallback.id;
      patch.listId = fallback.id;
      patch.position = generateKeyBetween(last?.position ?? null, null);
    }

    await tx.update(cards).set(patch).where(eq(cards.id, input.cardId));

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: input.cardId,
      actorId: ctx.user.id,
      type: "card.restored",
      data: {
        title: card.title,
        listId: targetListId,
        relocated: targetListId !== card.listId,
        ...sourceData(source),
      },
    });

    return targetListId;
  });

  return { boardId: ctx.board.id, listId };
}

/**
 * Everything archived on a board: archived lists, and archived cards with the
 * name of the list they came from.
 *
 * The board is authorised once at the read floor and every row is scoped to
 * it, so this cannot be used to page through someone else's archive.
 */
export async function listArchivedItems(boardId: string, actor?: Actor) {
  const ctx = await requireBoardAccess(boardId, READ_MIN_ROLE, actor);

  const [archivedLists, archivedCards] = await Promise.all([
    db
      .select({
        id: lists.id,
        name: lists.name,
        archivedAt: lists.archivedAt,
      })
      .from(lists)
      .where(and(eq(lists.boardId, ctx.board.id), isNotNull(lists.archivedAt)))
      .orderBy(desc(lists.archivedAt)),
    db
      .select({
        id: cards.id,
        title: cards.title,
        archivedAt: cards.archivedAt,
        listId: cards.listId,
        listName: lists.name,
      })
      .from(cards)
      .innerJoin(lists, eq(lists.id, cards.listId))
      .where(and(eq(cards.boardId, ctx.board.id), isNotNull(cards.archivedAt)))
      .orderBy(desc(cards.archivedAt)),
  ]);

  return { ...ctx, lists: archivedLists, cards: archivedCards };
}

/**
 * Move a card. Neighbour ids only — the fractional index is computed here from
 * rows re-read inside the transaction, and `placeBetween` rebalances when the
 * neighbours are unusable.
 */
export async function moveCard(
  input: {
    cardId: string;
    targetListId: string;
    afterCardId?: string | null;
    beforeCardId?: string | null;
  },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  await db.transaction(async (tx) => {
    const [targetList] = await tx
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(
        and(
          eq(lists.id, input.targetListId),
          eq(lists.boardId, ctx.board.id),
          isNull(lists.archivedAt),
        ),
      )
      .limit(1);

    if (!targetList) throw new AuthorizationError();

    const [card] = await tx
      .select({ id: cards.id, listId: cards.listId, title: cards.title })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.boardId, ctx.board.id)))
      .limit(1);

    if (!card) throw new AuthorizationError();

    const siblings = await tx
      .select({ id: cards.id, position: cards.position })
      .from(cards)
      .where(
        and(
          eq(cards.listId, input.targetListId),
          isNull(cards.archivedAt),
          ne(cards.id, input.cardId),
        ),
      )
      .orderBy(asc(cards.position));

    const siblingIds = new Set(siblings.map((s) => s.id));
    const afterId =
      input.afterCardId && siblingIds.has(input.afterCardId)
        ? input.afterCardId
        : null;
    const beforeId =
      input.beforeCardId && siblingIds.has(input.beforeCardId)
        ? input.beforeCardId
        : null;

    if (
      (input.afterCardId && !afterId) ||
      (input.beforeCardId && !beforeId)
    ) {
      throw new AuthorizationError(
        "That card moved somewhere else. Refresh and try again.",
      );
    }

    const placement = placeBetween(siblings, afterId, beforeId);

    for (const row of placement.rebalanced) {
      await tx
        .update(cards)
        .set({ position: row.position })
        .where(eq(cards.id, row.id));
    }

    await tx
      .update(cards)
      .set({
        listId: input.targetListId,
        position: placement.position,
        updatedAt: new Date(),
      })
      .where(eq(cards.id, input.cardId));

    const crossList = card.listId !== input.targetListId;
    let fromListName: string | null = null;
    if (crossList) {
      const [fromList] = await tx
        .select({ name: lists.name })
        .from(lists)
        .where(eq(lists.id, card.listId))
        .limit(1);
      fromListName = fromList?.name ?? null;
    }

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: card.id,
      actorId: ctx.user.id,
      type: crossList ? "card.moved" : "card.reordered",
      data: {
        title: card.title,
        ...(crossList
          ? {
              fromListId: card.listId,
              fromListName,
              toListId: targetList.id,
              toListName: targetList.name,
            }
          : { listId: targetList.id, listName: targetList.name }),
        rebalanced: placement.rebalanced.length,
        ...sourceData(source),
      },
    });
  });

  return { boardId: ctx.board.id };
}

/**
 * Resolve MCP's friendly placement vocabulary into neighbour ids.
 * `'top'` / `'bottom'` / `{ afterCardId }` — computed against the destination
 * list as it exists right now.
 */
export async function resolvePlacement(
  targetListId: string,
  placement: "top" | "bottom" | { afterCardId: string },
  movingCardId: string,
): Promise<{ afterCardId: string | null; beforeCardId: string | null }> {
  const siblings = await db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.listId, targetListId),
        isNull(cards.archivedAt),
        ne(cards.id, movingCardId),
      ),
    )
    .orderBy(asc(cards.position));

  if (siblings.length === 0) {
    return { afterCardId: null, beforeCardId: null };
  }
  if (placement === "top") {
    return { afterCardId: null, beforeCardId: siblings[0].id };
  }
  if (placement === "bottom") {
    return { afterCardId: siblings[siblings.length - 1].id, beforeCardId: null };
  }

  const index = siblings.findIndex((s) => s.id === placement.afterCardId);
  if (index === -1) {
    throw new AuthorizationError(
      "The card named in `after_card_id` is not in the destination list.",
    );
  }
  return {
    afterCardId: siblings[index].id,
    beforeCardId: index + 1 < siblings.length ? siblings[index + 1].id : null,
  };
}

/**
 * Move a card to a list on a *different* board.
 *
 * Both ends are authorised independently — read access to the card is not
 * permission to write to wherever it is going — and the card's denormalised
 * `board_id` is rewritten alongside `list_id`, because the two must never
 * disagree.
 *
 * Three things are deliberately dropped rather than carried across:
 *
 * - **labels**, which belong to a board; a label id from the old board is
 *   meaningless on the new one and keeping the join row would leave a card
 *   wearing a label its board does not have;
 * - **assignees** who are not members of the destination workspace, so work is
 *   never parked on someone who cannot see it;
 * - **watchers** in the same position, who would otherwise keep receiving
 *   notifications about a card they can no longer open.
 *
 * The move is recorded on both boards' histories, so neither side has a
 * card silently appear or vanish.
 */
export async function moveCardToBoard(
  input: { cardId: string; targetListId: string },
  { actor, source }: OpContext = {},
): Promise<{ fromBoardId: string; boardId: string; listId: string }> {
  const from = await requireCardAccess(input.cardId, "member", actor);
  const to = await requireListAccess(input.targetListId, "member", actor);

  await db.transaction(async (tx) => {
    const [card] = await tx
      .select({ title: cards.title, listId: cards.listId })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.boardId, from.board.id)))
      .limit(1);

    if (!card) throw new AuthorizationError();

    const [targetList] = await tx
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(
        and(
          eq(lists.id, input.targetListId),
          eq(lists.boardId, to.board.id),
          isNull(lists.archivedAt),
        ),
      )
      .limit(1);

    if (!targetList) throw new AuthorizationError();

    const [last] = await tx
      .select({ position: cards.position })
      .from(cards)
      .where(
        and(
          eq(cards.listId, input.targetListId),
          isNull(cards.archivedAt),
          ne(cards.id, input.cardId),
        ),
      )
      .orderBy(desc(cards.position))
      .limit(1);

    await tx
      .update(cards)
      .set({
        listId: targetList.id,
        boardId: to.board.id,
        position: generateKeyBetween(last?.position ?? null, null),
        updatedAt: new Date(),
      })
      .where(eq(cards.id, input.cardId));

    // Labels are board-scoped: drop every attachment that does not exist on
    // the destination board. A same-board move leaves them all in place.
    const keepLabelIds = (
      await tx
        .select({ id: labels.id })
        .from(labels)
        .where(eq(labels.boardId, to.board.id))
    ).map((l) => l.id);

    await tx
      .delete(cardLabels)
      .where(
        and(
          eq(cardLabels.cardId, input.cardId),
          keepLabelIds.length > 0
            ? not(inArray(cardLabels.labelId, keepLabelIds))
            : undefined,
        ),
      );

    if (to.workspace.id !== from.workspace.id) {
      const memberIds = (
        await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, to.workspace.id))
      ).map((m) => m.userId);

      await tx
        .delete(cardAssignees)
        .where(
          and(
            eq(cardAssignees.cardId, input.cardId),
            memberIds.length > 0
              ? not(inArray(cardAssignees.userId, memberIds))
              : undefined,
          ),
        );

      await tx
        .delete(cardWatchers)
        .where(
          and(
            eq(cardWatchers.cardId, input.cardId),
            memberIds.length > 0
              ? not(inArray(cardWatchers.userId, memberIds))
              : undefined,
          ),
        );
    }

    await touchBoard(tx, from.board.id);
    await touchBoard(tx, to.board.id);

    const data = {
      title: card.title,
      fromBoardId: from.board.id,
      fromBoardName: from.board.name,
      fromListId: card.listId,
      toBoardId: to.board.id,
      toBoardName: to.board.name,
      toListId: targetList.id,
      toListName: targetList.name,
      ...sourceData(source),
    };

    await recordActivity(tx, {
      workspaceId: from.workspace.id,
      boardId: from.board.id,
      cardId: input.cardId,
      actorId: from.user.id,
      type: "card.moved_out",
      data,
    });

    await recordActivity(tx, {
      workspaceId: to.workspace.id,
      boardId: to.board.id,
      cardId: input.cardId,
      actorId: from.user.id,
      type: "card.moved_in",
      data,
    });
  });

  return {
    fromBoardId: from.board.id,
    boardId: to.board.id,
    listId: input.targetListId,
  };
}

/**
 * Duplicate a card into a list, which may be on another board.
 *
 * Copies what describes the work — title, description, due date, checklists
 * and their items — and, when the destination is the *same* board, its labels.
 * Comments and assignees are not copied: a comment is a statement someone made
 * at a point in time and duplicating it puts words in their mouth, and an
 * assignment is a commitment that has to be made again.
 */
export async function copyCard(
  input: { cardId: string; targetListId: string; title?: string },
  { actor, source }: OpContext = {},
): Promise<{ cardId: string; boardId: string; listId: string }> {
  const from = await requireCardAccess(input.cardId, "member", actor);
  const to = await requireListAccess(input.targetListId, "member", actor);

  const newCardId = await db.transaction(async (tx) => {
    const [card] = await tx
      .select({
        title: cards.title,
        description: cards.description,
        dueDate: cards.dueDate,
      })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.boardId, from.board.id)))
      .limit(1);

    if (!card) throw new AuthorizationError();

    const [targetList] = await tx
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(
        and(
          eq(lists.id, input.targetListId),
          eq(lists.boardId, to.board.id),
          isNull(lists.archivedAt),
        ),
      )
      .limit(1);

    if (!targetList) throw new AuthorizationError();

    const [last] = await tx
      .select({ position: cards.position })
      .from(cards)
      .where(
        and(eq(cards.listId, input.targetListId), isNull(cards.archivedAt)),
      )
      .orderBy(desc(cards.position))
      .limit(1);

    const [copy] = await tx
      .insert(cards)
      .values({
        listId: targetList.id,
        boardId: to.board.id,
        title: input.title?.trim() || card.title,
        description: card.description,
        dueDate: card.dueDate,
        position: generateKeyBetween(last?.position ?? null, null),
        createdBy: from.user.id,
      })
      .returning({ id: cards.id });

    // Labels only survive a copy within the same board — see moveCardToBoard.
    if (to.board.id === from.board.id) {
      const attached = await tx
        .select({ labelId: cardLabels.labelId })
        .from(cardLabels)
        .where(eq(cardLabels.cardId, input.cardId));

      if (attached.length > 0) {
        await tx
          .insert(cardLabels)
          .values(attached.map((a) => ({ cardId: copy.id, labelId: a.labelId })))
          .onConflictDoNothing();
      }
    }

    const sourceChecklists = await tx
      .select({
        id: checklists.id,
        title: checklists.title,
        position: checklists.position,
      })
      .from(checklists)
      .where(eq(checklists.cardId, input.cardId))
      .orderBy(asc(checklists.position));

    for (const sourceChecklist of sourceChecklists) {
      const [checklistCopy] = await tx
        .insert(checklists)
        .values({
          cardId: copy.id,
          title: sourceChecklist.title,
          // Positions carry over verbatim: the copy is a fresh container, so
          // the source's keys are already in the right order within it.
          position: sourceChecklist.position,
        })
        .returning({ id: checklists.id });

      const items = await tx
        .select({
          content: checklistItems.content,
          completed: checklistItems.completed,
          position: checklistItems.position,
        })
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, sourceChecklist.id))
        .orderBy(asc(checklistItems.position));

      if (items.length > 0) {
        await tx.insert(checklistItems).values(
          items.map((item) => ({
            checklistId: checklistCopy.id,
            content: item.content,
            completed: item.completed,
            position: item.position,
          })),
        );
      }
    }

    await touchBoard(tx, to.board.id);

    await recordActivity(tx, {
      workspaceId: to.workspace.id,
      boardId: to.board.id,
      cardId: copy.id,
      actorId: from.user.id,
      type: "card.copied",
      data: {
        title: input.title?.trim() || card.title,
        sourceCardId: input.cardId,
        sourceBoardId: from.board.id,
        listId: targetList.id,
        listName: targetList.name,
        ...sourceData(source),
      },
    });

    return copy.id;
  });

  return {
    cardId: newCardId,
    boardId: to.board.id,
    listId: input.targetListId,
  };
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

export async function addComment(
  input: { cardId: string; body: string },
  { actor, source }: OpContext = {},
): Promise<{ commentId: string; boardId: string }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  const commentId = await db.transaction(async (tx) => {
    const [comment] = await tx
      .insert(comments)
      .values({
        cardId: input.cardId,
        authorId: ctx.user.id,
        body: input.body,
      })
      .returning({ id: comments.id });

    // Commenting is interest: the author follows the card from now on.
    await watch(tx, input.cardId, ctx.user.id);

    const [card] = await tx
      .select({ title: cards.title })
      .from(cards)
      .where(eq(cards.id, input.cardId))
      .limit(1);

    const payload = {
      cardId: input.cardId,
      cardTitle: card?.title ?? null,
      commentId: comment.id,
      boardId: ctx.board.id,
      boardName: ctx.board.name,
    };

    // Mentions win over the generic "commented" notification, so being named
    // in a comment never arrives as two rows.
    const mentioned = await resolveCommentMentions(
      tx,
      ctx.workspace.id,
      input.body,
    );
    for (const userId of mentioned) {
      await notify(tx, {
        userId,
        actorId: ctx.user.id,
        type: "card.mentioned",
        data: payload,
      });
    }

    const interested = await interestedInCard(
      tx,
      input.cardId,
      ctx.workspace.id,
    );
    for (const userId of interested) {
      if (mentioned.includes(userId)) continue;
      await notify(tx, {
        userId,
        actorId: ctx.user.id,
        type: "card.commented",
        data: payload,
      });
    }

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: input.cardId,
      actorId: ctx.user.id,
      type: "comment.created",
      data: { commentId: comment.id, ...sourceData(source) },
    });

    return comment.id;
  });

  return { commentId, boardId: ctx.board.id };
}

/**
 * Edit a comment's body.
 *
 * Authorship is the permission: only the author may rewrite their own words.
 * A workspace admin or owner may also act, because moderation has to be
 * possible — but they *edit*, they do not impersonate, and the activity entry
 * records who actually did it.
 */
export async function updateComment(
  input: { commentId: string; body: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; cardId: string }> {
  const { ctx, cardId, authorId } = await authorizeComment(
    input.commentId,
    actor,
  );

  await db.transaction(async (tx) => {
    await tx
      .update(comments)
      .set({ body: input.body, editedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, input.commentId));

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId,
      actorId: ctx.user.id,
      type: "comment.updated",
      data: {
        commentId: input.commentId,
        authorId,
        ...sourceData(source),
      },
    });
  });

  return { boardId: ctx.board.id, cardId };
}

/** Delete a comment outright. Same author-or-moderator rule as updateComment. */
export async function deleteComment(
  input: { commentId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; cardId: string }> {
  const { ctx, cardId, authorId } = await authorizeComment(
    input.commentId,
    actor,
  );

  await db.transaction(async (tx) => {
    await tx.delete(comments).where(eq(comments.id, input.commentId));

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId,
      actorId: ctx.user.id,
      type: "comment.deleted",
      data: {
        commentId: input.commentId,
        authorId,
        ...sourceData(source),
      },
    });
  });

  return { boardId: ctx.board.id, cardId };
}

/**
 * Resolve a comment to its card, authorise the card, then apply the
 * author-or-moderator rule.
 *
 * The comment id alone is never trusted: the card it hangs off is what carries
 * the membership check, and a comment on a card the caller cannot see simply
 * does not come back.
 */
async function authorizeComment(commentId: string, actor?: Actor) {
  const [row] = await db
    .select({ cardId: comments.cardId, authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  if (!row) throw new AuthorizationError();

  const ctx = await requireCardAccess(row.cardId, "member", actor);

  const isAuthor = row.authorId !== null && row.authorId === ctx.user.id;
  const isModerator = ctx.role === "admin" || ctx.role === "owner";
  if (!isAuthor && !isModerator) {
    throw new AuthorizationError("You can only change your own comments.");
  }

  return { ctx, cardId: row.cardId, authorId: row.authorId };
}

/**
 * Workspace members named in a comment body.
 *
 * The candidate set is the workspace's membership, so a mention can only ever
 * reach someone who already has access to the card — a comment is not a way to
 * notify a stranger. Skipped entirely when the body has no `@` at all.
 */
async function resolveCommentMentions(
  tx: Tx,
  workspaceId: string,
  body: string,
): Promise<string[]> {
  if (!body.includes("@")) return [];

  const candidates = await tx
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  return resolveMentions(body, candidates);
}

/**
 * Everyone who should hear about activity on a card.
 *
 * `card_watchers` is the single source of truth: creating a card, being
 * assigned one and commenting on one all insert a watcher row, so the set is
 * complete — and `unwatchCard` deleting that row actually silences the card,
 * which it could not do while creators and assignees were unioned in here.
 *
 * Every candidate is joined through `workspace_members` **in SQL**, so a
 * notification can only reach somebody who could still open the card: a
 * removed member stops hearing about it even though their watcher row
 * survives.
 */
async function interestedInCard(
  tx: Tx,
  cardId: string,
  workspaceId: string,
): Promise<string[]> {
  const watcherRows = await tx
    .select({ userId: cardWatchers.userId })
    .from(cardWatchers)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, cardWatchers.userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .where(eq(cardWatchers.cardId, cardId));

  return [...new Set(watcherRows.map((row) => row.userId))];
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getCardDetail(cardId: string, actor?: Actor) {
  const ctx = await requireCardAccess(cardId, READ_MIN_ROLE, actor);

  const [card] = await db
    .select({
      id: cards.id,
      title: cards.title,
      description: cards.description,
      dueDate: cards.dueDate,
      archivedAt: cards.archivedAt,
      createdAt: cards.createdAt,
      listId: cards.listId,
      listName: lists.name,
    })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .where(and(eq(cards.id, cardId), eq(cards.boardId, ctx.board.id)))
    .limit(1);

  if (!card) throw new AuthorizationError();

  const [cardComments, cardAssigneeRows, watcherRows] = await Promise.all([
    db
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        editedAt: comments.editedAt,
        authorId: comments.authorId,
        authorName: users.name,
        authorImage: users.image,
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.cardId, cardId))
      .orderBy(asc(comments.createdAt)),
    db
      .select({ userId: users.id, name: users.name, image: users.image })
      .from(cardAssignees)
      .innerJoin(users, eq(users.id, cardAssignees.userId))
      .where(eq(cardAssignees.cardId, cardId)),
    db
      .select({ userId: users.id, name: users.name, image: users.image })
      .from(cardWatchers)
      .innerJoin(users, eq(users.id, cardWatchers.userId))
      .where(eq(cardWatchers.cardId, cardId))
      .orderBy(asc(users.name)),
  ]);

  return {
    ...ctx,
    card,
    comments: cardComments.map((c) => ({
      ...c,
      // Whether *this* caller may edit or delete it, decided by the same rule
      // the mutation enforces, so the UI cannot offer an action the server
      // will refuse.
      canModify:
        (c.authorId !== null && c.authorId === ctx.user.id) ||
        ctx.role === "admin" ||
        ctx.role === "owner",
    })),
    assignees: cardAssigneeRows,
    watchers: watcherRows,
    watching: watcherRows.some((w) => w.userId === ctx.user.id),
  };
}

/* -------------------------------------------------------------------------- */
/* Watchers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Follow a card.
 *
 * Authorised at the *read* floor, deliberately: this writes one row keyed to
 * the caller themselves and changes nothing anybody else can see, so a viewer
 * who may read the board may also subscribe to it. For the same reason it
 * neither touches `boards.updated_at` nor writes an activity entry — a private
 * subscription is not board history, and broadcasting it would be noise in
 * everyone else's feed.
 */
export async function watchCard(
  input: { cardId: string },
  { actor }: OpContext = {},
): Promise<{ boardId: string; watching: boolean }> {
  const ctx = await requireCardAccess(input.cardId, READ_MIN_ROLE, actor);

  await db
    .insert(cardWatchers)
    .values({ cardId: input.cardId, userId: ctx.user.id })
    .onConflictDoNothing();

  return { boardId: ctx.board.id, watching: true };
}

/** Stop following a card. Idempotent. */
export async function unwatchCard(
  input: { cardId: string },
  { actor }: OpContext = {},
): Promise<{ boardId: string; watching: boolean }> {
  const ctx = await requireCardAccess(input.cardId, READ_MIN_ROLE, actor);

  await db
    .delete(cardWatchers)
    .where(
      and(
        eq(cardWatchers.cardId, input.cardId),
        eq(cardWatchers.userId, ctx.user.id),
      ),
    );

  return { boardId: ctx.board.id, watching: false };
}

/**
 * Case-insensitive substring search over card titles and descriptions, scoped
 * to the caller's memberships in SQL. ILIKE rather than a tsvector index for
 * now — correct and simple; a GIN full-text index is the upgrade when boards
 * get large.
 */
export async function searchCards(
  input: { query: string; workspaceId?: string | null; limit?: number },
  actor?: Actor,
) {
  const user = actor ?? (await requireUser());
  const pattern = `%${input.query.replace(/[%_\\]/g, "\\$&")}%`;

  const conditions = [
    isNull(cards.archivedAt),
    // A card in an archived list is archived in every way that matters to a
    // reader, so it must not surface as a hit.
    isNull(lists.archivedAt),
    isNull(boards.archivedAt),
    or(ilike(cards.title, pattern), ilike(cards.description, pattern)),
  ];
  if (input.workspaceId) {
    conditions.push(eq(boards.workspaceId, input.workspaceId));
  }

  return db
    .select({
      cardId: cards.id,
      title: cards.title,
      listName: lists.name,
      boardId: boards.id,
      boardName: boards.name,
      workspaceName: workspaces.name,
      dueDate: cards.dueDate,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, boards.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(cards.updatedAt))
    .limit(Math.min(input.limit ?? 25, 100));
}

/** Board with lists and cards, for MCP's `get_board`. */
export async function getBoardStructure(boardId: string, actor?: Actor) {
  const ctx = await requireBoardAccess(boardId, READ_MIN_ROLE, actor);

  const [listRows, cardRows] = await Promise.all([
    db
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(and(eq(lists.boardId, ctx.board.id), isNull(lists.archivedAt)))
      .orderBy(asc(lists.position)),
    db
      .select({
        id: cards.id,
        listId: cards.listId,
        title: cards.title,
        description: cards.description,
        dueDate: cards.dueDate,
      })
      .from(cards)
      .where(and(eq(cards.boardId, ctx.board.id), isNull(cards.archivedAt)))
      .orderBy(asc(cards.position)),
  ]);

  const byList = new Map<string, typeof cardRows>();
  for (const card of cardRows) {
    const bucket = byList.get(card.listId) ?? [];
    bucket.push(card);
    byList.set(card.listId, bucket);
  }

  const assignees = await assigneesForBoard(ctx.board.id);

  return {
    ...ctx,
    lists: listRows.map((list) => ({
      ...list,
      cards: (byList.get(list.id) ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        dueDate: c.dueDate,
        assignees: assignees.get(c.id) ?? [],
      })),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Assignees                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Assign a card to a workspace member.
 *
 * The assignee must themselves be a member of the card's workspace at
 * `member` or above — you cannot park work on an outsider, and viewers cannot
 * own work. Idempotent: assigning twice is a no-op and does not re-notify.
 */
export async function assignCard(
  input: { cardId: string; userId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; alreadyAssigned: boolean }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  const alreadyAssigned = await db.transaction(async (tx) => {
    // Membership of the *assignee* is checked in SQL against this workspace.
    const [member] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ctx.workspace.id),
          eq(workspaceMembers.userId, input.userId),
        ),
      )
      .limit(1);

    if (!member) {
      throw new AuthorizationError(
        "That person is not a member of this workspace.",
      );
    }
    if (member.role === "viewer") {
      throw new AuthorizationError("Viewers cannot be assigned cards.");
    }

    const [existing] = await tx
      .select({ cardId: cardAssignees.cardId })
      .from(cardAssignees)
      .where(
        and(
          eq(cardAssignees.cardId, input.cardId),
          eq(cardAssignees.userId, input.userId),
        ),
      )
      .limit(1);

    if (existing) return true;

    await tx
      .insert(cardAssignees)
      .values({ cardId: input.cardId, userId: input.userId });

    // Being given a card implies wanting to hear about it. Unassigning later
    // does not unwatch — interest outlives responsibility.
    await watch(tx, input.cardId, input.userId);

    const [card] = await tx
      .select({ title: cards.title })
      .from(cards)
      .where(eq(cards.id, input.cardId))
      .limit(1);

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: input.cardId,
      actorId: ctx.user.id,
      type: "card.assigned",
      data: {
        userId: input.userId,
        title: card?.title ?? null,
        ...sourceData(source),
      },
    });

    // `notify` drops self-directed events, so assigning to yourself is silent.
    await notify(tx, {
      userId: input.userId,
      actorId: ctx.user.id,
      type: "card.assigned",
      data: {
        cardId: input.cardId,
        cardTitle: card?.title ?? null,
        boardId: ctx.board.id,
        boardName: ctx.board.name,
      },
    });

    return false;
  });

  return { boardId: ctx.board.id, alreadyAssigned };
}

export async function unassignCard(
  input: { cardId: string; userId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(cardAssignees)
      .where(
        and(
          eq(cardAssignees.cardId, input.cardId),
          eq(cardAssignees.userId, input.userId),
        ),
      )
      .returning({ cardId: cardAssignees.cardId });

    if (removed.length === 0) return;

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: input.cardId,
      actorId: ctx.user.id,
      type: "card.unassigned",
      data: { userId: input.userId, ...sourceData(source) },
    });
  });

  return { boardId: ctx.board.id };
}

/** Assignees for every card on a board, keyed by card id. */
export async function assigneesForBoard(boardId: string) {
  const rows = await db
    .select({
      cardId: cardAssignees.cardId,
      userId: users.id,
      name: users.name,
      image: users.image,
    })
    .from(cardAssignees)
    .innerJoin(cards, eq(cards.id, cardAssignees.cardId))
    .innerJoin(users, eq(users.id, cardAssignees.userId))
    .where(eq(cards.boardId, boardId));

  const byCard = new Map<
    string,
    { userId: string; name: string; image: string | null }[]
  >();
  for (const row of rows) {
    const bucket = byCard.get(row.cardId) ?? [];
    bucket.push({ userId: row.userId, name: row.name, image: row.image });
    byCard.set(row.cardId, bucket);
  }
  return byCard;
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Create a label on a board.
 *
 * Labels belong to a board, so the board is authorised and the new row's
 * `board_id` comes from the authorised context — never from the client.
 */
export async function createLabel(
  input: { boardId: string; name: string; color: string },
  { actor, source }: OpContext = {},
): Promise<{ labelId: string }> {
  const ctx = await requireBoardAccess(input.boardId, "member", actor);

  const labelId = await db.transaction(async (tx) => {
    const [label] = await tx
      .insert(labels)
      .values({
        boardId: ctx.board.id,
        name: input.name,
        color: input.color,
      })
      .returning({ id: labels.id });

    await touchBoard(tx, ctx.board.id);
    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      actorId: ctx.user.id,
      type: "label.created",
      data: { labelId: label.id, name: input.name, ...sourceData(source) },
    });

    return label.id;
  });

  return { labelId };
}

/**
 * Resolve a label to its board and authorise it.
 *
 * The board is what carries the membership check; a label id from a board the
 * caller has no access to simply does not come back, and a label id from a
 * *different* board they do belong to still fails every caller's own
 * `board_id` check downstream.
 */
async function authorizeLabel(labelId: string, actor?: Actor) {
  const [row] = await db
    .select({ boardId: labels.boardId })
    .from(labels)
    .where(eq(labels.id, labelId))
    .limit(1);

  if (!row) throw new AuthorizationError();
  const ctx = await requireBoardAccess(row.boardId, "member", actor);
  return ctx;
}

/** Rename or recolour a board label. Omitted fields are left alone. */
export async function updateLabel(
  input: { labelId: string; name?: string; color?: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await authorizeLabel(input.labelId, actor);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color;
  if (Object.keys(patch).length === 0) return { boardId: ctx.board.id };

  await db.transaction(async (tx) => {
    await tx
      .update(labels)
      .set(patch)
      .where(
        and(eq(labels.id, input.labelId), eq(labels.boardId, ctx.board.id)),
      );

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      actorId: ctx.user.id,
      type: "label.updated",
      data: { labelId: input.labelId, ...patch, ...sourceData(source) },
    });
  });

  return { boardId: ctx.board.id };
}

/**
 * Delete a board label.
 *
 * A hard delete, not a soft one: a label carries no history of its own, and
 * the `card_labels` rows go with it through the FK cascade. The count of cards
 * that lose it is recorded so the activity feed can say how wide the blast
 * radius was.
 */
export async function deleteLabel(
  input: { labelId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; detached: number }> {
  const ctx = await authorizeLabel(input.labelId, actor);

  const detached = await db.transaction(async (tx) => {
    const [label] = await tx
      .select({ name: labels.name, color: labels.color })
      .from(labels)
      .where(
        and(eq(labels.id, input.labelId), eq(labels.boardId, ctx.board.id)),
      )
      .limit(1);

    if (!label) throw new AuthorizationError();

    const removed = await tx
      .delete(cardLabels)
      .where(eq(cardLabels.labelId, input.labelId))
      .returning({ cardId: cardLabels.cardId });

    await tx
      .delete(labels)
      .where(
        and(eq(labels.id, input.labelId), eq(labels.boardId, ctx.board.id)),
      );

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      actorId: ctx.user.id,
      type: "label.deleted",
      data: {
        labelId: input.labelId,
        name: label.name,
        detached: removed.length,
        ...sourceData(source),
      },
    });

    return removed.length;
  });

  return { boardId: ctx.board.id, detached };
}

/** Every label defined on a board, in creation order. */
export async function listLabels(boardId: string, actor?: Actor) {
  const ctx = await requireBoardAccess(boardId, READ_MIN_ROLE, actor);

  return labelVocabularyForBoard(ctx.board.id);
}

/**
 * The same read without the membership check, for callers already inside an
 * authorised board context — the board page has one, and re-running
 * `requireBoardAccess` there would pay for the membership join twice.
 */
export async function labelVocabularyForBoard(boardId: string) {
  return db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .where(eq(labels.boardId, boardId))
    .orderBy(asc(labels.createdAt));
}

/**
 * Attach or detach a board label on a card.
 *
 * The label must belong to the *same board* as the card. That check is what
 * stops a caller pasting a label id from another board they happen to be a
 * member of onto this card.
 */
export async function setCardLabel(
  input: { cardId: string; labelId: string; attached: boolean },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  await db.transaction(async (tx) => {
    const [label] = await tx
      .select({ id: labels.id, name: labels.name })
      .from(labels)
      .where(
        and(eq(labels.id, input.labelId), eq(labels.boardId, ctx.board.id)),
      )
      .limit(1);

    if (!label) {
      throw new AuthorizationError("That label does not belong to this board.");
    }

    if (input.attached) {
      await tx
        .insert(cardLabels)
        .values({ cardId: input.cardId, labelId: input.labelId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(cardLabels)
        .where(
          and(
            eq(cardLabels.cardId, input.cardId),
            eq(cardLabels.labelId, input.labelId),
          ),
        );
    }

    await touchBoard(tx, ctx.board.id);
    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: input.cardId,
      actorId: ctx.user.id,
      type: input.attached ? "card.labelled" : "card.unlabelled",
      data: { labelId: input.labelId, name: label.name, ...sourceData(source) },
    });
  });

  return { boardId: ctx.board.id };
}

/* -------------------------------------------------------------------------- */
/* Checklists                                                                 */
/* -------------------------------------------------------------------------- */

export async function createChecklist(
  input: { cardId: string; title: string },
  { actor, source }: OpContext = {},
): Promise<{ checklistId: string; boardId: string }> {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  const checklistId = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ position: checklists.position })
      .from(checklists)
      .where(eq(checklists.cardId, input.cardId))
      .orderBy(desc(checklists.position))
      .limit(1);

    const [row] = await tx
      .insert(checklists)
      .values({
        cardId: input.cardId,
        title: input.title,
        position: generateKeyBetween(last?.position ?? null, null),
      })
      .returning({ id: checklists.id });

    await touchBoard(tx, ctx.board.id);
    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: input.cardId,
      actorId: ctx.user.id,
      type: "checklist.created",
      data: { checklistId: row.id, title: input.title, ...sourceData(source) },
    });

    return row.id;
  });

  return { checklistId, boardId: ctx.board.id };
}

/**
 * Resolve a checklist to its card, authorising the card.
 *
 * Every checklist-item operation goes through this rather than trusting a
 * `cardId` from the client alongside a `checklistId` — the pairing itself is
 * what must be verified.
 */
async function authorizeChecklist(checklistId: string, actor?: Actor) {
  const [row] = await db
    .select({ cardId: checklists.cardId })
    .from(checklists)
    .where(eq(checklists.id, checklistId))
    .limit(1);

  if (!row) throw new AuthorizationError();
  const ctx = await requireCardAccess(row.cardId, "member", actor);
  return { ctx, cardId: row.cardId };
}

export async function addChecklistItem(
  input: { checklistId: string; content: string },
  { actor, source }: OpContext = {},
): Promise<{ itemId: string; boardId: string }> {
  const { ctx, cardId } = await authorizeChecklist(input.checklistId, actor);

  const itemId = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ position: checklistItems.position })
      .from(checklistItems)
      .where(eq(checklistItems.checklistId, input.checklistId))
      .orderBy(desc(checklistItems.position))
      .limit(1);

    const [row] = await tx
      .insert(checklistItems)
      .values({
        checklistId: input.checklistId,
        content: input.content,
        position: generateKeyBetween(last?.position ?? null, null),
      })
      .returning({ id: checklistItems.id });

    await touchBoard(tx, ctx.board.id);
    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId,
      actorId: ctx.user.id,
      type: "checklist_item.created",
      data: { itemId: row.id, ...sourceData(source) },
    });

    return row.id;
  });

  return { itemId, boardId: ctx.board.id };
}

/**
 * Resolve a checklist item to its card via its checklist, authorising the card.
 * The join is the authorization: an item id belonging to someone else's card
 * simply does not come back.
 */
async function authorizeChecklistItem(itemId: string, actor?: Actor) {
  const [row] = await db
    .select({ cardId: checklists.cardId, checklistId: checklists.id })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .where(eq(checklistItems.id, itemId))
    .limit(1);

  if (!row) throw new AuthorizationError();
  const ctx = await requireCardAccess(row.cardId, "member", actor);
  return { ctx, cardId: row.cardId };
}

export async function toggleChecklistItem(
  input: { itemId: string; completed: boolean },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const { ctx, cardId } = await authorizeChecklistItem(input.itemId, actor);

  await db.transaction(async (tx) => {
    await tx
      .update(checklistItems)
      .set({ completed: input.completed })
      .where(eq(checklistItems.id, input.itemId));

    await touchBoard(tx, ctx.board.id);
    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId,
      actorId: ctx.user.id,
      type: "checklist_item.toggled",
      data: {
        itemId: input.itemId,
        completed: input.completed,
        ...sourceData(source),
      },
    });
  });

  return { boardId: ctx.board.id };
}

export async function deleteChecklistItem(
  input: { itemId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string }> {
  const { ctx, cardId } = await authorizeChecklistItem(input.itemId, actor);

  await db.transaction(async (tx) => {
    await tx.delete(checklistItems).where(eq(checklistItems.id, input.itemId));

    await touchBoard(tx, ctx.board.id);
    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId,
      actorId: ctx.user.id,
      type: "checklist_item.deleted",
      data: { itemId: input.itemId, ...sourceData(source) },
    });
  });

  return { boardId: ctx.board.id };
}

/**
 * Reorder a checklist item, and optionally move it to another checklist on the
 * same card.
 *
 * Same contract as `moveCard`: the caller sends *neighbour ids*, never a
 * position, and the fractional index is computed here from rows re-read inside
 * the transaction. A neighbour that is not in the destination checklist is
 * rejected rather than silently ignored, and `placeBetween` renumbers and
 * retries when the pair has become unusable.
 */
export async function moveChecklistItem(
  input: {
    itemId: string;
    /** Defaults to the item's current checklist. */
    targetChecklistId?: string;
    afterId?: string | null;
    beforeId?: string | null;
  },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; checklistId: string }> {
  const { ctx, cardId } = await authorizeChecklistItem(input.itemId, actor);

  const checklistId = await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ checklistId: checklistItems.checklistId })
      .from(checklistItems)
      .where(eq(checklistItems.id, input.itemId))
      .limit(1);

    if (!item) throw new AuthorizationError();

    const targetChecklistId = input.targetChecklistId ?? item.checklistId;

    // A checklist from another card is not a valid destination — the card is
    // what was authorised, so the destination must belong to it.
    const [targetChecklist] = await tx
      .select({ id: checklists.id })
      .from(checklists)
      .where(
        and(
          eq(checklists.id, targetChecklistId),
          eq(checklists.cardId, cardId),
        ),
      )
      .limit(1);

    if (!targetChecklist) throw new AuthorizationError();

    const siblings = await tx
      .select({ id: checklistItems.id, position: checklistItems.position })
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.checklistId, targetChecklistId),
          ne(checklistItems.id, input.itemId),
        ),
      )
      .orderBy(asc(checklistItems.position));

    const siblingIds = new Set(siblings.map((s) => s.id));
    const afterId =
      input.afterId && siblingIds.has(input.afterId) ? input.afterId : null;
    const beforeId =
      input.beforeId && siblingIds.has(input.beforeId) ? input.beforeId : null;

    if ((input.afterId && !afterId) || (input.beforeId && !beforeId)) {
      throw new AuthorizationError(
        "That item moved somewhere else. Refresh and try again.",
      );
    }

    const placement = placeBetween(siblings, afterId, beforeId);

    for (const row of placement.rebalanced) {
      await tx
        .update(checklistItems)
        .set({ position: row.position })
        .where(eq(checklistItems.id, row.id));
    }

    await tx
      .update(checklistItems)
      .set({
        checklistId: targetChecklistId,
        position: placement.position,
      })
      .where(eq(checklistItems.id, input.itemId));

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId,
      actorId: ctx.user.id,
      type: "checklist_item.moved",
      data: {
        itemId: input.itemId,
        checklistId: targetChecklistId,
        rebalanced: placement.rebalanced.length,
        ...sourceData(source),
      },
    });

    return targetChecklistId;
  });

  return { boardId: ctx.board.id, checklistId };
}

/** Everything the card detail modal renders, in one authorised read. */
export async function getCardModalData(cardId: string, actor?: Actor) {
  const detail = await getCardDetail(cardId, actor);

  const [boardLabels, attached, lists_, checklistRows] = await Promise.all([
    db
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(labels)
      .where(eq(labels.boardId, detail.board.id))
      .orderBy(asc(labels.createdAt)),
    db
      .select({ labelId: cardLabels.labelId })
      .from(cardLabels)
      .where(eq(cardLabels.cardId, cardId)),
    db
      .select({ id: lists.id, name: lists.name })
      .from(lists)
      .where(and(eq(lists.boardId, detail.board.id), isNull(lists.archivedAt)))
      .orderBy(asc(lists.position)),
    db
      .select({
        id: checklists.id,
        title: checklists.title,
        position: checklists.position,
      })
      .from(checklists)
      .where(eq(checklists.cardId, cardId))
      .orderBy(asc(checklists.position)),
  ]);

  const items = checklistRows.length
    ? await db
        .select({
          id: checklistItems.id,
          checklistId: checklistItems.checklistId,
          content: checklistItems.content,
          completed: checklistItems.completed,
          position: checklistItems.position,
        })
        .from(checklistItems)
        .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
        .where(eq(checklists.cardId, cardId))
        .orderBy(asc(checklistItems.position))
    : [];

  const byChecklist = new Map<string, typeof items>();
  for (const item of items) {
    const bucket = byChecklist.get(item.checklistId) ?? [];
    bucket.push(item);
    byChecklist.set(item.checklistId, bucket);
  }

  return {
    ...detail,
    boardLabels,
    attachedLabelIds: attached.map((a) => a.labelId),
    lists: lists_,
    checklists: checklistRows.map((c) => ({
      id: c.id,
      title: c.title,
      items: byChecklist.get(c.id) ?? [],
    })),
  };
}

/** Labels attached to every card on a board, keyed by card id. */
export async function labelsForBoard(boardId: string) {
  const rows = await db
    .select({
      cardId: cardLabels.cardId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(cardLabels)
    .innerJoin(labels, eq(labels.id, cardLabels.labelId))
    .innerJoin(cards, eq(cards.id, cardLabels.cardId))
    .where(eq(cards.boardId, boardId))
    .orderBy(asc(labels.createdAt));

  const byCard = new Map<
    string,
    { id: string; name: string; color: string }[]
  >();
  for (const row of rows) {
    const bucket = byCard.get(row.cardId) ?? [];
    bucket.push({ id: row.id, name: row.name, color: row.color });
    byCard.set(row.cardId, bucket);
  }
  return byCard;
}
