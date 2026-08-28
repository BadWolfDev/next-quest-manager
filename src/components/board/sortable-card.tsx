"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";

import {
  AssigneeChips,
  AssigneePopover,
  type AssignableMember,
} from "@/components/board/assignee-popover";
import type { BoardCardState } from "@/components/board/board-state";
import { cn } from "@/lib/utils";

/** The card's visual body, shared by the in-list item and the DragOverlay. */
export function CardBody({
  card,
  dragging = false,
  overlay = false,
  members,
  canWrite = false,
}: {
  card: BoardCardState;
  dragging?: boolean;
  overlay?: boolean;
  members?: AssignableMember[];
  canWrite?: boolean;
}) {
  return (
    <div
      className={cn(
        "nqm-skin-card bg-card rounded-lg border px-3 py-2.5 text-sm shadow-sm",
        overlay && "rotate-2 shadow-lg ring-2 ring-primary/40",
        dragging && "opacity-40",
      )}
    >
      {card.title}
      {card.dueDate ? (
        <span className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
          <CalendarClock className="size-3.5" />
          {card.dueDate.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}
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
}: {
  card: BoardCardState;
  listId: string;
  listName: string;
  boardId: string;
  members: AssignableMember[];
  canWrite: boolean;
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

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className="focus-visible:ring-ring/70 rounded-lg focus-visible:outline-none focus-visible:ring-2"
      // The whole card is the drag handle. Keyboard users get dnd-kit's
      // built-in behaviour: focus, Space to lift, arrows to move, Space to drop.
      // `attributes` already carries aria-roledescription, so it is spread last.
      aria-label={`${card.title}, in ${listName}`}
      onPointerDown={(event) => {
        downAt.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        // Controls layered on the card (the assignee popover) handle their own
        // clicks; don't hijack those.
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
      />
    </li>
  );
}
