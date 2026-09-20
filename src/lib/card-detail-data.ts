import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { requireWorkspaceMember, WRITE_MIN_ROLE } from "@/lib/authorize";
import { db } from "@/db";
import { boards, lists } from "@/db/schema";
import { listAssignableMembersFor } from "@/lib/core/members";
import { getCardModalData } from "@/lib/core/board-ops";
import { safeRead } from "@/lib/safe-read";
import type {
  CardDetailData,
  WorkspaceBoardOption,
} from "@/components/card/types";

/**
 * The boards a card could be moved to, with their lists.
 *
 * Authorised through `requireWorkspaceMember` at the write floor — a viewer is
 * never offered the move, and the query is scoped to the one workspace rather
 * than filtered afterwards. Archived boards and lists are excluded: moving a
 * card into an archived container would hide it.
 */
async function listWorkspaceBoardsWithLists(
  workspaceId: string,
): Promise<WorkspaceBoardOption[]> {
  await requireWorkspaceMember(workspaceId, WRITE_MIN_ROLE);

  const rows = await db
    .select({
      boardId: boards.id,
      boardName: boards.name,
      listId: lists.id,
      listName: lists.name,
      listPosition: lists.position,
    })
    .from(boards)
    .leftJoin(
      lists,
      and(eq(lists.boardId, boards.id), isNull(lists.archivedAt)),
    )
    .where(and(eq(boards.workspaceId, workspaceId), isNull(boards.archivedAt)))
    .orderBy(asc(boards.name), asc(lists.position));

  const byBoard = new Map<string, WorkspaceBoardOption>();
  for (const row of rows) {
    const board = byBoard.get(row.boardId) ?? {
      id: row.boardId,
      name: row.boardName,
      lists: [],
    };
    if (row.listId) board.lists.push({ id: row.listId, name: row.listName! });
    byBoard.set(row.boardId, board);
  }
  return [...byBoard.values()];
}

/**
 * Assemble everything the card modal renders, authorised as the caller.
 *
 * `getCardModalData` runs the authorize() chain, so an id belonging to another
 * workspace throws here and the route turns that into a 404.
 */
export async function loadCardDetail(
  cardId: string,
): Promise<CardDetailData> {
  const data = await getCardModalData(cardId);
  const canWrite = data.role !== "viewer";

  const [members, workspaceBoards] = await Promise.all([
    listAssignableMembersFor(data.workspace.id),
    // Decorative: an empty "Move to board…" picker is a far better failure
    // than a 500 on the card itself.
    canWrite
      ? safeRead(
          "card-detail:workspace-boards",
          () => listWorkspaceBoardsWithLists(data.workspace.id),
          [] as WorkspaceBoardOption[],
        )
      : Promise.resolve([] as WorkspaceBoardOption[]),
  ]);

  return {
    card: {
      id: data.card.id,
      title: data.card.title,
      description: data.card.description,
      listId: data.card.listId,
      listName: data.card.listName,
      // Short human-facing reference, derived from the uuid.
      ref: `#${data.card.id.slice(0, 4).toUpperCase()}`,
      updatedLabel: data.card.createdAt.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      dueDateIso: data.card.dueDate?.toISOString() ?? null,
    },
    board: { id: data.board.id, name: data.board.name },
    assignees: data.assignees,
    watchers: data.watchers,
    watching: data.watching,
    comments: data.comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorName: c.authorName,
      authorImage: c.authorImage,
      createdAtIso: c.createdAt.toISOString(),
      editedAtIso: c.editedAt?.toISOString() ?? null,
      canModify: c.canModify,
    })),
    members,
    boardLabels: data.boardLabels,
    attachedLabelIds: data.attachedLabelIds,
    lists: data.lists,
    checklists: data.checklists,
    workspaceBoards,
    canWrite,
  };
}
