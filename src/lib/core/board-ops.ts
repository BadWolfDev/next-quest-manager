import "server-only";

import { and, asc, desc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

import { db } from "@/db";
import {
  boards,
  cardAssignees,
  cardLabels,
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
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;

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
        fields: Object.keys(patch).filter((k) => k !== "updatedAt"),
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

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

export async function addComment(
  input: { cardId: string; body: string },
  { actor, source }: OpContext = {},
): Promise<{ commentId: string }> {
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

  return { commentId };
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

  const cardComments = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorName: users.name,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.cardId, cardId))
    .orderBy(asc(comments.createdAt));

  const cardAssigneeRows = await db
    .select({ userId: users.id, name: users.name, image: users.image })
    .from(cardAssignees)
    .innerJoin(users, eq(users.id, cardAssignees.userId))
    .where(eq(cardAssignees.cardId, cardId));

  return { ...ctx, card, comments: cardComments, assignees: cardAssigneeRows };
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
