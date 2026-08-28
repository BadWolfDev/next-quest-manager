import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { requireUser } from "@/lib/authorize";
import { countMyUnread } from "@/lib/notifications";
import { listMyBoards, listMyWorkspaces } from "@/lib/queries";

/**
 * The authenticated shell. `requireUser()` is the real gate — the proxy
 * redirect is only a convenience, and every query below is membership-scoped
 * in SQL regardless.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");

  const [workspaces, boards, unreadCount] = await Promise.all([
    listMyWorkspaces(),
    listMyBoards(),
    countMyUnread(),
  ]);

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
      }}
      workspaces={workspaces}
      boards={boards}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
