import { describe, expect, it } from "vitest";

import type { BoardCardState, BoardListState } from "@/components/board/board-state";
import {
  EMPTY_FILTER,
  cardMatches,
  filterBoard,
  isFilterActive,
} from "@/components/board/board-filter";
import { dueStatus } from "@/components/board/due-status";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function card(over: Partial<BoardCardState> = {}): BoardCardState {
  return {
    id: "c1",
    title: "Write the docs",
    dueDate: null,
    assignees: [],
    labels: [],
    excerpt: null,
    ...over,
  };
}

function list(cards: BoardCardState[], id = "l1"): BoardListState {
  return { id, name: "Todo", cards };
}

describe("dueStatus", () => {
  it("classifies against the supplied clock", () => {
    expect(dueStatus(null, NOW)).toBe("none");
    expect(dueStatus(new Date(NOW - HOUR), NOW)).toBe("overdue");
    expect(dueStatus(new Date(NOW + 2 * HOUR), NOW)).toBe("soon");
    expect(dueStatus(new Date(NOW + 72 * HOUR), NOW)).toBe("later");
  });

  it("treats the server/hydration clock of 0 as nothing being urgent", () => {
    expect(dueStatus(new Date(NOW), 0)).toBe("later");
  });
});

describe("cardMatches", () => {
  it("matches title and excerpt case-insensitively", () => {
    const c = card({ excerpt: "A note about Postgres" });
    expect(cardMatches(c, { ...EMPTY_FILTER, text: "DOCS" }, NOW)).toBe(true);
    expect(cardMatches(c, { ...EMPTY_FILTER, text: "postgres" }, NOW)).toBe(
      true,
    );
    expect(cardMatches(c, { ...EMPTY_FILTER, text: "redis" }, NOW)).toBe(false);
  });

  it("ORs within a group and ANDs across groups", () => {
    const c = card({
      labels: [{ id: "red", name: "Red", color: "#f00" }],
      assignees: [{ userId: "u1", name: "Ada", image: null }],
    });

    expect(
      cardMatches(c, { ...EMPTY_FILTER, labelIds: ["red", "blue"] }, NOW),
    ).toBe(true);
    expect(cardMatches(c, { ...EMPTY_FILTER, labelIds: ["blue"] }, NOW)).toBe(
      false,
    );
    expect(
      cardMatches(
        c,
        { ...EMPTY_FILTER, labelIds: ["red"], assigneeIds: ["u2"] },
        NOW,
      ),
    ).toBe(false);
  });

  it("folds overdue into 'due soon' — late is the most urgent thing there is", () => {
    const late = card({ dueDate: new Date(NOW - HOUR) });
    expect(cardMatches(late, { ...EMPTY_FILTER, due: "soon" }, NOW)).toBe(true);
    expect(cardMatches(late, { ...EMPTY_FILTER, due: "overdue" }, NOW)).toBe(
      true,
    );
    expect(cardMatches(late, { ...EMPTY_FILTER, due: "none" }, NOW)).toBe(false);
  });
});

describe("filterBoard", () => {
  it("returns the very same array when nothing is filtered", () => {
    const lists = [list([card()])];
    const result = filterBoard(lists, EMPTY_FILTER, NOW);
    expect(result.lists).toBe(lists);
    expect(result.hidden).toBe(0);
  });

  it("keeps the list shape and counts what it held back", () => {
    const lists = [
      list([card({ id: "a", title: "alpha" }), card({ id: "b", title: "beta" })]),
      list([card({ id: "c", title: "alphabet" })], "l2"),
    ];

    const result = filterBoard(lists, { ...EMPTY_FILTER, text: "alpha" }, NOW);

    // Every list survives, even when empty — the board keeps its columns.
    expect(result.lists).toHaveLength(2);
    expect(result.lists[0].cards.map((c) => c.id)).toEqual(["a"]);
    expect(result.lists[1].cards.map((c) => c.id)).toEqual(["c"]);
    expect(result.hidden).toBe(1);
  });

  it("never mutates the arrangement the move reducer works on", () => {
    const original = list([card({ id: "a" }), card({ id: "b", title: "zzz" })]);
    const lists = [original];
    filterBoard(lists, { ...EMPTY_FILTER, text: "zzz" }, NOW);
    expect(original.cards.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("isFilterActive", () => {
  it("ignores whitespace-only text", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, text: "   " })).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, text: "x" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, due: "overdue" })).toBe(true);
  });
});
