import "server-only";

import { listAssignableMembersFor } from "@/lib/core/members";
import { getCardModalData } from "@/lib/core/board-ops";
import type { CardDetailData } from "@/components/card/card-detail";

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
  const members = await listAssignableMembersFor(data.workspace.id);

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
    },
    board: { id: data.board.id, name: data.board.name },
    assignees: data.assignees,
    members,
    boardLabels: data.boardLabels,
    attachedLabelIds: data.attachedLabelIds,
    lists: data.lists,
    checklists: data.checklists,
    canWrite: data.role !== "viewer",
  };
}
