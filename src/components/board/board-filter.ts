import type { BoardCardState, BoardListState } from "@/components/board/board-state";
import { dueStatus } from "@/components/board/due-status";

/**
 * Client-side board filtering.
 *
 * Purely a *render-time* narrowing: `applyMove` and the neighbour helpers keep
 * operating on the full arrangement, so a filtered board still produces correct
 * fractional indices when something is dragged. Nothing here talks to the
 * server — filtering a board is not a query.
 */

export type DueFilter = "any" | "overdue" | "soon" | "none";

export type BoardFilter = {
  text: string;
  labelIds: string[];
  assigneeIds: string[];
  due: DueFilter;
};

export const EMPTY_FILTER: BoardFilter = {
  text: "",
  labelIds: [],
  assigneeIds: [],
  due: "any",
};

export function isFilterActive(filter: BoardFilter): boolean {
  return (
    filter.text.trim().length > 0 ||
    filter.labelIds.length > 0 ||
    filter.assigneeIds.length > 0 ||
    filter.due !== "any"
  );
}

function matchesDue(card: BoardCardState, due: DueFilter, now: number) {
  if (due === "any") return true;
  const status = dueStatus(card.dueDate, now);
  if (due === "none") return status === "none";
  if (due === "overdue") return status === "overdue";
  // "soon" is deliberately inclusive of overdue: something already late is
  // the most urgent thing in a "what needs attention" view.
  return status === "soon" || status === "overdue";
}

export function cardMatches(
  card: BoardCardState,
  filter: BoardFilter,
  now: number,
): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text) {
    const haystack = `${card.title} ${card.excerpt ?? ""}`.toLowerCase();
    if (!haystack.includes(text)) return false;
  }

  // Multiple labels / assignees are OR-ed within their group and AND-ed across
  // groups: "anything red or blue that is assigned to me".
  if (filter.labelIds.length > 0) {
    if (!card.labels.some((label) => filter.labelIds.includes(label.id))) {
      return false;
    }
  }

  if (filter.assigneeIds.length > 0) {
    if (
      !card.assignees.some((person) =>
        filter.assigneeIds.includes(person.userId),
      )
    ) {
      return false;
    }
  }

  return matchesDue(card, filter.due, now);
}

export type FilteredBoard = {
  lists: BoardListState[];
  hidden: number;
};

export function filterBoard(
  lists: BoardListState[],
  filter: BoardFilter,
  now: number,
): FilteredBoard {
  if (!isFilterActive(filter)) return { lists, hidden: 0 };

  let hidden = 0;
  const next = lists.map((list) => {
    const cards = list.cards.filter((card) => {
      const keep = cardMatches(card, filter, now);
      if (!keep) hidden += 1;
      return keep;
    });
    return cards.length === list.cards.length ? list : { ...list, cards };
  });

  return { lists: next, hidden };
}
