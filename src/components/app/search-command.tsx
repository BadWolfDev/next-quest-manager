"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { searchCardsAction, type CardSearchHit } from "@/actions/search";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useMounted } from "@/hooks/use-mounted";

const DEBOUNCE_MS = 220;

/**
 * Card search, as a command palette.
 *
 * `searchCardsAction` scopes every row through `workspace_members` in SQL, so
 * this only ever shows cards the caller could already open. Results are not
 * filtered again in the browser — cmdk's own fuzzy matching is switched off
 * (`shouldFilter={false}`) because the server has already decided what matches.
 */
export function SearchCommand({
  variant = "full",
  hotkey = true,
}: {
  /** "icon" is the compact trigger for the mobile top bar. */
  variant?: "full" | "icon";
  /**
   * Only one instance may own Cmd/Ctrl+K. The shell renders a second, compact
   * trigger on small screens; that one listens for nothing, so the shortcut
   * still opens exactly one palette.
   */
  hotkey?: boolean;
}) {
  const router = useRouter();
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * The answer, tagged with the query that produced it. Keeping them together
   * means "loading" is *derived* — `answered.query !== trimmed` — rather than a
   * third piece of state that an effect has to set and keep in step.
   */
  const [answered, setAnswered] = useState<{
    query: string;
    hits: CardSearchHit[];
    error: string | null;
  } | null>(null);

  // Cmd/Ctrl+K from anywhere in the shell.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    if (!hotkey) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkey]);

  // Debounced search. The timeout is what keeps a fast typist from opening a
  // server action per keystroke; a stale flag drops responses that arrive out
  // of order.
  useEffect(() => {
    const trimmed = query.trim();
    let stale = false;

    const timer = window.setTimeout(async () => {
      if (trimmed.length < 2) {
        if (!stale) setAnswered({ query: trimmed, hits: [], error: null });
        return;
      }
      const result = await searchCardsAction(trimmed);
      if (stale) return;
      setAnswered(
        result.ok
          ? { query: trimmed, hits: result.hits, error: null }
          : { query: trimmed, hits: [], error: result.message },
      );
    }, DEBOUNCE_MS);

    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const trimmed = query.trim();
  const fresh = answered?.query === trimmed ? answered : null;
  const loading = trimmed.length >= 2 && !fresh;
  const hits = fresh?.hits ?? [];
  const error = fresh?.error ?? null;

  function go(hit: CardSearchHit) {
    setOpen(false);
    setQuery("");
    router.push(`/b/${hit.boardId}/c/${hit.cardId}`);
  }

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Search cards"
        >
          <Search className="size-5" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label="Search cards"
          className="text-muted-foreground h-8 w-full justify-start gap-2 px-2.5 font-normal"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search cards…</span>
          {/* The shortcut hint names a key that depends on the platform, so it
              waits for the client rather than guessing during SSR. */}
          <kbd className="bg-muted text-muted-foreground hidden rounded px-1.5 py-0.5 text-[0.65rem] font-medium sm:inline">
            {mounted && /mac/i.test(navigator.userAgent) ? "⌘K" : "Ctrl K"}
          </kbd>
        </Button>
      )}

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search cards"
        description="Find a card by title or description across every workspace you belong to."
      >
        {/* cmdk's own fuzzy filter is off: the server already decided what
            matches, and re-filtering in the browser would hide real hits. */}
        <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search cards…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {error ? (
            <div role="alert" className="text-destructive px-4 py-6 text-sm">
              {error}
            </div>
          ) : null}

          {!error && trimmed.length < 2 ? (
            <div className="text-muted-foreground px-4 py-6 text-sm">
              Type at least two characters.
            </div>
          ) : null}

          {!error && loading ? (
            <div className="text-muted-foreground px-4 py-6 text-sm">
              Searching…
            </div>
          ) : null}

          {!error && !loading && trimmed.length >= 2 ? (
            <CommandEmpty>No cards match that.</CommandEmpty>
          ) : null}

          {hits.length > 0 ? (
            <CommandGroup heading="Cards">
              {hits.map((hit) => (
                <CommandItem
                  key={hit.cardId}
                  value={hit.cardId}
                  onSelect={() => go(hit)}
                  className="cursor-pointer"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{hit.title}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {hit.workspaceName} · {hit.boardName} · {hit.listName}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
