import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArchivedBoards } from "@/components/app/archived-boards";
import { CreateBoardDialog } from "@/components/app/create-board-dialog";
import { AuthorizationError } from "@/lib/errors";
import { getWorkspacePage, listArchivedWorkspaceBoards } from "@/lib/queries";
import { safeRead } from "@/lib/safe-read";

export async function generateMetadata({
  params,
}: PageProps<"/w/[workspaceSlug]">): Promise<Metadata> {
  const { workspaceSlug } = await params;
  try {
    const { workspace } = await getWorkspacePage(workspaceSlug);
    return { title: workspace.name };
  } catch {
    return { title: "Workspace" };
  }
}

export default async function WorkspacePage({
  params,
}: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;

  // A workspace the caller isn't a member of is indistinguishable from one that
  // doesn't exist — the authorize() helper never leaks its existence.
  const page = await getWorkspacePage(workspaceSlug).catch((error) => {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  });

  const { workspace, role, boards } = page;

  // Decoration: the archive is a recovery affordance, not the point of the
  // page, so a failure here must not take the board grid down with it.
  const archived = await safeRead(
    "workspace.archivedBoards",
    () => listArchivedWorkspaceBoards(workspace.id),
    [],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Workspace · {role}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {workspace.name}
          </h1>
        </div>
        <CreateBoardDialog workspaceId={workspace.id} />
      </div>

      <section className="mt-8" aria-label="Boards">
        {boards.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-14 text-center">
            <h2 className="text-base font-medium">No boards yet</h2>
            <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm leading-relaxed">
              A board is a set of lists and the cards that move between them.
              Create the first one.
            </p>
            <div className="mt-5 flex justify-center">
              <CreateBoardDialog workspaceId={workspace.id} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {boards.map((board) => (
              <Link
                key={board.id}
                href={`/b/${board.id}`}
                className="focus-visible:ring-ring/70 group relative flex aspect-[16/10] flex-col justify-end overflow-hidden rounded-xl p-4 text-white transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                <span
                  aria-hidden="true"
                  className="nqm-tile absolute inset-0"
                  style={
                    {
                      "--tile": board.background.value,
                    } as React.CSSProperties
                  }
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent"
                />
                <span className="relative text-sm font-semibold drop-shadow-sm">
                  {board.name}
                </span>
                <span className="relative mt-0.5 text-xs text-white/75">
                  Updated{" "}
                  {board.updatedAt.toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </Link>
            ))}

            <CreateBoardDialog workspaceId={workspace.id} variant="tile" />
          </div>
        )}
      </section>

      <ArchivedBoards
        canRestore={role === "owner" || role === "admin"}
        boards={archived.map((board) => ({
          id: board.id,
          name: board.name,
          archivedLabel:
            board.archivedAt?.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }) ?? "",
        }))}
      />
    </div>
  );
}
