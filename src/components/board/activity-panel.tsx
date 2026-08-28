"use client";

import { History, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  fetchBoardActivityAction,
  type ActivityEntry,
} from "@/actions/activity";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { initials } from "@/components/board/assignee-popover";

/** Turn an activity row into a sentence. */
function sentence(entry: ActivityEntry): string {
  const d = entry.data as Record<string, string | undefined>;
  const who = entry.actorName ?? "Someone";
  switch (entry.type) {
    case "board.created":
      return `${who} created this board`;
    case "board.renamed":
      return `${who} renamed the board from “${d.from}” to “${d.to}”`;
    case "board.archived":
      return `${who} archived the board`;
    case "board.restored":
      return `${who} restored the board`;
    case "list.created":
      return `${who} added the list “${d.name}”`;
    case "list.renamed":
      return `${who} renamed “${d.from}” to “${d.to}”`;
    case "list.archived":
      return `${who} archived the list “${d.name}”`;
    case "list.moved":
      return `${who} moved the list “${d.name}”`;
    case "card.created":
      return `${who} added “${d.title}”`;
    case "card.updated":
      return `${who} edited a card`;
    case "card.archived":
      return `${who} archived “${d.title}”`;
    case "card.moved":
      return `${who} moved “${d.title}” from ${d.fromListName ?? "a list"} to ${d.toListName ?? "another list"}`;
    case "card.reordered":
      return `${who} reordered “${d.title}” in ${d.listName ?? "a list"}`;
    case "card.assigned":
      return `${who} assigned “${d.title ?? "a card"}”`;
    case "card.unassigned":
      return `${who} removed an assignee`;
    case "comment.created":
      return `${who} commented on a card`;
    default:
      return `${who} — ${entry.type}`;
  }
}

function relative(iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ActivityPanel({ boardId }: { boardId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  async function load(before: string | null) {
    setLoading(true);
    try {
      const page = await fetchBoardActivityAction({ boardId, before });
      setError(page.error ?? null);
      setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      onOpenChange={(open) => {
        if (open) {
          setNow(Date.now());
          void load(null);
        }
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="size-4" />
          Activity
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Board activity</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {error ? (
            <p role="alert" className="text-destructive py-8 text-center text-sm">
              {error}
            </p>
          ) : !loaded && loading ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
              Loading…
            </p>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Nothing has happened on this board yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {entries.map((e) => (
                <li key={e.id} className="flex gap-2.5">
                  <Avatar className="mt-0.5 size-6 shrink-0">
                    {e.actorImage ? (
                      <AvatarImage src={e.actorImage} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[0.6rem]">
                      {initials(e.actorName ?? "?") || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{sentence(e)}</p>
                    <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                      {relative(e.createdAtIso, now)}
                      {e.viaMcp ? (
                        <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.65rem] font-medium">
                          <Sparkles className="size-2.5" />
                          via MCP
                        </span>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {cursor ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-4 w-full"
              disabled={loading}
              onClick={() => load(cursor)}
            >
              {loading ? "Loading…" : "Load older"}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
