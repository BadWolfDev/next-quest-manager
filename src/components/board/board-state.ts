/**
 * Pure, client-safe board state helpers.
 *
 * Kept free of server imports so the optimistic reducer can live in the
 * browser bundle, and free of React so it stays trivially testable.
 */

export type BoardCardAssignee = {
  userId: string;
  name: string;
  image: string | null;
};

export type BoardCardState = {
  id: string;
  title: string;
  dueDate: Date | null;
  assignees: BoardCardAssignee[];
};

export type BoardListState = {
  id: string;
  name: string;
  cards: BoardCardState[];
};

export type BoardMove =
  | {
      kind: "card";
      cardId: string;
      toListId: string;
      /** Index within the destination list *after* the move. */
      toIndex: number;
    }
  | { kind: "list"; listId: string; toIndex: number };

function moveWithin<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Where a card currently sits. */
export function locateCard(
  lists: BoardListState[],
  cardId: string,
): { listIndex: number; cardIndex: number } | null {
  for (let listIndex = 0; listIndex < lists.length; listIndex++) {
    const cardIndex = lists[listIndex].cards.findIndex((c) => c.id === cardId);
    if (cardIndex !== -1) return { listIndex, cardIndex };
  }
  return null;
}

/**
 * Apply a move to a board arrangement, returning a new array. Used both for the
 * live drag preview and as the `useOptimistic` reducer, so what you see while
 * dragging and what you see while the server confirms are produced by the same
 * code.
 */
export function applyMove(
  lists: BoardListState[],
  move: BoardMove,
): BoardListState[] {
  if (move.kind === "list") {
    const from = lists.findIndex((l) => l.id === move.listId);
    if (from === -1) return lists;
    const to = Math.max(0, Math.min(move.toIndex, lists.length - 1));
    if (from === to) return lists;
    return moveWithin(lists, from, to);
  }

  const source = locateCard(lists, move.cardId);
  if (!source) return lists;

  const targetListIndex = lists.findIndex((l) => l.id === move.toListId);
  if (targetListIndex === -1) return lists;

  const card = lists[source.listIndex].cards[source.cardIndex];

  // Same list: a straight reorder.
  if (source.listIndex === targetListIndex) {
    const cards = lists[source.listIndex].cards;
    const to = Math.max(0, Math.min(move.toIndex, cards.length - 1));
    if (to === source.cardIndex) return lists;
    const next = lists.slice();
    next[source.listIndex] = {
      ...next[source.listIndex],
      cards: moveWithin(cards, source.cardIndex, to),
    };
    return next;
  }

  // Across lists: remove, then insert.
  const next = lists.slice();
  next[source.listIndex] = {
    ...next[source.listIndex],
    cards: next[source.listIndex].cards.filter((c) => c.id !== move.cardId),
  };

  const targetCards = next[targetListIndex].cards.slice();
  const to = Math.max(0, Math.min(move.toIndex, targetCards.length));
  targetCards.splice(to, 0, card);
  next[targetListIndex] = { ...next[targetListIndex], cards: targetCards };

  return next;
}

/**
 * The ids either side of an item in its final arrangement.
 *
 * These — not a position string — are what the server action receives. The
 * server re-reads the neighbours inside its transaction and computes the
 * fractional index itself, so a stale or forged client cannot dictate order.
 */
export function neighboursOfCard(
  lists: BoardListState[],
  listId: string,
  cardId: string,
): { afterCardId: string | null; beforeCardId: string | null } {
  const list = lists.find((l) => l.id === listId);
  if (!list) return { afterCardId: null, beforeCardId: null };
  const index = list.cards.findIndex((c) => c.id === cardId);
  if (index === -1) return { afterCardId: null, beforeCardId: null };
  return {
    afterCardId: index > 0 ? list.cards[index - 1].id : null,
    beforeCardId:
      index < list.cards.length - 1 ? list.cards[index + 1].id : null,
  };
}

export function neighboursOfList(
  lists: BoardListState[],
  listId: string,
): { afterListId: string | null; beforeListId: string | null } {
  const index = lists.findIndex((l) => l.id === listId);
  if (index === -1) return { afterListId: null, beforeListId: null };
  return {
    afterListId: index > 0 ? lists[index - 1].id : null,
    beforeListId: index < lists.length - 1 ? lists[index + 1].id : null,
  };
}
