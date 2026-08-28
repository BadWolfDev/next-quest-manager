/**
 * Miami Deadline gives each list column a 5px top rule that cycles
 * pink -> yellow -> cyan, in the order the mock shows.
 *
 * Derived from the list's index rather than a CSS :nth-of-type selector, which
 * counts DOM siblings and therefore cycled differently on the private board
 * (composer + "add list" siblings) than on the public one. Other skins ignore
 * the variable entirely.
 */
export const LIST_ACCENTS = ["#ff2e93", "#ffd23f", "#00e5ff"] as const;

export function listAccent(index: number): string {
  return LIST_ACCENTS[index % LIST_ACCENTS.length];
}
