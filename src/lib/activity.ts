import "server-only";

import { activityLog } from "@/db/schema";
import type { Database } from "@/db";

export type ActivityInput = {
  workspaceId: string;
  boardId?: string | null;
  cardId?: string | null;
  actorId: string;
  type: string;
  data?: Record<string, unknown>;
};

/**
 * Append an audit entry. Takes an explicit `tx` so mutations and their activity
 * row commit together.
 */
export async function recordActivity(
  tx: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: ActivityInput,
) {
  await tx.insert(activityLog).values({
    workspaceId: input.workspaceId,
    boardId: input.boardId ?? null,
    cardId: input.cardId ?? null,
    actorId: input.actorId,
    type: input.type,
    data: input.data ?? {},
  });
}
