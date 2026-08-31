import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import type { WorkspaceRole } from "@/db/schema";
import {
  boards,
  cards,
  lists,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { assigneesForBoard, labelsForBoard } from "@/lib/core/board-ops";
import { toPlainExcerpt } from "@/lib/excerpt";
import {
  requireBoardAccess,
  requireUser,
  requireWorkspaceMemberBySlug,
  READ_MIN_ROLE,
  type Actor,
} from "@/lib/authorize";

/**
 * Read-side queries. Each one starts with an authorize() helper and then scopes
 * every row through `workspace_members` in SQL.
 */

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  theme: { accent?: string };
};

/** Every workspace the signed-in user belongs to. */
export async function listMyWorkspaces(
  actor?: Actor,
): Promise<WorkspaceSummary[]> {
  const user = actor ?? (await requireUser());

  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
      theme: workspaces.theme,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .orderBy(asc(workspaces.createdAt));
}

export type BoardSummary = {
  id: string;
  name: string;
  background: { type: "color" | "gradient"; value: string };
  archivedAt: Date | null;
  updatedAt: Date;
};

/** Boards inside a workspace the caller is a member of. */
export async function listWorkspaceBoards(
  workspaceId: string,
  { includeArchived = false } = {},
  actor?: Actor,
): Promise<BoardSummary[]> {
  const user = actor ?? (await requireUser());

  const conditions = [
    eq(boards.workspaceId, workspaceId),
    ...(includeArchived ? [] : [isNull(boards.archivedAt)]),
  ];

  return db
    .select({
      id: boards.id,
      name: boards.name,
      background: boards.background,
      archivedAt: boards.archivedAt,
      updatedAt: boards.updatedAt,
    })
    .from(boards)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, boards.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(boards.createdAt));
}

/** Workspace + its boards, addressed by slug. Throws if not a member. */
export async function getWorkspacePage(slug: string) {
  const ctx = await requireWorkspaceMemberBySlug(slug, READ_MIN_ROLE);
  const boardList = await listWorkspaceBoards(ctx.workspace.id);
  return { ...ctx, boards: boardList };
}

export type BoardCardAssignee = {
  userId: string;
  name: string;
  image: string | null;
};

export type BoardCardLabel = {
  id: string;
  name: string;
  color: string;
};

export type BoardList = {
  id: string;
  name: string;
  position: string;
  cards: {
    id: string;
    title: string;
    position: string;
    dueDate: Date | null;
    assignees: BoardCardAssignee[];
    labels: BoardCardLabel[];
    /**
     * Plain-text preview only — the full markdown never reaches the board
     * payload. See lib/excerpt.ts.
     */
    excerpt: string | null;
  }[];
};

/**
 * A board with its lists and cards, ordered by fractional index.
 *
 * Two flat queries rather than a join fan-out; cards are grouped in memory but
 * both queries are already membership-scoped in SQL.
 */
export async function getBoardPage(boardId: string) {
  const ctx = await requireBoardAccess(boardId, READ_MIN_ROLE);

  const [listRows, cardRows] = await Promise.all([
    db
      .select({
        id: lists.id,
        name: lists.name,
        position: lists.position,
      })
      .from(lists)
      .where(and(eq(lists.boardId, ctx.board.id), isNull(lists.archivedAt)))
      .orderBy(asc(lists.position)),
    db
      .select({
        id: cards.id,
        listId: cards.listId,
        title: cards.title,
        position: cards.position,
        dueDate: cards.dueDate,
        description: cards.description,
      })
      .from(cards)
      .where(and(eq(cards.boardId, ctx.board.id), isNull(cards.archivedAt)))
      .orderBy(asc(cards.position)),
  ]);

  const [assignees, cardLabelsByCard] = await Promise.all([
    assigneesForBoard(ctx.board.id),
    labelsForBoard(ctx.board.id),
  ]);

  const byList = new Map<string, BoardList["cards"]>();
  for (const card of cardRows) {
    const bucket = byList.get(card.listId) ?? [];
    bucket.push({
      id: card.id,
      title: card.title,
      position: card.position,
      dueDate: card.dueDate,
      assignees: assignees.get(card.id) ?? [],
      labels: cardLabelsByCard.get(card.id) ?? [],
      // Truncated here so the full description never leaves the server.
      excerpt: toPlainExcerpt(card.description),
    });
    byList.set(card.listId, bucket);
  }

  const boardLists: BoardList[] = listRows.map((list) => ({
    ...list,
    cards: byList.get(list.id) ?? [],
  }));

  return { ...ctx, lists: boardLists };
}

export type NavBoard = {
  id: string;
  name: string;
  workspaceId: string;
  background: { type: "color" | "gradient"; value: string };
};

/**
 * Every non-archived board across every workspace the caller belongs to.
 * One membership-scoped query feeds the whole sidebar, so navigating between
 * workspaces does not need another round trip.
 */
export async function listMyBoards(): Promise<NavBoard[]> {
  const user = await requireUser();

  return db
    .select({
      id: boards.id,
      name: boards.name,
      workspaceId: boards.workspaceId,
      background: boards.background,
    })
    .from(boards)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, boards.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(isNull(boards.archivedAt))
    .orderBy(asc(boards.createdAt));
}

/** The workspace to land on after sign-in. */
export async function getDefaultWorkspace(): Promise<WorkspaceSummary | null> {
  const all = await listMyWorkspaces();
  return all[0] ?? null;
}
