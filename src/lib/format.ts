/**
 * Display formatting shared by server actions.
 *
 * A plain module, deliberately not `"use server"`: every export of such a file
 * is a public HTTP endpoint, and a date formatter is not something to publish.
 * It lives here so the tokens screen and the connected-apps screen say "3m ago"
 * the same way rather than twice.
 *
 * These are called during a *server* render on purpose. `Date.now()` in a
 * client render makes the server and the client disagree about "3m ago" — the
 * same hydration trap the theme toggle had.
 */

/** Coarse "when was this last used" label. `null` means never. */
export function relativeLabel(date: Date | null): string {
  if (!date) return "never";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
