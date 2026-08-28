import "server-only";

import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  cardAssignees,
  cardLabels,
  cards,
  checklistItems,
  checklists,
  labels,
  lists,
  users,
  workspaces,
} from "@/db/schema";

/**
 * The public, read-only board path.
 *
 * This module is deliberately isolated from `lib/authorize.ts`. It resolves a
 * share token straight to a board and returns data — it never sees a session,
 * and, just as importantly, the `authorize()` helpers never learn about tokens.
 * Keeping the two apart is what guarantees a share link cannot reach a mutation:
 * there is no code path where a token satisfies a membership check.
 *
 * Everything returned here is shaped for anonymous consumption. Notably the
 * payload carries **no email addresses** — only a display first name and an
 * avatar URL for assignees, because the serialized RSC payload is visible to
 * anyone with the link, not just the rendered UI.
 */

export const PUBLIC_TOKEN_PREFIX = "nqb_";

export function generatePublicToken(): string {
  return PUBLIC_TOKEN_PREFIX + randomBytes(24).toString("base64url");
}

/** Assignees are shown as a first name only — never an email. */
function publicName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "Someone";
}

export type PublicAssignee = { name: string; image: string | null };

export type PublicBoardCard = {
  id: string;
  title: string;
  dueDate: Date | null;
  labels: { id: string; name: string; color: string }[];
  assignees: PublicAssignee[];
  checklistDone: number;
  checklistTotal: number;
};

export type PublicBoard = {
  id: string;
  name: string;
  workspaceName: string;
  background: { type: "color" | "gradient"; value: string };
  updatedAt: Date;
  lists: { id: string; name: string; cards: PublicBoardCard[] }[];
};

/**
 * Resolve a share token to a board, or null.
 *
 * Archived boards, lists and cards are filtered out — a public link must never
 * surface something the team archived.
 */
export async function getPublicBoard(
  token: string,
): Promise<PublicBoard | null> {
  if (!token.startsWith(PUBLIC_TOKEN_PREFIX)) return null;

  const [board] = await db
    .select({
      id: boards.id,
      name: boards.name,
      background: boards.background,
      updatedAt: boards.updatedAt,
      workspaceName: workspaces.name,
    })
    .from(boards)
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .where(and(eq(boards.publicToken, token), isNull(boards.archivedAt)))
    .limit(1);

  if (!board) return null;

  const [listRows, cardRows, labelRows, assigneeRows, checklistRows] =
    await Promise.all([
      db
        .select({ id: lists.id, name: lists.name })
        .from(lists)
        .where(and(eq(lists.boardId, board.id), isNull(lists.archivedAt)))
        .orderBy(asc(lists.position)),
      db
        .select({
          id: cards.id,
          listId: cards.listId,
          title: cards.title,
          dueDate: cards.dueDate,
        })
        .from(cards)
        .where(and(eq(cards.boardId, board.id), isNull(cards.archivedAt)))
        .orderBy(asc(cards.position)),
      db
        .select({
          cardId: cardLabels.cardId,
          id: labels.id,
          name: labels.name,
          color: labels.color,
        })
        .from(cardLabels)
        .innerJoin(labels, eq(labels.id, cardLabels.labelId))
        .innerJoin(cards, eq(cards.id, cardLabels.cardId))
        .where(eq(cards.boardId, board.id)),
      // Name and avatar only. No id, no email.
      db
        .select({
          cardId: cardAssignees.cardId,
          name: users.name,
          image: users.image,
        })
        .from(cardAssignees)
        .innerJoin(users, eq(users.id, cardAssignees.userId))
        .innerJoin(cards, eq(cards.id, cardAssignees.cardId))
        .where(eq(cards.boardId, board.id)),
      db
        .select({
          cardId: checklists.cardId,
          completed: checklistItems.completed,
        })
        .from(checklistItems)
        .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
        .innerJoin(cards, eq(cards.id, checklists.cardId))
        .where(eq(cards.boardId, board.id)),
    ]);

  const labelsByCard = new Map<string, PublicBoardCard["labels"]>();
  for (const r of labelRows) {
    const b = labelsByCard.get(r.cardId) ?? [];
    b.push({ id: r.id, name: r.name, color: r.color });
    labelsByCard.set(r.cardId, b);
  }

  const assigneesByCard = new Map<string, PublicAssignee[]>();
  for (const r of assigneeRows) {
    const b = assigneesByCard.get(r.cardId) ?? [];
    b.push({ name: publicName(r.name), image: r.image });
    assigneesByCard.set(r.cardId, b);
  }

  const progressByCard = new Map<string, { done: number; total: number }>();
  for (const r of checklistRows) {
    const p = progressByCard.get(r.cardId) ?? { done: 0, total: 0 };
    p.total += 1;
    if (r.completed) p.done += 1;
    progressByCard.set(r.cardId, p);
  }

  const cardsByList = new Map<string, PublicBoardCard[]>();
  for (const c of cardRows) {
    const progress = progressByCard.get(c.id) ?? { done: 0, total: 0 };
    const bucket = cardsByList.get(c.listId) ?? [];
    bucket.push({
      id: c.id,
      title: c.title,
      dueDate: c.dueDate,
      labels: labelsByCard.get(c.id) ?? [],
      assignees: assigneesByCard.get(c.id) ?? [],
      checklistDone: progress.done,
      checklistTotal: progress.total,
    });
    cardsByList.set(c.listId, bucket);
  }

  return {
    id: board.id,
    name: board.name,
    workspaceName: board.workspaceName,
    background: board.background,
    updatedAt: board.updatedAt,
    lists: listRows.map((l) => ({
      id: l.id,
      name: l.name,
      cards: cardsByList.get(l.id) ?? [],
    })),
  };
}

export type PublicCardDetail = {
  id: string;
  title: string;
  description: string | null;
  listName: string;
  boardName: string;
  labels: { id: string; name: string; color: string }[];
  assignees: PublicAssignee[];
  checklists: {
    id: string;
    title: string;
    items: { id: string; content: string; completed: boolean }[];
  }[];
};

/**
 * One card, addressed by share token **and** card id.
 *
 * The token is part of the query, so a card id from a different board simply
 * does not match — there is no way to pivot from one public link to another
 * board's card.
 */
export async function getPublicCard(
  token: string,
  cardId: string,
): Promise<PublicCardDetail | null> {
  if (!token.startsWith(PUBLIC_TOKEN_PREFIX)) return null;

  const [card] = await db
    .select({
      id: cards.id,
      title: cards.title,
      description: cards.description,
      listName: lists.name,
      boardName: boards.name,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(lists, eq(lists.id, cards.listId))
    .where(
      and(
        eq(cards.id, cardId),
        eq(boards.publicToken, token),
        isNull(cards.archivedAt),
        isNull(lists.archivedAt),
        isNull(boards.archivedAt),
      ),
    )
    .limit(1);

  if (!card) return null;

  const [labelRows, assigneeRows, checklistRows, itemRows] = await Promise.all([
    db
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(cardLabels)
      .innerJoin(labels, eq(labels.id, cardLabels.labelId))
      .where(eq(cardLabels.cardId, cardId)),
    db
      .select({ name: users.name, image: users.image })
      .from(cardAssignees)
      .innerJoin(users, eq(users.id, cardAssignees.userId))
      .where(eq(cardAssignees.cardId, cardId)),
    db
      .select({ id: checklists.id, title: checklists.title })
      .from(checklists)
      .where(eq(checklists.cardId, cardId))
      .orderBy(asc(checklists.position)),
    db
      .select({
        id: checklistItems.id,
        checklistId: checklistItems.checklistId,
        content: checklistItems.content,
        completed: checklistItems.completed,
      })
      .from(checklistItems)
      .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
      .where(eq(checklists.cardId, cardId))
      .orderBy(asc(checklistItems.position)),
  ]);

  const byChecklist = new Map<string, typeof itemRows>();
  for (const i of itemRows) {
    const b = byChecklist.get(i.checklistId) ?? [];
    b.push(i);
    byChecklist.set(i.checklistId, b);
  }

  return {
    id: card.id,
    title: card.title,
    description: card.description,
    listName: card.listName,
    boardName: card.boardName,
    labels: labelRows,
    assignees: assigneeRows.map((a) => ({
      name: publicName(a.name),
      image: a.image,
    })),
    checklists: checklistRows.map((c) => ({
      id: c.id,
      title: c.title,
      items: (byChecklist.get(c.id) ?? []).map((i) => ({
        id: i.id,
        content: i.content,
        completed: i.completed,
      })),
    })),
  };
}

/** Freshness probe for the public page — token-keyed, nothing else exposed. */
export async function getPublicBoardVersion(
  token: string,
): Promise<number | null> {
  if (!token.startsWith(PUBLIC_TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({ updatedAt: boards.updatedAt })
    .from(boards)
    .where(and(eq(boards.publicToken, token), isNull(boards.archivedAt)))
    .limit(1);
  return row ? row.updatedAt.getTime() : null;
}
