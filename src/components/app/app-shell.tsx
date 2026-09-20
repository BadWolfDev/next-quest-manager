"use client";

import { LayoutGrid, Menu, Settings, SquareKanban, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { NotificationBell } from "@/components/app/notification-bell";
import { SearchCommand } from "@/components/app/search-command";
import { UserMenu, type UserMenuUser } from "@/components/app/user-menu";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { NavBoard, WorkspaceSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Props = {
  user: UserMenuUser;
  workspaces: WorkspaceSummary[];
  boards: NavBoard[];
  unreadCount: number;
  children: React.ReactNode;
};

/**
 * Derives the active workspace from the URL: `/w/[slug]` matches by slug,
 * `/b/[boardId]` matches through the board's workspace. Everything the sidebar
 * needs is already loaded by the layout, so switching costs no round trip.
 */
function useActiveWorkspaceId(
  workspaces: WorkspaceSummary[],
  boards: NavBoard[],
) {
  const pathname = usePathname();

  return useMemo(() => {
    const workspaceMatch = pathname.match(/^\/w\/([^/]+)/);
    if (workspaceMatch) {
      const slug = decodeURIComponent(workspaceMatch[1]);
      return workspaces.find((w) => w.slug === slug)?.id ?? null;
    }

    const boardMatch = pathname.match(/^\/b\/([^/]+)/);
    if (boardMatch) {
      const boardId = decodeURIComponent(boardMatch[1]);
      return boards.find((b) => b.id === boardId)?.workspaceId ?? null;
    }

    return workspaces[0]?.id ?? null;
  }, [pathname, workspaces, boards]);
}

function SidebarBody({
  user,
  workspaces,
  boards,
  onNavigate,
}: Omit<Props, "children" | "unreadCount"> & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const activeId = useActiveWorkspaceId(workspaces, boards);
  const activeWorkspace = workspaces.find((w) => w.id === activeId);
  const visibleBoards = boards.filter((b) => b.workspaceId === activeId);

  return (
    <div className="flex h-full flex-col gap-1 p-2">
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeId={activeId}
        onNavigate={onNavigate}
      />

      <Separator className="my-1" />

      <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Workspace">
        {activeWorkspace ? (
          <Link
            href={`/w/${activeWorkspace.slug}`}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
              pathname === `/w/${activeWorkspace.slug}`
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "hover:bg-sidebar-accent/60",
            )}
          >
            <LayoutGrid className="size-4 shrink-0" />
            All boards
          </Link>
        ) : null}

        {activeWorkspace ? (
          <>
            <Link
              href={`/w/${activeWorkspace.slug}/settings/members`}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                pathname === `/w/${activeWorkspace.slug}/settings/members`
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "hover:bg-sidebar-accent/60",
              )}
            >
              <Users className="size-4 shrink-0" />
              Members
            </Link>
            <Link
              href={`/w/${activeWorkspace.slug}/settings`}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                pathname === `/w/${activeWorkspace.slug}/settings`
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "hover:bg-sidebar-accent/60",
              )}
            >
              <Settings className="size-4 shrink-0" />
              Workspace settings
            </Link>
          </>
        ) : null}

        <p className="text-muted-foreground mt-4 px-2.5 pb-1 text-[0.7rem] font-medium uppercase tracking-wide">
          Boards
        </p>

        {visibleBoards.length === 0 ? (
          <p className="text-muted-foreground px-2.5 py-1.5 text-sm">
            No boards yet.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visibleBoards.map((board) => {
              const active = pathname === `/b/${board.id}`;
              return (
                <li key={board.id}>
                  <Link
                    href={`/b/${board.id}`}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "hover:bg-sidebar-accent/60",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-3.5 shrink-0 rounded-[5px]"
                      style={{ background: board.background.value }}
                    />
                    <span className="truncate">{board.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <Separator className="my-1" />
      <UserMenu user={user} />
    </div>
  );
}

export function AppShell({
  user,
  workspaces,
  boards,
  unreadCount,
  children,
}: Props) {
  // The drawer is closed by the navigation handlers the sidebar links call —
  // no route-watching effect needed.
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <aside className="bg-sidebar hidden w-64 shrink-0 border-r md:flex md:flex-col">
        <div className="flex items-center justify-between px-3.5 py-4">
          <Link href="/app" aria-label="Next Quest Manager home">
            <Wordmark />
          </Link>
          <NotificationBell initialUnread={unreadCount} />
        </div>
        <div className="px-2 pb-1">
          {/* The only instance that owns Cmd/Ctrl+K. The sidebar is always
              mounted (just visually hidden below md), so the shortcut works on
              every screen size. */}
          <SearchCommand />
        </div>
        <div className="min-h-0 flex-1">
          <SidebarBody user={user} workspaces={workspaces} boards={boards} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/85 sticky top-0 z-20 flex items-center gap-2 border-b px-3 py-2.5 backdrop-blur md:hidden">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar w-[17rem] p-0">
              <SheetHeader className="px-3.5 py-4">
                <SheetTitle className="text-left">
                  <Wordmark />
                </SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1">
                <SidebarBody
                  user={user}
                  workspaces={workspaces}
                  boards={boards}
                  onNavigate={() => setDrawerOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          <Link href="/app" className="flex flex-1 items-center gap-2">
            <SquareKanban className="text-primary size-4" />
            <span className="text-sm font-semibold tracking-tight">
              Next Quest Manager
            </span>
          </Link>
          <SearchCommand variant="icon" hotkey={false} />
          <NotificationBell initialUnread={unreadCount} />
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
