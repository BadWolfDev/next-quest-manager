"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Loader2, Paperclip, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";

import {
  AssigneeChips,
  AssigneePopover,
  type AssignableMember,
} from "@/components/board/assignee-popover";
import type { BoardCardState } from "@/components/board/board-state";
import { CardMenu, type CardEdge } from "@/components/board/card-menu";
import { DUE_TONE, dueLabel, dueStatus } from "@/components/board/due-status";
import { LabelChips } from "@/components/board/label-chips";
import {
  describeProgress,
  useAttachmentUploader,
  useBoardAttachmentMaxBytes,
  useFileDropTarget,
} from "@/components/card/attachment-upload";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

/**
 * The due-date pill.
 *
 * "Overdue" and "due soon" depend on the current clock, which the server and
 * the browser do not share. `useNow()` reports 0 on the server and during
 * hydration — same DOM shape, same text, neutral tone — and flips to the real
 * time on the client, so no className has to survive a hydration comparison.
 */
function DueBadge({ due }: { due: Date }) {
  const status = dueStatus(due, useNow());

  return (
    <span
      className={cn(
        "mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs",
        DUE_TONE[status],
      )}
    >
      <CalendarClock aria-hidden="true" className="size-3.5" />
      {dueLabel(due, status)}
    </span>
  );
}

/** The card's visual body, shared by the in-list item and the DragOverlay. */
export function CardBody({
  card,
  dragging = false,
  overlay = false,
  members,
  canWrite = false,
  boardId,
  canMoveUp = false,
  canMoveDown = false,
  onMoveToEdge,
}: {
  card: BoardCardState;
  dragging?: boolean;
  overlay?: boolean;
  members?: AssignableMember[];
  canWrite?: boolean;
  boardId?: string;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveToEdge?: (cardId: string, edge: CardEdge) => void;
}) {
  // Viewers get no quick menu at all — every item on it is a mutation or a
  // shortcut to one.
  const showMenu = canWrite && !overlay && boardId && onMoveToEdge;

  return (
    <div
      className={cn(
        "nqm-skin-card bg-card group/card rounded-lg border px-3 py-2.5 text-sm shadow-sm",
        overlay && "rotate-2 shadow-lg ring-2 ring-primary/40",
        dragging && "opacity-40",
      )}
    >
      <LabelChips labels={card.labels} className="mb-1.5" />

      <span className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1">{card.title}</span>
        {showMenu ? (
          <CardMenu
            cardId={card.id}
            cardTitle={card.title}
            boardId={boardId}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveToEdge={onMoveToEdge}
          />
        ) : null}
      </span>

      {card.excerpt ? (
        <span className="text-muted-foreground mt-1 block text-xs leading-snug">
          {card.excerpt}
        </span>
      ) : null}

      {card.dueDate || card.attachmentCount > 0 ? (
        <span className="flex flex-wrap items-center gap-x-2">
          {card.dueDate ? <DueBadge due={card.dueDate} /> : null}
          {card.attachmentCount > 0 ? (
            <span
              className="text-muted-foreground mt-1.5 inline-flex items-center gap-1 text-xs tabular-nums"
              aria-label={`${card.attachmentCount} attachment${card.attachmentCount === 1 ? "" : "s"}`}
              title={`${card.attachmentCount} attachment${card.attachmentCount === 1 ? "" : "s"}`}
            >
              <Paperclip aria-hidden="true" className="size-3.5" />
              {card.attachmentCount}
            </span>
          ) : null}
        </span>
      ) : null}

      {card.assignees.length > 0 || (canWrite && !overlay) ? (
        <span className="mt-2 flex items-center justify-between gap-2">
          <AssigneeChips assignees={card.assignees} />
          {canWrite && !overlay && members ? (
            <AssigneePopover
              cardId={card.id}
              cardTitle={card.title}
              assignees={card.assignees}
              members={members}
            />
          ) : (
            <span />
          )}
        </span>
      ) : null}
    </div>
  );
}

export function SortableCard({
  card,
  listId,
  listName,
  boardId,
  members,
  canWrite,
  canMoveUp,
  canMoveDown,
  onMoveToEdge,
}: {
  card: BoardCardState;
  listId: string;
  listName: string;
  boardId: string;
  members: AssignableMember[];
  canWrite: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveToEdge: (cardId: string, edge: CardEdge) => void;
}) {
  const router = useRouter();
  // Where the pointer went down, so a drag is never mistaken for a click.
  // dnd-kit's own 5px activation threshold handles the drag side; this handles
  // the click side, including the case where dnd-kit did not activate but the
  // pointer still travelled.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: "card", listId },
  });

  // Dropping files from the OS onto the card attaches them. These are native
  // HTML5 drag events, which dnd-kit's pointer/keyboard sensors never see, so
  // the two cannot interfere; non-file drags are ignored. The board only
  // provides an upload config to writers, so viewers get no target.
  const maxBytes = useBoardAttachmentMaxBytes();
  const uploader = useAttachmentUploader({
    cardId: card.id,
    existingCount: card.attachmentCount,
    maxBytes: canWrite ? maxBytes : null,
  });
  const { over: fileOver, handlers: fileDrop } = useFileDropTarget(
    canWrite && maxBytes !== null,
    (files) => void uploader.upload(files),
  );
  const { progress } = uploader;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className="focus-visible:ring-ring/70 relative rounded-lg focus-visible:outline-none focus-visible:ring-2"
      {...fileDrop}
      // The whole card is the drag handle. Keyboard users get dnd-kit's
      // built-in behaviour: focus, Space to lift, arrows to move, Space to drop.
      // `attributes` already carries aria-roledescription, so it is spread last.
      aria-label={`${card.title}, in ${listName}`}
      onPointerDown={(event) => {
        downAt.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        // Controls layered on the card (the assignee popover, the quick menu)
        // handle their own clicks; don't hijack those.
        if ((event.target as HTMLElement).closest("[data-card-control]")) return;
        const from = downAt.current;
        downAt.current = null;
        if (
          from &&
          Math.hypot(event.clientX - from.x, event.clientY - from.y) > 5
        ) {
          return; // that was a drag, not a click
        }
        router.push(`/b/${boardId}/c/${card.id}`);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          router.push(`/b/${boardId}/c/${card.id}`);
        }
      }}
      {...attributes}
      {...listeners}
    >
      <CardBody
        card={card}
        dragging={isDragging}
        members={members}
        canWrite={canWrite}
        boardId={boardId}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMoveToEdge={onMoveToEdge}
      />

      {fileOver || progress ? (
        <span
          aria-hidden={!progress}
          role={progress ? "status" : undefined}
          className={cn(
            "bg-background/90 pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-2 text-xs font-medium",
            fileOver ? "border-primary" : "border-muted-foreground/40",
          )}
        >
          {progress ? (
            <>
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
              <span className="truncate">
                {describeProgress(progress, { withFilename: false })}
              </span>
            </>
          ) : (
            <>
              <Upload className="text-primary size-3.5 shrink-0" aria-hidden="true" />
              Drop to attach
            </>
          )}
        </span>
      ) : null}
    </li>
  );
}
