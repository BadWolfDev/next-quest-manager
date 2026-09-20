"use client";

import { CalendarClock, CalendarPlus, Check, X } from "lucide-react";
import { useState } from "react";

import { updateCardDetailAction } from "@/actions/card-detail";
import {
  DUE_TONE,
  dueStatus,
  type DueStatus,
} from "@/components/board/due-status";
import { useQuickAction } from "@/components/card/card-hooks";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

/**
 * The due-date field.
 *
 * Classification is shared with the board tiles (`board/due-status.ts`) so
 * "due soon" means the same thing in both places, and the tones are shadcn
 * variables rather than literal colours — a skin remaps them and this comes
 * along for free.
 */

type Tone = DueStatus | "done";

/** Every checklist item ticked reads as complete, whatever the date says. */
const DONE_TONE = "text-primary border-primary/40 bg-primary/10 font-medium";

const TONE_WORD: Record<Tone, string> = {
  none: "",
  later: "Due",
  soon: "Due soon",
  overdue: "Overdue",
  done: "Complete",
};

/** Timezone-free label rendered on the server and during hydration. */
function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The instant a picked calendar day means: local noon, so a timezone shift of
 * a few hours can never move it onto the neighbouring day.
 */
function atNoon(day: Date): Date {
  const at = new Date(day);
  at.setHours(12, 0, 0, 0);
  return at;
}

export function CardDueDate({
  cardId,
  boardId,
  dueDateIso,
  completed,
  canWrite,
}: {
  cardId: string;
  boardId: string;
  dueDateIso: string | null;
  /** Every checklist item ticked — rendered as a "Complete" badge. */
  completed: boolean;
  canWrite: boolean;
}) {
  // 0 on the server and during hydration, a timestamp once mounted.
  const now = useNow();
  const mounted = now !== 0;
  const [open, setOpen] = useState(false);
  const [pending, quick] = useQuickAction();

  const due = dueDateIso ? new Date(dueDateIso) : null;

  // The tone depends on the reader's clock, so it is only computed once
  // mounted; the server render and the hydration pass show the neutral one.
  const tone: Tone = !mounted
    ? "none"
    : completed && due
      ? "done"
      : dueStatus(due, now);

  function setDue(value: string) {
    quick(
      updateCardDetailAction,
      { cardId, boardId, dueDate: value },
      { onDone: () => setOpen(false) },
    );
  }

  const label = due
    ? mounted
      ? due.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : isoDay(dueDateIso!)
    : "No due date";

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-1 text-xs",
        tone === "done" ? DONE_TONE : DUE_TONE[tone],
        tone === "none" && "text-muted-foreground border-border",
      )}
    >
      {tone === "done" ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <CalendarClock className="size-3.5" aria-hidden="true" />
      )}
      {due ? (
        <>
          <span className="sr-only">{TONE_WORD[tone] || "Due"}: </span>
          {label}
          {tone === "overdue" || tone === "soon" ? (
            <span aria-hidden="true">· {TONE_WORD[tone].toLowerCase()}</span>
          ) : null}
        </>
      ) : (
        label
      )}
    </span>
  );

  if (!canWrite) {
    return (
      <div>
        <h2 className="nqm-skin-kicker text-muted-foreground mb-2 text-xs uppercase tracking-wide">
          Due date
        </h2>
        {badge}
      </div>
    );
  }

  return (
    <div>
      <h2 className="nqm-skin-kicker text-muted-foreground mb-2 text-xs uppercase tracking-wide">
        Due date
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={pending}
              aria-label={due ? `Change due date (${label})` : "Set a due date"}
              className="focus-visible:ring-ring/70 rounded-sm focus-visible:outline-none focus-visible:ring-2"
            >
              {due ? (
                badge
              ) : (
                <span className="border-border text-muted-foreground hover:bg-accent/40 inline-flex items-center gap-1.5 border px-2 py-1 text-xs">
                  <CalendarPlus className="size-3.5" aria-hidden="true" />
                  Set a due date
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              autoFocus
              selected={due ?? undefined}
              defaultMonth={due ?? undefined}
              disabled={pending}
              onSelect={(day) => {
                if (!day) return;
                setDue(atNoon(day).toISOString());
              }}
            />
          </PopoverContent>
        </Popover>

        {due ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs"
            disabled={pending}
            aria-label="Clear due date"
            // An empty string clears it; an absent field would leave it alone.
            onClick={() => setDue("")}
          >
            <X className="size-3.5" aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
