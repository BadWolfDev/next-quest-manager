"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchMyNotificationsAction,
  markNotificationsReadAction,
} from "@/actions/notifications";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationRow } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const POLL_MS = 10_000;

function sentence(n: NotificationRow): string {
  const d = n.data as Record<string, string | undefined>;
  switch (n.type) {
    case "card.assigned":
      return `You were assigned “${d.cardTitle ?? "a card"}”${d.boardName ? ` on ${d.boardName}` : ""}.`;
    case "card.commented":
      return `New comment on “${d.cardTitle ?? "a card"}”${d.boardName ? ` on ${d.boardName}` : ""}.`;
    case "card.mentioned":
      return `You were mentioned on “${d.cardTitle ?? "a card"}”${d.boardName ? ` on ${d.boardName}` : ""}.`;
    case "card.due_soon":
      return `“${d.cardTitle ?? "A card"}” is due within 24 hours.`;
    case "card.overdue":
      return `“${d.cardTitle ?? "A card"}” is overdue.`;
    case "workspace.role_changed":
      return `Your role in ${d.workspaceName ?? "a workspace"} is now ${d.role ?? "updated"}.`;
    case "workspace.added":
      return `You were added to ${d.workspaceName ?? "a workspace"}.`;
    case "workspace.removed":
      return `You were removed from ${d.workspaceName ?? "a workspace"}.`;
    default:
      return n.type;
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

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  // Rendered relative times are computed against a value captured on open, not
  // Date.now() during render, so the markup stays pure.
  const [now, setNow] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollCount = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { unread?: number };
      if (typeof body.unread === "number") setUnread(body.unread);
    } catch {
      // A failed poll is not worth surfacing; the next tick retries.
    }
  }, []);

  useEffect(() => {
    timer.current = setInterval(pollCount, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void pollCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollCount]);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;

    setNow(Date.now());
    const rows = await fetchMyNotificationsAction();
    setItems(rows);

    // Opening the panel marks what it shows as read.
    const unreadIds = rows.filter((r) => !r.read).map((r) => r.id);
    if (unreadIds.length > 0) {
      const fd = new FormData();
      fd.set("ids", JSON.stringify(unreadIds));
      await markNotificationsReadAction({ ok: false }, fd);
      setUnread(0);
      router.refresh();
    }
  }

  async function markAll() {
    await markNotificationsReadAction({ ok: false }, new FormData());
    setUnread(0);
    setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null);
    router.refresh();
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
          }
        >
          <Bell className="size-5" />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[0.6rem] font-semibold leading-4"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={markAll}
          >
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {items === null ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              Nothing yet.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={cn("px-3 py-2.5", !n.read && "bg-primary/5")}
                >
                  <p className="text-sm leading-snug">{sentence(n)}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {relative(n.createdAtIso, now)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
