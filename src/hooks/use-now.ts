"use client";

import { useSyncExternalStore } from "react";

/**
 * A coarse, render-safe clock.
 *
 * "Overdue" and "due soon" depend on the current time, but reading `Date.now()`
 * during render is impure — the React Compiler lint rules reject it outright,
 * and it would also hand React a className on the server that the browser may
 * disagree with. This exposes the clock as an external store instead: the
 * server snapshot is `0`, so the first client render matches the server exactly
 * and only then flips to real time, the same hydration boundary `useMounted()`
 * gives.
 *
 * One shared interval regardless of how many cards subscribe; a minute is
 * plenty of resolution for a due date.
 */
const TICK_MS = 60_000;

let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void) {
  // Runs from an effect, never during render, so reading the clock here is fine.
  current = Date.now();
  listeners.add(onStoreChange);

  timer ??= setInterval(() => {
    current = Date.now();
    for (const listener of listeners) listener();
  }, TICK_MS);

  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => 0;

/** Milliseconds since the epoch, or `0` on the server and during hydration. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
