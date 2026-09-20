"use client";

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addChecklistItemAction,
  createChecklistAction,
  deleteChecklistItemAction,
  moveChecklistItemAction,
  toggleChecklistItemAction,
} from "@/actions/card-detail";
import { useBoundAction, useQuickAction } from "@/components/card/card-hooks";
import type {
  CardDetailChecklist,
  CardDetailChecklistItem,
} from "@/components/card/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Reorder = { activeId: string; overId: string };

/** Pure: the same function drives the optimistic overlay and the neighbours. */
function reorder(
  items: CardDetailChecklistItem[],
  { activeId, overId }: Reorder,
): CardDetailChecklistItem[] {
  const from = items.findIndex((i) => i.id === activeId);
  const to = items.findIndex((i) => i.id === overId);
  if (from === -1 || to === -1 || from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function SortableItem({
  item,
  boardId,
  canWrite,
}: {
  item: CardDetailChecklistItem;
  boardId: string;
  canWrite: boolean;
}) {
  const [pending, quick] = useQuickAction();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canWrite });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex items-start gap-2", isDragging && "opacity-40")}
    >
      {canWrite ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Reorder ${item.content}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 mt-0.5 shrink-0 cursor-grab rounded-sm focus-visible:outline-none focus-visible:ring-2"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <span aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      )}

      <input
        type="checkbox"
        checked={item.completed}
        disabled={!canWrite || pending}
        aria-label={item.content}
        onChange={() =>
          quick(toggleChecklistItemAction, {
            itemId: item.id,
            boardId,
            completed: item.completed ? "false" : "true",
          })
        }
        className="accent-primary mt-1 size-4 shrink-0"
      />

      <span
        className={cn(
          "min-w-0 flex-1 text-sm",
          item.completed && "text-muted-foreground line-through opacity-60",
        )}
      >
        {item.content}
      </span>

      {canWrite ? (
        <button
          type="button"
          disabled={pending}
          aria-label={`Delete ${item.content}`}
          onClick={() =>
            quick(deleteChecklistItemAction, { itemId: item.id, boardId })
          }
          className="text-muted-foreground hover:text-destructive mt-0.5 shrink-0"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

function ChecklistBlock({
  checklist,
  boardId,
  canWrite,
}: {
  checklist: CardDetailChecklist;
  boardId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Server truth -> optimistic overlay. When the action fails the transition
  // ends without a refresh and React discards the overlay, which is the
  // rollback.
  const [items, applyReorder] = useOptimistic(checklist.items, reorder);
  // Remount the composer after a successful add so the input empties.
  const [itemKey, setItemKey] = useState(0);
  const [, addAction] = useBoundAction(addChecklistItemAction, () =>
    setItemKey((n) => n + 1),
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function onDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId === activeId) return;

    // Neighbours, never a position string: the server recomputes the
    // fractional index from rows it re-reads inside its own transaction.
    const next = reorder(items, { activeId, overId });
    const at = next.findIndex((i) => i.id === activeId);
    if (at === -1) return;
    const afterId = at > 0 ? next[at - 1].id : null;
    const beforeId = at < next.length - 1 ? next[at + 1].id : null;

    startTransition(async () => {
      applyReorder({ activeId, overId });
      const result = await moveChecklistItemAction({
        itemId: activeId,
        afterId,
        beforeId,
      });
      if (!result.ok) {
        toast.error(result.message ?? "Couldn't reorder that item.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mb-5">
      <p className="mb-2 text-sm font-medium">{checklist.title}</p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-3">
            {items.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                boardId={boardId}
                canWrite={canWrite}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {canWrite ? (
        <form key={itemKey} action={addAction} className="mt-3 flex gap-2">
          <input type="hidden" name="checklistId" value={checklist.id} />
          <input type="hidden" name="boardId" value={boardId} />
          <label htmlFor={`add-item-${checklist.id}`} className="sr-only">
            Add an item to {checklist.title}
          </label>
          <Input
            id={`add-item-${checklist.id}`}
            name="content"
            required
            maxLength={500}
            placeholder="Add an item"
            autoComplete="off"
            className="h-8 max-w-sm text-sm"
          />
          <Button type="submit" size="sm" variant="outline">
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function CardChecklists({
  cardId,
  boardId,
  checklists,
  canWrite,
}: {
  cardId: string;
  boardId: string;
  checklists: CardDetailChecklist[];
  canWrite: boolean;
}) {
  const [, createAction] = useBoundAction(createChecklistAction);

  return (
    <section className="mt-7">
      <h2 className="nqm-skin-kicker text-muted-foreground mb-3 text-xs uppercase tracking-wide">
        Checklist
      </h2>

      {checklists.length === 0 ? (
        canWrite ? (
          <form action={createAction} className="flex gap-2">
            <input type="hidden" name="cardId" value={cardId} />
            <input type="hidden" name="boardId" value={boardId} />
            <label htmlFor="new-checklist" className="sr-only">
              Checklist name
            </label>
            <Input
              id="new-checklist"
              name="title"
              required
              maxLength={80}
              placeholder="Checklist name"
              autoComplete="off"
              className="h-8 max-w-xs text-sm"
            />
            <Button type="submit" size="sm">
              <Plus className="size-3.5" aria-hidden="true" />
              Add checklist
            </Button>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">No checklist.</p>
        )
      ) : (
        checklists.map((checklist) => (
          <ChecklistBlock
            key={checklist.id}
            checklist={checklist}
            boardId={boardId}
            canWrite={canWrite}
          />
        ))
      )}
    </section>
  );
}
