"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { AddCard } from "@/components/board/add-card";
import type { AssignableMember } from "@/components/board/assignee-popover";
import { listAccent } from "@/components/board/list-accent";
import type { BoardListState } from "@/components/board/board-state";
import { ListHeader } from "@/components/board/list-header";
import { CardBody, SortableCard } from "@/components/board/sortable-card";
import { cn } from "@/lib/utils";

/** Id used for the empty-space drop zone inside a list. */
export function dropZoneId(listId: string) {
  return `dropzone:${listId}`;
}

/** Shared column chrome, so the DragOverlay looks exactly like the real thing. */
export function ListShell({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn(
        "nqm-skin-column bg-muted/50 flex max-h-full w-[85vw] max-w-[20rem] shrink-0 snap-center flex-col rounded-xl border p-2.5 sm:w-72 sm:snap-align-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ListPreview({ list }: { list: BoardListState }) {
  return (
    <ListShell className="rotate-1 shadow-xl ring-2 ring-primary/40">
      <div className="flex items-baseline justify-between px-2 pb-2">
        <span className="text-sm font-semibold">{list.name}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {list.cards.length}
        </span>
      </div>
      <ul className="space-y-2">
        {list.cards.slice(0, 3).map((card) => (
          <li key={card.id}>
            <CardBody card={card} />
          </li>
        ))}
      </ul>
    </ListShell>
  );
}

export function SortableList({
  list,
  index,
  boardId,
  members,
  canWrite,
}: {
  list: BoardListState;
  /** Position on the board; drives the retro skin's top-rule colour. */
  index: number;
  boardId: string;
  members: AssignableMember[];
  canWrite: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id, data: { type: "list" } });

  // A separate droppable covering the card area, so a card can be dropped into
  // a list that has no cards to aim at.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropZoneId(list.id),
    data: { type: "dropzone", listId: list.id },
  });

  const cardIds = list.cards.map((c) => c.id);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex", isDragging && "opacity-40")}
      aria-roledescription="Draggable list"
    >
      <ListShell style={{ "--list-accent": listAccent(index) } as React.CSSProperties}>
        <ListHeader
          listId={list.id}
          name={list.name}
          cardCount={list.cards.length}
          canWrite={canWrite}
          dragHandleProps={canWrite ? { ...attributes, ...listeners } : undefined}
        />

        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          <ul
            ref={setDropRef}
            className={cn(
              "min-h-2 flex-1 space-y-2 overflow-y-auto rounded-lg transition-colors",
              isOver && "bg-primary/5 ring-1 ring-primary/30",
            )}
          >
            {list.cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                listId={list.id}
                listName={list.name}
                boardId={boardId}
                members={members}
                canWrite={canWrite}
              />
            ))}
          </ul>
        </SortableContext>

        {list.cards.length === 0 ? (
          <p className="text-muted-foreground px-1.5 pt-2 text-xs">
            Nothing here yet.
          </p>
        ) : null}

        {canWrite ? <AddCard listId={list.id} listName={list.name} /> : null}
      </ListShell>
    </li>
  );
}
