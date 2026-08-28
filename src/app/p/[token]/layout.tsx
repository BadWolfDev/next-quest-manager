import Link from "next/link";

import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const REPO_URL = "https://github.com/BadWolfDev/next-quest-manager";

/**
 * Chrome for the public board.
 *
 * Nothing session-dependent is rendered here — no sidebar, no notification
 * bell, no user menu. Skins still apply because they come from localStorage on
 * the client, not from the session.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      {children}

      <footer className="mt-auto border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 text-xs sm:px-8">
          <span className="flex items-center gap-2">
            Powered by{" "}
            <Link
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
            >
              <Wordmark className="text-xs" />
            </Link>
            — open source, self-hostable.
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </footer>
    </div>
  );
}
