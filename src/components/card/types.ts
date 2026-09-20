import type { AssignableMember } from "@/components/board/assignee-popover";

/**
 * Everything the card detail renders, in serialisable form.
 *
 * Lives in its own module rather than in `card-detail.tsx` so the section
 * components (`card-comments`, `card-checklists`, …) can type their props
 * without importing the component that renders them.
 *
 * Dates cross the RSC boundary as ISO strings and are formatted client-side
 * behind `useMounted()`, because a locale- or timezone-derived string rendered
 * on the server will not match the one the browser produces.
 */

export type CardDetailPerson = {
  userId: string;
  name: string;
  image: string | null;
};

export type CardDetailComment = {
  id: string;
  body: string;
  authorName: string | null;
  authorImage: string | null;
  createdAtIso: string;
  editedAtIso: string | null;
  /** Author, or a workspace admin/owner — the same rule the action enforces. */
  canModify: boolean;
};

export type CardDetailLabel = { id: string; name: string; color: string };

export type CardDetailChecklistItem = {
  id: string;
  content: string;
  completed: boolean;
};

export type CardDetailChecklist = {
  id: string;
  title: string;
  items: CardDetailChecklistItem[];
};

/** A board in the same workspace, with the lists a card could be moved into. */
export type WorkspaceBoardOption = {
  id: string;
  name: string;
  lists: { id: string; name: string }[];
};

export type CardDetailData = {
  card: {
    id: string;
    title: string;
    description: string | null;
    listId: string;
    listName: string;
    updatedLabel: string;
    ref: string;
    /** ISO 8601, or null when no due date is set. */
    dueDateIso: string | null;
  };
  board: { id: string; name: string };
  assignees: CardDetailPerson[];
  watchers: CardDetailPerson[];
  /** Whether the *current* viewer is following this card. */
  watching: boolean;
  comments: CardDetailComment[];
  members: AssignableMember[];
  boardLabels: CardDetailLabel[];
  attachedLabelIds: string[];
  lists: { id: string; name: string }[];
  checklists: CardDetailChecklist[];
  /**
   * Other boards in the same workspace, for "Move to board…".
   *
   * Decorative: loaded through `safeRead`, so a failure here empties the
   * picker rather than 500ing the card page.
   */
  workspaceBoards: WorkspaceBoardOption[];
  canWrite: boolean;
};
