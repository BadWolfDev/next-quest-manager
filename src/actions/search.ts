"use server";

import { z } from "zod";

import { searchCards } from "@/lib/core/board-ops";
import { logError } from "@/lib/log-error";
import { uuidSchema } from "@/lib/validation";

/**
 * Card search for the command palette.
 *
 * The one export here is a public endpoint, so it takes no actor: `searchCards`
 * resolves the caller from the session and scopes every row through
 * `workspace_members` with an inner join, so a card in a workspace the caller
 * is not a member of never leaves the database.
 */

const searchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  workspaceId: uuidSchema.nullable().default(null),
});

export type CardSearchHit = {
  cardId: string;
  title: string;
  listName: string;
  boardId: string;
  boardName: string;
  workspaceName: string;
};

export type CardSearchResult =
  | { ok: true; hits: CardSearchHit[] }
  | { ok: false; message: string };

export async function searchCardsAction(
  query: string,
  workspaceId?: string | null,
): Promise<CardSearchResult> {
  try {
    const parsed = searchSchema.safeParse({
      query,
      workspaceId: workspaceId ?? null,
    });
    // A too-short or malformed query is not an error worth surfacing — the
    // palette simply has nothing to show.
    if (!parsed.success) return { ok: true, hits: [] };

    const rows = await searchCards({
      query: parsed.data.query,
      workspaceId: parsed.data.workspaceId,
      limit: 20,
    });

    return {
      ok: true,
      hits: rows.map((row) => ({
        cardId: row.cardId,
        title: row.title,
        listName: row.listName,
        boardId: row.boardId,
        boardName: row.boardName,
        workspaceName: row.workspaceName,
      })),
    };
  } catch (error) {
    logError("[search]", error);
    return { ok: false, message: "Search is unavailable right now." };
  }
}
