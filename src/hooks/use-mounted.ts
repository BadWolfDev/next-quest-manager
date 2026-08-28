"use client";

import { useSyncExternalStore } from "react";

/** The value never changes, so the store never has to notify anyone. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` while rendering on the server and during hydration, `true` afterwards.
 *
 * Anything derived from browser-only state — most importantly `useTheme()`,
 * which reads `localStorage` in its `useState` initialiser and therefore
 * returns the stored theme on the very first client render while the server
 * rendered `undefined` — must be gated behind this. Render a neutral state with
 * the same DOM shape until it flips, so the server and client markup match.
 *
 * Implemented with `useSyncExternalStore` rather than the usual
 * `useEffect(() => setMounted(true), [])`: React deliberately uses
 * `getServerSnapshot` for both the server render and the hydration pass and
 * only then switches to `getSnapshot`, which is exactly the boundary we want.
 * It also avoids the extra render pass, and the repo's React Compiler lint
 * rules reject `setState` inside an effect body.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
