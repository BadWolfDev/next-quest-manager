"use client";

import { CalendarClock, CheckSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LabelChips } from "@/components/board/label-chips";
import { listAccent } from "@/components/board/list-accent";
import type { PublicBoard } from "@/lib/core/public-board";

const POLL_MS = 30_000;

/**
 * Read-only board for anonymous visitors.
 *
 * No dnd-kit, no composers, no popovers — there is nothing here to mutate, and
 * nothing session-dependent (no sidebar, no notification bell). Freshness is a
 * plain 30s poll of a token-keyed version endpoint: cheaper to reason about
 * than reusing the member poller, and a public viewer has no in-flight edits
 * that a refresh could interrupt.
 */
export function PublicBoardView({
  board,
  token,
}: {
  board: PublicBoard;
  token: string;
}) {
  const router = useRouter();
  const lastVersion = useRef<number | null>(board.updatedAt.getTime());

  const check = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const res = await fetch(`/api/public/${token}/version`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { version?: number };
      if (typeof body.version !== "number") return;
      if (lastVersion.current !== null && body.version !== lastVersion.current) {
        lastVersion.current = body.version;
        router.refresh();
      }
    } catch {
      /* next tick retries */
    }
  }, [token, router]);

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

  return (
    <ol className="flex h-full snap-x snap-mandatory items-start gap-4 overflow-x-auto pb-2 sm:snap-none">
      {board.lists.map((list, index) => (
        <li
          key={list.id}
          style={{ "--list-accent": listAccent(index) } as React.CSSProperties}
          className="nqm-skin-column bg-muted/50 flex max-h-full w-[85vw] max-w-[20rem] shrink-0 snap-center flex-col rounded-xl border p-2.5 sm:w-72 sm:snap-align-none"
        >
          <div className="flex items-baseline justify-between px-1.5 pb-2">
            <h2 className="nqm-skin-list-title text-sm font-semibold">
              {list.name}
            </h2>
            <span className="text-muted-foreground text-xs tabular-nums">
              {list.cards.length}
            </span>
          </div>

          {list.cards.length === 0 ? (
            <p className="text-muted-foreground px-1.5 pb-1 text-xs">Empty.</p>
          ) : (
            <ul className="space-y-2">
              {list.cards.map((card) => (
                <li key={card.id}>
                  <Link
                    href={`/p/${token}/c/${card.id}`}
                    className="nqm-skin-card bg-card focus-visible:ring-ring/70 block rounded-lg border px-3 py-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2"
                  >
                    <LabelChips labels={card.labels} className="mb-1.5" />

                    {card.title}

                    {card.excerpt ? (
                      <span className="text-muted-foreground mt-1 block text-xs leading-snug">
                        {card.excerpt}
                      </span>
                    ) : null}

                    <span className="text-muted-foreground mt-1.5 flex items-center gap-3 text-xs">
                      {card.dueDate ? (
                        <span className="flex items-center gap-1">
                          <CalendarClock className="size-3.5" />
                          {card.dueDate.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      ) : null}
                      {card.checklistTotal > 0 ? (
                        <span className="flex items-center gap-1 tabular-nums">
                          <CheckSquare className="size-3.5" />
                          {card.checklistDone}/{card.checklistTotal}
                        </span>
                      ) : null}
                      {card.assignees.length > 0 ? (
                        <span className="ml-auto flex -space-x-1.5">
                          {card.assignees.slice(0, 3).map((a, i) => (
                            <Avatar
                              key={`${a.name}-${i}`}
                              className="ring-card size-5 ring-2"
                              title={a.name}
                            >
                              {a.image ? <AvatarImage src={a.image} alt="" /> : null}
                              <AvatarFallback className="text-[0.55rem]">
                                {a.name.slice(0, 1).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
