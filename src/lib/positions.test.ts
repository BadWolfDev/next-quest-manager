import { describe, expect, it } from "vitest";

import { placeBetween, type Placement, type Positioned } from "./positions";

/**
 * Apply a placement the way `board-ops` does — write the rebalanced siblings
 * back, insert the moved row — and return the resulting order under the
 * bytewise comparison Postgres uses for a `text collate "C"` column.
 */
function applied(
  siblings: Positioned[],
  placement: Placement,
  movedId = "moved",
): Map<string, string> {
  const byId = new Map(siblings.map((s) => [s.id, s.position]));
  for (const row of placement.rebalanced) byId.set(row.id, row.position);
  byId.set(movedId, placement.position);
  return byId;
}

function resolve(
  siblings: Positioned[],
  placement: Placement,
  movedId = "moved",
): string[] {
  return [...applied(siblings, placement, movedId).entries()]
    .sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id]) => id);
}

/** The resulting keys, bytewise ascending. */
function resolveKeys(
  siblings: Positioned[],
  placement: Placement,
  movedId = "moved",
): string[] {
  return [...applied(siblings, placement, movedId).values()].sort();
}

/** Positions are compared bytewise, never by locale. */
function isSortedBytewise(keys: string[]): boolean {
  return keys.every((key, i) => i === 0 || keys[i - 1] < key);
}

const three: Positioned[] = [
  { id: "a", position: "a0" },
  { id: "b", position: "a1" },
  { id: "c", position: "a2" },
];

describe("placeBetween — the happy path", () => {
  it("places strictly between two adjacent neighbours", () => {
    const placement = placeBetween(three, "a", "b");
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position > "a0").toBe(true);
    expect(placement.position < "a1").toBe(true);
    expect(resolve(three, placement)).toEqual(["a", "moved", "b", "c"]);
  });

  it("places at the start when there is no `after`", () => {
    const placement = placeBetween(three, null, "a");
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position < "a0").toBe(true);
    expect(resolve(three, placement)).toEqual(["moved", "a", "b", "c"]);
  });

  it("places at the end when there is no `before`", () => {
    const placement = placeBetween(three, "c", null);
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position > "a2").toBe(true);
    expect(resolve(three, placement)).toEqual(["a", "b", "c", "moved"]);
  });

  it("places into an empty container without rebalancing", () => {
    const placement = placeBetween([], null, null);
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position.length).toBeGreaterThan(0);
  });

  it("treats both neighbours as unspecified when the container is empty", () => {
    const placement = placeBetween([], "ghost-a", "ghost-b");
    expect(placement.rebalanced).toEqual([]);
    expect(resolve([], placement)).toEqual(["moved"]);
  });

  it("appends when neither neighbour is given on a non-empty container", () => {
    // Two nulls mean "no constraints at all". That cannot be the base key here:
    // the base key is what the *first* sibling already holds.
    const placement = placeBetween(three, null, null);
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position > "a2").toBe(true);
    expect(resolve(three, placement)).toEqual(["a", "b", "c", "moved"]);
  });

  it("never returns a key a sibling already holds", () => {
    // "a0" is the base key, so an unconstrained placement into a container
    // whose head sits on it must not hand out "a0" a second time.
    for (const [after, before] of [
      [null, null],
      ["ghost", null],
      [null, "ghost"],
      ["ghost-a", "ghost-b"],
    ] as [string | null, string | null][]) {
      const placement = placeBetween(three, after, before);
      const taken = new Set(three.map((s) => s.position));
      expect(taken.has(placement.position)).toBe(false);
      for (const row of placement.rebalanced) taken.delete(row.position);
      expect(isSortedBytewise(resolveKeys(three, placement))).toBe(true);
    }
  });

  it("bounds an append by the sibling that actually follows", () => {
    // "after a" with no `before` is *not* unbounded: generateKeyBetween("a0",
    // null) is "a1", which is `b`. The real next sibling is the upper bound.
    const placement = placeBetween(three, "a", null);
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position > "a0").toBe(true);
    expect(placement.position < "a1").toBe(true);
    expect(resolve(three, placement)).toEqual(["a", "moved", "b", "c"]);
  });

  it("bounds a prepend by the sibling that actually precedes", () => {
    const placement = placeBetween(three, null, "c");
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position > "a1").toBe(true);
    expect(placement.position < "a2").toBe(true);
    expect(resolve(three, placement)).toEqual(["a", "b", "moved", "c"]);
  });
});

describe("placeBetween — untrustworthy neighbours", () => {
  it("ignores an `afterId` that is not in the container", () => {
    // Not a member of the destination: treated as "not specified", so this is
    // "before b" — the caller verifies ownership separately. The lower bound
    // comes from the sibling that actually precedes `b`.
    const placement = placeBetween(three, "elsewhere", "b");
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position > "a0").toBe(true);
    expect(placement.position < "a1").toBe(true);
    expect(resolve(three, placement)).toEqual(["a", "moved", "b", "c"]);
  });

  it("ignores a `beforeId` that is not in the container", () => {
    // This becomes "after b". The upper bound is `c`, the sibling that really
    // follows `b`: an unbounded key here would come out as "a2", i.e. `c`.
    const placement = placeBetween(three, "b", "elsewhere");
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position > "a1").toBe(true);
    expect(placement.position < "a2").toBe(true);
    expect(resolve(three, placement)).toEqual(["a", "b", "moved", "c"]);
  });

  it("appends when neither neighbour is in the container", () => {
    const placement = placeBetween(three, "ghost-a", "ghost-b");
    expect(placement.rebalanced).toEqual([]);
    expect(resolve(three, placement)).toEqual(["a", "b", "c", "moved"]);
  });

  it("ignores an unknown `afterId` at the head of the container", () => {
    const placement = placeBetween(three, "elsewhere", "a");
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position < "a0").toBe(true);
    expect(resolve(three, placement)).toEqual(["moved", "a", "b", "c"]);
  });

  it("ignores an unknown `beforeId` at the tail of the container", () => {
    const placement = placeBetween(three, "c", "elsewhere");
    expect(placement.rebalanced).toEqual([]);
    expect(placement.position > "a2").toBe(true);
    expect(resolve(three, placement)).toEqual(["a", "b", "c", "moved"]);
  });

  it("rebalances when the only usable neighbour has a duplicate key", () => {
    // `b` and `c` are tied, so "after b" has no room above it.
    const siblings: Positioned[] = [
      { id: "a", position: "a0" },
      { id: "b", position: "a1" },
      { id: "c", position: "a1" },
    ];
    const placement = placeBetween(siblings, "b", "elsewhere");
    expect(placement.rebalanced.length).toBeGreaterThan(0);
    expect(resolve(siblings, placement)).toEqual(["a", "b", "moved", "c"]);
  });
});

describe("placeBetween — rebalancing", () => {
  it("renumbers when the neighbours carry duplicate keys", () => {
    const siblings: Positioned[] = [
      { id: "a", position: "a1" },
      { id: "b", position: "a1" },
      { id: "c", position: "a2" },
    ];
    const placement = placeBetween(siblings, "a", "b");
    expect(placement.rebalanced.length).toBeGreaterThan(0);
    expect(resolve(siblings, placement)).toEqual(["a", "moved", "b", "c"]);
  });

  it("renumbers when the neighbours are inverted", () => {
    const siblings: Positioned[] = [
      { id: "a", position: "a5" },
      { id: "b", position: "a1" },
    ];
    const placement = placeBetween(siblings, "a", "b");
    expect(placement.rebalanced.length).toBeGreaterThan(0);
    // The requested slot wins: directly after `a` in the array order.
    expect(resolve(siblings, placement)).toEqual(["a", "moved", "b"]);
  });

  it("renumbers when the pair is no longer adjacent", () => {
    // Someone else dropped `b` between them since the client read the board.
    const placement = placeBetween(three, "a", "c");
    expect(placement.rebalanced.length).toBeGreaterThan(0);
    expect(resolve(three, placement)).toEqual(["a", "moved", "b", "c"]);
  });

  it("places at the start of a renumbered container", () => {
    const siblings: Positioned[] = [
      { id: "a", position: "a1" },
      { id: "b", position: "a1" },
    ];
    const placement = placeBetween(siblings, null, "a");
    expect(resolve(siblings, placement)).toEqual(["moved", "a", "b"]);
  });

  it("only reports siblings whose key actually changed", () => {
    const placement = placeBetween(three, "a", "c");
    for (const row of placement.rebalanced) {
      const before = three.find((s) => s.id === row.id);
      expect(row.position).not.toBe(before?.position);
    }
  });

  it("produces a strictly increasing, bytewise-sorted arrangement", () => {
    const siblings: Positioned[] = [
      { id: "a", position: "a1" },
      { id: "b", position: "a1" },
      { id: "c", position: "a1" },
    ];
    const placement = placeBetween(siblings, "b", "c");
    const byId = new Map(siblings.map((s) => [s.id, s.position]));
    for (const row of placement.rebalanced) byId.set(row.id, row.position);
    byId.set("moved", placement.position);
    const keys = [...byId.values()].sort();
    expect(isSortedBytewise(keys)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("fractional keys sort bytewise, not by locale", () => {
  it("keeps order while prepending repeatedly", () => {
    // Prepending is what produces the uppercase keys ("Zz", "Zy", …) that a
    // locale collation would sort *after* a lowercase one.
    let siblings: Positioned[] = [{ id: "seed", position: "a0" }];
    for (let i = 0; i < 12; i++) {
      const first = siblings[0];
      const placement = placeBetween(siblings, null, first.id);
      expect(placement.rebalanced).toEqual([]);
      siblings = [{ id: `p${i}`, position: placement.position }, ...siblings];
    }

    const keys = siblings.map((s) => s.position);
    expect(isSortedBytewise(keys)).toBe(true);
    // The documented hazard actually shows up: prepending reaches uppercase.
    expect(keys.some((k) => /^[A-Z]/.test(k))).toBe(true);
  });

  it("uppercase-prefixed keys sort before lowercase ones bytewise", () => {
    // This is the assumption the `text collate "C"` column type protects: under
    // en_US.UTF-8 Postgres orders "Zz" *after* "a1", which would silently
    // reverse a list whose head was produced by prepending.
    expect("Zz" < "a1").toBe(true);
    expect("Zz".localeCompare("a1")).toBeGreaterThan(0);
  });

  it("keeps order while appending repeatedly", () => {
    let siblings: Positioned[] = [{ id: "seed", position: "a0" }];
    for (let i = 0; i < 12; i++) {
      const last = siblings[siblings.length - 1];
      const placement = placeBetween(siblings, last.id, null);
      expect(placement.rebalanced).toEqual([]);
      siblings = [...siblings, { id: `n${i}`, position: placement.position }];
    }
    expect(isSortedBytewise(siblings.map((s) => s.position))).toBe(true);
  });

  it("keeps order while repeatedly inserting into the same gap", () => {
    let siblings: Positioned[] = [
      { id: "a", position: "a0" },
      { id: "b", position: "a1" },
    ];
    for (let i = 0; i < 20; i++) {
      const placement = placeBetween(siblings, "a", siblings[1].id);
      expect(placement.rebalanced).toEqual([]);
      siblings = [
        siblings[0],
        { id: `m${i}`, position: placement.position },
        ...siblings.slice(1),
      ];
    }
    expect(isSortedBytewise(siblings.map((s) => s.position))).toBe(true);
    expect(siblings[1].id).toBe("m19");
  });
});
