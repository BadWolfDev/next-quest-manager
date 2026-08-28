import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicBoardView } from "@/components/public/public-board-view";
import { getPublicBoard } from "@/lib/core/public-board";

export const dynamic = "force-dynamic";

/**
 * Not indexed by default: a share link is semi-private, and a self-hoster who
 * wants public boards discoverable can flip this.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const board = await getPublicBoard(token);
  return {
    title: board ? `${board.name} · shared board` : "Shared board",
    robots: { index: false, follow: false },
  };
}

export default async function PublicBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const board = await getPublicBoard(token);
  if (!board) notFound();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className="shrink-0 border-b"
        style={{
          background: `color-mix(in oklab, ${board.background.value} 12%, transparent)`,
        }}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {board.workspaceName}
            </p>
            <h1 className="nqm-skin-title mt-1 flex items-center gap-2.5 truncate text-xl font-semibold tracking-tight sm:text-2xl">
              <span
                aria-hidden="true"
                className="size-3.5 shrink-0 rounded-[5px]"
                style={{ background: board.background.value }}
              />
              {board.name}
            </h1>
          </div>
          <span className="text-muted-foreground rounded-full border px-2.5 py-1 text-xs">
            Read-only shared view
          </span>
        </div>
      </header>

      <div className="mx-auto min-h-0 w-full max-w-6xl flex-1 px-5 py-5 sm:px-8">
        <PublicBoardView board={board} token={token} />
      </div>
    </div>
  );
}
