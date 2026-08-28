import "server-only";

import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Fractional-index placement, with rebalancing.
 *
 * `position` columns are `text collate "C"`, so Postgres byte-orders them
 * exactly the way JavaScript's `<` does and the way `fractional-indexing`
 * assumes. Every comparison here is therefore a plain JS string compare on
 * values read back in `ORDER BY position` order — the two agree by
 * construction.
 *
 * `generateKeyBetween` throws when its neighbours are equal or inverted, which
 * concurrent moves can produce. Rather than failing the request we renumber the
 * siblings and retry, so a move always succeeds.
 */

export type Positioned = { id: string; position: string };

export type Placement = {
  /** Position to store on the moved row. */
  position: string;
  /** Siblings whose positions must be rewritten because we rebalanced. */
  rebalanced: Positioned[];
};

/**
 * Compute the position for an item dropped between two siblings.
 *
 * `siblings` must be every *other* non-archived item in the destination
 * container, already ordered by position ascending (the moved item excluded).
 * `afterId` is the sibling the item should follow; `beforeId` the one it should
 * precede. Either may be null for "at the start" / "at the end".
 */
export function placeBetween(
  siblings: Positioned[],
  afterId: string | null,
  beforeId: string | null,
): Placement {
  const afterIndex = afterId
    ? siblings.findIndex((s) => s.id === afterId)
    : -1;
  const beforeIndex = beforeId
    ? siblings.findIndex((s) => s.id === beforeId)
    : -1;

  // A neighbour id that isn't actually in the destination container is either a
  // stale client or a forged request; treat it as "not specified" rather than
  // trusting it. The caller separately verifies neighbour ownership.
  const lower = afterIndex >= 0 ? siblings[afterIndex] : null;
  const upper = beforeIndex >= 0 ? siblings[beforeIndex] : null;

  // Only trust the pair when it really is adjacent and correctly ordered.
  const adjacent =
    lower && upper ? beforeIndex === afterIndex + 1 : true;

  if (adjacent && (!lower || !upper || lower.position < upper.position)) {
    try {
      return {
        position: generateKeyBetween(
          lower?.position ?? null,
          upper?.position ?? null,
        ),
        rebalanced: [],
      };
    } catch {
      // Fall through to a rebalance.
    }
  }

  return rebalanceAndPlace(siblings, afterIndex, beforeIndex);
}

/**
 * Renumber every sibling with evenly spaced keys and place the moved item at
 * the requested slot. Used when the neighbours are unusable — duplicate keys,
 * inverted keys, or a pair that is no longer adjacent because someone else
 * moved something in between.
 */
function rebalanceAndPlace(
  siblings: Positioned[],
  afterIndex: number,
  beforeIndex: number,
): Placement {
  // Where the item lands in the sibling array.
  let slot: number;
  if (afterIndex >= 0) slot = afterIndex + 1;
  else if (beforeIndex >= 0) slot = beforeIndex;
  else slot = siblings.length;
  slot = Math.max(0, Math.min(slot, siblings.length));

  // One key per sibling plus one for the moved item.
  const keys = generateNKeysBetween(null, null, siblings.length + 1);

  const rebalanced: Positioned[] = [];
  for (let i = 0; i < siblings.length; i++) {
    // Siblings before the slot keep their index; those at or after it shift by
    // one to leave the slot free.
    const key = keys[i < slot ? i : i + 1];
    if (key !== siblings[i].position) {
      rebalanced.push({ id: siblings[i].id, position: key });
    }
  }

  return { position: keys[slot], rebalanced };
}
