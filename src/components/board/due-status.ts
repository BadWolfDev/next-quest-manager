/**
 * Due-date tone, as a pure function of a date and "now".
 *
 * Kept free of React so both the card tile and the filter bar classify a card
 * the same way, and so "due soon" means one thing on the board.
 */

export type DueStatus = "overdue" | "soon" | "later" | "none";

/** Anything inside this window counts as "due soon". */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

export function dueStatus(due: Date | null, now: number): DueStatus {
  if (!due) return "none";
  const at = due.getTime();
  if (at < now) return "overdue";
  if (at - now <= DUE_SOON_MS) return "soon";
  return "later";
}

/**
 * Tokens, never literal colours — a skin remaps `--destructive` and the board
 * comes along for free. "Soon" borrows the primary ramp because the shadcn
 * variable set has no warning colour and forking one per skin is exactly the
 * thing CLAUDE.md forbids.
 */
export const DUE_TONE: Record<DueStatus, string> = {
  overdue:
    "text-destructive border-destructive/40 bg-destructive/10 font-medium",
  soon: "text-primary border-primary/40 bg-primary/10 font-medium",
  later: "text-muted-foreground border-transparent",
  none: "text-muted-foreground border-transparent",
};

export function dueLabel(due: Date, status: DueStatus): string {
  const date = due.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  if (status === "overdue") return `${date} · overdue`;
  if (status === "soon") return `${date} · due soon`;
  return date;
}
