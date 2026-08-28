import "server-only";

import { logError } from "@/lib/log-error";

/**
 * Run an optional read, falling back instead of taking the page down.
 *
 * For data that decorates a page rather than constitutes it: the notification
 * count, a board's share token, the assignable-member list. A missing column or
 * a transient error in one of those should degrade that one control, not return
 * a 500 for the whole screen — which is exactly what happened when a shipped
 * `select public_token` ran against a database that had not been migrated yet.
 *
 * Deliberately NOT for core data. If a board's lists fail to load, rendering an
 * empty board is worse than an honest error, so those reads stay unguarded.
 */
export async function safeRead<T>(
  scope: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    logError(`[safe-read] ${scope} failed; using fallback:`, error);
    return fallback;
  }
}
