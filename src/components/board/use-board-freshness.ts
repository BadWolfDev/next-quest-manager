"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

const POLL_MS = 10_000;

/**
 * Poll a board's `updated_at` and refresh when someone else changes it.
 *
 * Deliberately cheap: one indexed select per tick, and the tick is skipped
 * while the tab is hidden, while a drag is in flight, or while a composer has
 * focus — refreshing during any of those would yank the UI out from under the
 * person using it.
 *
 * While paused we do not fetch at all, so `lastVersion` stays as it was and the
 * first tick after the pause ends still sees the change.
 *
 * `paused` is mirrored into a ref (from an effect, never during render) so that
 * toggling it does not tear down and rebuild the interval mid-drag.
 */
export function useBoardFreshness(boardId: string, paused: boolean) {
  const router = useRouter();
  const pausedRef = useRef(paused);
  const lastVersion = useRef<number | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const check = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (pausedRef.current) return;

    try {
      const res = await fetch(`/api/board/${boardId}/version`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { version?: number };
      if (typeof body.version !== "number") return;

      if (lastVersion.current === null) {
        lastVersion.current = body.version;
        return;
      }
      if (body.version !== lastVersion.current) {
        lastVersion.current = body.version;
        router.refresh();
      }
    } catch {
      // Transient failures are ignored; the next tick retries.
    }
  }, [boardId, router]);

  useEffect(() => {
    const id = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);
}
