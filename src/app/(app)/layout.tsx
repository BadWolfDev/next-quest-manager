import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { requireUser } from "@/lib/authorize";
import { countMyUnread } from "@/lib/notifications";
import { isEnvAdmin } from "@/lib/registration";
import { safeRead } from "@/lib/safe-read";
import { listMyBoards, listMyWorkspaces } from "@/lib/queries";

/**
 * The authenticated shell. `requireUser()` is the real gate — the proxy
 * redirect is only a convenience, and every query below is membership-scoped
 * in SQL regardless.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser().catch(() => null);
  // Not just "signed out" — the session may be a valid JWT for a user that no
  // longer exists. Route through the handler that clears the cookie, otherwise
  // the proxy (which only sees the intact token) bounces straight back here.
  if (!user) redirect("/api/session/expired");

  const [workspaces, boards, unreadCount] = await Promise.all([
    // Core navigation: if these fail the shell genuinely cannot render, so let
    // them throw rather than silently showing an empty sidebar.
    listMyWorkspaces(),
    listMyBoards(),
    // The bell is decoration. Inside a Promise.all an unguarded rejection here
    // would 500 every authenticated page for the sake of a badge.
    safeRead("layout.unreadCount", () => countMyUnread(), 0),
  ]);

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        isEnvAdmin: isEnvAdmin(user.email),
      }}
      workspaces={workspaces}
      boards={boards}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
