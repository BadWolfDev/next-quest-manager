import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { listAssignableMembersFor } from "@/lib/core/members";
import { BoardView } from "@/components/board/board-view";
import { ShareDialog } from "@/components/board/share-dialog";
import { safeRead } from "@/lib/safe-read";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { AuthorizationError } from "@/lib/errors";
import { getBoardPage } from "@/lib/queries";
import { uuidSchema } from "@/lib/validation";

async function loadBoard(rawId: string) {
  // URLs carry UUIDs only — reject anything else before it reaches the query.
  const parsed = uuidSchema.safeParse(rawId);
  if (!parsed.success) notFound();

  return getBoardPage(parsed.data).catch((error) => {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/b/[boardId]">): Promise<Metadata> {
  const { boardId } = await params;
  const parsed = uuidSchema.safeParse(boardId);
  if (!parsed.success) return { title: "Board" };
  try {
    const { board } = await getBoardPage(parsed.data);
    return { title: board.name };
  } catch {
    return { title: "Board" };
  }
}

export default async function BoardPage({ params }: PageProps<"/b/[boardId]">) {
  const { boardId } = await params;
  const { board, workspace, lists, role } = await loadBoard(boardId);
  const canWrite = role !== "viewer";
  // Both of these decorate the board rather than constitute it, so a failure
  // degrades one control instead of 500ing the whole page.
  const members = await safeRead(
    "board.assignableMembers",
    () => listAssignableMembersFor(workspace.id),
    [],
  );

  // The share token is read here — already inside the authorised board context
  // — rather than widening BoardContext for one screen.
  const shareUrl = await safeRead(
    "board.shareToken",
    async () => {
      const [shareRow] = await db
        .select({ publicToken: boards.publicToken })
        .from(boards)
        .where(eq(boards.id, board.id))
        .limit(1);
      if (!shareRow?.publicToken) return null;
      const origin = (await headers()).get("origin") ?? "";
      return `${origin}/p/${shareRow.publicToken}`;
    },
    null,
  );

  return (
    <div className="flex h-dvh flex-col md:h-dvh">
      {/* The board's colour tints the header rather than flooding the page. */}
      <header
        className="shrink-0 border-b"
        style={{
          background: `color-mix(in oklab, ${board.background.value} 12%, transparent)`,
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <div className="min-w-0">
            <Link
              href={`/w/${workspace.slug}`}
              className="text-muted-foreground hover:text-foreground text-xs font-medium uppercase tracking-wide"
            >
              {workspace.name}
            </Link>
            <h1 className="nqm-skin-title mt-1 flex items-center gap-2.5 truncate text-xl font-semibold tracking-tight sm:text-2xl">
              <span
                aria-hidden="true"
                className="size-3.5 shrink-0 rounded-[5px]"
                style={{ background: board.background.value }}
              />
              {board.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ShareDialog
              boardId={board.id}
              initialShareUrl={shareUrl}
              canShare={role === "owner" || role === "admin"}
            />
          </div>
          <p className="text-muted-foreground hidden text-xs sm:block">
            {canWrite
              ? "Drag cards and lists to reorder — or focus a card and press Space."
              : "You have read-only access to this workspace."}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 px-5 py-5 sm:px-8">
        <BoardView
          boardId={board.id}
          members={members}
          canWrite={canWrite}
          lists={lists.map((list) => ({
            id: list.id,
            name: list.name,
            cards: list.cards.map((card) => ({
              id: card.id,
              title: card.title,
              dueDate: card.dueDate,
              assignees: card.assignees,
            })),
          }))}
        />
      </div>
    </div>
  );
}
