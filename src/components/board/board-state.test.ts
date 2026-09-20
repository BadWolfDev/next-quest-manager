import { describe, expect, it } from "vitest";

import {
  applyMove,
  locateCard,
  neighboursOfCard,
  neighboursOfList,
  type BoardCardState,
  type BoardListState,
} from "./board-state";

function card(id: string): BoardCardState {
  return {
    id,
    title: id.toUpperCase(),
    dueDate: null,
    assignees: [],
    labels: [],
    excerpt: null,
  };
}

function list(id: string, cardIds: string[]): BoardListState {
  return { id, name: id.toUpperCase(), cards: cardIds.map(card) };
}

/** `[["todo", ["a","b"]], …]` → the shape assertions read against. */
function shape(lists: BoardListState[]): Array<[string, string[]]> {
  return lists.map((l) => [l.id, l.cards.map((c) => c.id)]);
}

function board(): BoardListState[] {
  return [
    list("todo", ["a", "b", "c"]),
    list("doing", ["d", "e"]),
    list("done", []),
  ];
}

describe("locateCard", () => {
  it("finds a card's list and index", () => {
    expect(locateCard(board(), "e")).toEqual({ listIndex: 1, cardIndex: 1 });
  });

  it("returns null for an unknown card", () => {
    expect(locateCard(board(), "nope")).toBeNull();
  });
});

describe("applyMove — cards within a list", () => {
  it("moves a card down", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "a",
      toListId: "todo",
      toIndex: 2,
    });
    expect(shape(next)).toEqual([
      ["todo", ["b", "c", "a"]],
      ["doing", ["d", "e"]],
      ["done", []],
    ]);
  });

  it("moves a card up to the top", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "c",
      toListId: "todo",
      toIndex: 0,
    });
    expect(shape(next)[0]).toEqual(["todo", ["c", "a", "b"]]);
  });

  it("clamps an out-of-range index to the bottom", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "a",
      toListId: "todo",
      toIndex: 99,
    });
    expect(shape(next)[0]).toEqual(["todo", ["b", "c", "a"]]);
  });

  it("clamps a negative index to the top", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "c",
      toListId: "todo",
      toIndex: -5,
    });
    expect(shape(next)[0]).toEqual(["todo", ["c", "a", "b"]]);
  });

  it("returns the identical array for a no-op move", () => {
    const before = board();
    expect(
      applyMove(before, {
        kind: "card",
        cardId: "b",
        toListId: "todo",
        toIndex: 1,
      }),
    ).toBe(before);
  });

  it("does not mutate the input", () => {
    const before = board();
    const snapshot = shape(before);
    applyMove(before, {
      kind: "card",
      cardId: "a",
      toListId: "doing",
      toIndex: 0,
    });
    expect(shape(before)).toEqual(snapshot);
  });

  it("leaves untouched lists referentially identical", () => {
    const before = board();
    const next = applyMove(before, {
      kind: "card",
      cardId: "a",
      toListId: "todo",
      toIndex: 2,
    });
    expect(next[1]).toBe(before[1]);
    expect(next[2]).toBe(before[2]);
  });
});

describe("applyMove — cards between lists", () => {
  it("moves a card to another list at an index", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "b",
      toListId: "doing",
      toIndex: 1,
    });
    expect(shape(next)).toEqual([
      ["todo", ["a", "c"]],
      ["doing", ["d", "b", "e"]],
      ["done", []],
    ]);
  });

  it("moves a card into an empty list", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "d",
      toListId: "done",
      toIndex: 0,
    });
    expect(shape(next)).toEqual([
      ["todo", ["a", "b", "c"]],
      ["doing", ["e"]],
      ["done", ["d"]],
    ]);
  });

  it("appends past the end of the destination (index === length is valid)", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "a",
      toListId: "doing",
      toIndex: 2,
    });
    expect(shape(next)[1]).toEqual(["doing", ["d", "e", "a"]]);
  });

  it("clamps an absurd destination index to the end", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "a",
      toListId: "doing",
      toIndex: 500,
    });
    expect(shape(next)[1]).toEqual(["doing", ["d", "e", "a"]]);
  });

  it("carries the card object across, not a copy", () => {
    const before = board();
    const moved = before[0].cards[0];
    const next = applyMove(before, {
      kind: "card",
      cardId: "a",
      toListId: "done",
      toIndex: 0,
    });
    expect(next[2].cards[0]).toBe(moved);
  });
});

describe("applyMove — invalid input", () => {
  it("returns the same array for an unknown card id", () => {
    const before = board();
    expect(
      applyMove(before, {
        kind: "card",
        cardId: "ghost",
        toListId: "doing",
        toIndex: 0,
      }),
    ).toBe(before);
  });

  it("returns the same array for an unknown destination list", () => {
    const before = board();
    expect(
      applyMove(before, {
        kind: "card",
        cardId: "a",
        toListId: "ghost",
        toIndex: 0,
      }),
    ).toBe(before);
  });

  it("returns the same array for an unknown list id", () => {
    const before = board();
    expect(applyMove(before, { kind: "list", listId: "ghost", toIndex: 0 })).toBe(
      before,
    );
  });
});

describe("applyMove — lists", () => {
  it("reorders a list to the front", () => {
    const next = applyMove(board(), {
      kind: "list",
      listId: "done",
      toIndex: 0,
    });
    expect(next.map((l) => l.id)).toEqual(["done", "todo", "doing"]);
  });

  it("reorders a list to the back", () => {
    const next = applyMove(board(), {
      kind: "list",
      listId: "todo",
      toIndex: 2,
    });
    expect(next.map((l) => l.id)).toEqual(["doing", "done", "todo"]);
  });

  it("clamps an out-of-range list index", () => {
    const next = applyMove(board(), {
      kind: "list",
      listId: "todo",
      toIndex: 42,
    });
    expect(next.map((l) => l.id)).toEqual(["doing", "done", "todo"]);
  });

  it("returns the identical array when the list is already there", () => {
    const before = board();
    expect(
      applyMove(before, { kind: "list", listId: "doing", toIndex: 1 }),
    ).toBe(before);
  });

  it("keeps cards intact while reordering lists", () => {
    const next = applyMove(board(), {
      kind: "list",
      listId: "done",
      toIndex: 0,
    });
    expect(shape(next)).toEqual([
      ["done", []],
      ["todo", ["a", "b", "c"]],
      ["doing", ["d", "e"]],
    ]);
  });
});

describe("neighboursOfCard", () => {
  it("reports both neighbours in the middle", () => {
    expect(neighboursOfCard(board(), "todo", "b")).toEqual({
      afterCardId: "a",
      beforeCardId: "c",
    });
  });

  it("reports a null `after` at the top", () => {
    expect(neighboursOfCard(board(), "todo", "a")).toEqual({
      afterCardId: null,
      beforeCardId: "b",
    });
  });

  it("reports a null `before` at the bottom", () => {
    expect(neighboursOfCard(board(), "todo", "c")).toEqual({
      afterCardId: "b",
      beforeCardId: null,
    });
  });

  it("reports nulls for an unknown card or list", () => {
    const nulls = { afterCardId: null, beforeCardId: null };
    expect(neighboursOfCard(board(), "todo", "ghost")).toEqual(nulls);
    expect(neighboursOfCard(board(), "ghost", "a")).toEqual(nulls);
  });

  it("is consistent with applyMove: the arrangement determines the neighbours", () => {
    const next = applyMove(board(), {
      kind: "card",
      cardId: "a",
      toListId: "doing",
      toIndex: 1,
    });
    expect(neighboursOfCard(next, "doing", "a")).toEqual({
      afterCardId: "d",
      beforeCardId: "e",
    });
  });
});

describe("neighboursOfList", () => {
  it("reports both neighbours in the middle", () => {
    expect(neighboursOfList(board(), "doing")).toEqual({
      afterListId: "todo",
      beforeListId: "done",
    });
  });

  it("reports nulls at the edges", () => {
    expect(neighboursOfList(board(), "todo")).toEqual({
      afterListId: null,
      beforeListId: "doing",
    });
    expect(neighboursOfList(board(), "done")).toEqual({
      afterListId: "doing",
      beforeListId: null,
    });
  });

  it("reports nulls for an unknown list", () => {
    expect(neighboursOfList(board(), "ghost")).toEqual({
      afterListId: null,
      beforeListId: null,
    });
  });
});
