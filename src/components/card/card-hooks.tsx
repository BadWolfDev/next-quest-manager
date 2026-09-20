"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useTransition } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";

import { useNow } from "@/hooks/use-now";
import { idleState, type ActionState } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/**
 * Shared plumbing for the card detail's sections.
 *
 * Every mutation in the modal follows the same shape — run the action, toast
 * on failure, `router.refresh()` on success so the RSC payload becomes the new
 * truth — so it is written once here instead of in each section.
 */

/** Bind a form action, refreshing on success and toasting on failure. */
export function useBoundAction(
  action: (p: ActionState, f: FormData) => Promise<ActionState>,
  onDone?: () => void,
) {
  const router = useRouter();
  return useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.ok) {
      onDone?.();
      router.refresh();
      if (result.message) toast.success(result.message);
    } else {
      toast.error(result.message ?? "That didn't work.");
    }
    return result;
  }, idleState);
}

export type QuickRunner = (
  action: (p: ActionState, f: FormData) => Promise<ActionState>,
  fields: Record<string, string>,
  options?: { onDone?: () => void; successMessage?: boolean },
) => void;

/**
 * Fire-and-refresh helper for buttons that have no form of their own —
 * checkboxes, label toggles, small deletes.
 */
export function useQuickAction(): [boolean, QuickRunner] {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const quick = useCallback<QuickRunner>(
    (action, fields, options) => {
      startTransition(async () => {
        const fd = new FormData();
        for (const [key, value] of Object.entries(fields)) fd.set(key, value);
        const result = await action(idleState, fd);
        if (!result.ok) {
          toast.error(result.message ?? "That didn't work.");
          return;
        }
        options?.onDone?.();
        if (options?.successMessage && result.message) {
          toast.success(result.message);
        }
        router.refresh();
      });
    },
    [router],
  );

  return [pending, quick];
}

/**
 * The one markdown renderer used for descriptions and comments.
 *
 * `react-markdown` renders to React elements and does NOT interpret raw HTML
 * unless `rehype-raw` is added — which it is not. User content therefore never
 * reaches the DOM as markup. Do not add `rehype-raw` here without a sanitiser.
 */
export function CardMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("nqm-prose space-y-2", className)}>
      <Markdown>{children}</Markdown>
    </div>
  );
}

/** Deterministic, timezone-free fallback rendered until the client takes over. */
function isoMinute(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = then - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";

  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (abs >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return format.format(Math.round(diff / 60_000), "minute");
}

/**
 * A timestamp shown relatively ("2 hours ago").
 *
 * Gated behind `useNow()`, which returns 0 on the server and during
 * hydration: the relative label depends on the reader's clock and locale, so
 * both of those passes emit a fixed UTC string and only the mounted client
 * swaps in the relative one. Same DOM shape either way, so hydration never
 * mismatches — and the label re-renders as time passes.
 */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const now = useNow();
  return (
    <time dateTime={iso} title={isoMinute(iso)} className={className}>
      {now === 0 ? isoMinute(iso) : relativeTime(iso, now)}
    </time>
  );
}
