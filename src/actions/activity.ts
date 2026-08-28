"use server";

import { desc, eq, lt, and } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { activityLog, users } from "@/db/schema";
import { requireBoardAccess, READ_MIN_ROLE } from "@/lib/authorize";
import { uuidSchema } from "@/lib/validation";

export type ActivityEntry = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  actorName: string | null;
  actorImage: string | null;
  createdAtIso: string;
  viaMcp: boolean;
};

const PAGE_SIZE = 25;

/**
 * A board's activity, newest first, cursor-paginated on `created_at`.
 *
 * Authorised at the read floor against the board — an outsider gets an
 * authorization error rather than a page of someone else's history.
 */
export type ActivityPage = {
  entries: ActivityEntry[];
  nextCursor: string | null;
  /** Set when the caller may not read this board. */
  error?: string;
};

export async function fetchBoardActivityAction(input: {
  boardId: string;
  /** ISO timestamp of the oldest entry already shown. */
  before?: string | null;
}): Promise<ActivityPage> {
  let boardId: string;
  let before: string | null;

  try {
    boardId = uuidSchema.parse(input.boardId);
    before = z.iso.datetime().nullish().parse(input.before ?? null) ?? null;
    // Denial is returned as data, not thrown: an unhandled throw here becomes a
    // 500 and a logged stack for what is an ordinary "not yours" answer.
    await requireBoardAccess(boardId, READ_MIN_ROLE);
  } catch {
    return {
      entries: [],
      nextCursor: null,
      error: "This board is not available.",
    };
  }

  const conditions = [eq(activityLog.boardId, boardId)];
  if (before) conditions.push(lt(activityLog.createdAt, new Date(before)));

  const rows = await db
    .select({
      id: activityLog.id,
      type: activityLog.type,
      data: activityLog.data,
      createdAt: activityLog.createdAt,
      actorName: users.name,
      actorImage: users.image,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorId))
    .where(and(...conditions))
    .orderBy(desc(activityLog.createdAt))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;

  return {
    entries: page.map((r) => ({
      id: r.id,
      type: r.type,
      data: r.data,
      actorName: r.actorName,
      actorImage: r.actorImage,
      createdAtIso: r.createdAt.toISOString(),
      viaMcp: r.data?.source === "mcp",
    })),
    nextCursor: hasMore
      ? page[page.length - 1].createdAt.toISOString()
      : null,
  };
}
