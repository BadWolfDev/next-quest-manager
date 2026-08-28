"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useCallback, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { moveCardAction, moveListAction } from "@/actions/move";
import { ActivityPanel } from "@/components/board/activity-panel";
import { AddList } from "@/components/board/add-list";
import type { AssignableMember } from "@/components/board/assignee-popover";
import { useBoardFreshness } from "@/components/board/use-board-freshness";
import {
  applyMove,
  locateCard,
  neighboursOfCard,
  neighboursOfList,
  type BoardListState,
  type BoardMove,
} from "@/components/board/board-state";
import { CardBody } from "@/components/board/sortable-card";
import { ListPreview, SortableList } from "@/components/board/sortable-list";
import type { ActionState } from "@/lib/action-result";

const DROP_ANIMATION: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
  }),
};

/** Resolve a dnd-kit `over` id to a destination list, if any. */
function listIdFromOver(
  lists: BoardListState[],
  overId: string,
): string | null {
  if (overId.startsWith("dropzone:")) return overId.slice("dropzone:".length);
  if (lists.some((l) => l.id === overId)) return overId;
  const found = locateCard(lists, overId);
  return found ? lists[found.listIndex].id : null;
}

export function BoardView({
  boardId,
  lists,
  members,
  canWrite,
}: {
  boardId: string;
  lists: BoardListState[];
  members: AssignableMember[];
  /** False for viewers: no drag, no composers, no assignee controls. */
  canWrite: boolean;
}) {
  const [, startTransition] = useTransition();

  // Server truth -> optimistic overlay. `applyMove` is the same reducer used
  // for the live drag preview, so the arrangement never changes shape between
  // "dropped" and "confirmed".
  const [optimisticLists, applyOptimistic] = useOptimistic(lists, applyMove);

  // A working copy that exists only for the duration of a drag, so
  // cross-list previews can update on every dragOver without opening a
  // transition per pointer move.
  const [dragLists, setDragLists] = useState<BoardListState[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<"card" | "list" | null>(null);

  const board = dragLists ?? optimisticLists;

  // Reconcile with other people's edits. Paused while a drag is in flight or
  // while a composer/input on the board has focus, so a poll never yanks the
  // UI out from under someone mid-interaction.
  const [composerActive, setComposerActive] = useState(false);
  useBoardFreshness(boardId, activeId !== null || composerActive);

  /**
   * Server calls are serialised per board. Two quick drags must reach Postgres
   * in the order they happened — otherwise the second move computes its
   * fractional index from neighbours the first move has not written yet.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback((run: () => Promise<ActionState>) => {
    const result = queue.current.then(run, run);
    queue.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const dragSensors = useSensors(
    // A small threshold so a click on a card is still a click.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Long-press to lift on touch, so the board still scrolls with a swipe.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Viewers get an empty sensor list, so nothing is draggable for them at all.
  const sensors = canWrite ? dragSensors : [];

  const listIds = useMemo(() => board.map((l) => l.id), [board]);

  const activeCard = useMemo(() => {
    if (activeType !== "card" || !activeId) return null;
    const found = locateCard(board, activeId);
    return found ? board[found.listIndex].cards[found.cardIndex] : null;
  }, [activeType, activeId, board]);

  const activeList = useMemo(
    () =>
      activeType === "list" && activeId
        ? (board.find((l) => l.id === activeId) ?? null)
        : null,
    [activeType, activeId, board],
  );

  function handleDragStart(event: DragStartEvent) {
    const type = event.active.data.current?.type;
    setActiveId(String(event.active.id));
    setActiveType(type === "list" ? "list" : "card");
    setDragLists(optimisticLists);
  }

  /**
   * Cross-list preview. Reordering *within* a list is left to dnd-kit's
   * transforms and committed on drop — moving the array on every dragOver
   * inside one list makes the items jitter.
   */
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.data.current?.type !== "card") return;

    const cardId = String(active.id);
    const overId = String(over.id);

    setDragLists((current) => {
      const source = current ?? optimisticLists;
      const from = locateCard(source, cardId);
      if (!from) return source;

      const toListId = listIdFromOver(source, overId);
      if (!toListId || source[from.listIndex].id === toListId) return source;

      const target = source.find((l) => l.id === toListId);
      if (!target) return source;

      // Drop after the card being hovered when the pointer is past its middle.
      const overCardIndex = target.cards.findIndex((c) => c.id === overId);
      let index = overCardIndex === -1 ? target.cards.length : overCardIndex;
      if (overCardIndex !== -1) {
        const overRect = over.rect;
        const activeRect = active.rect.current.translated;
        if (
          activeRect &&
          activeRect.top > overRect.top + overRect.height / 2
        ) {
          index += 1;
        }
      }

      return applyMove(source, { kind: "card", cardId, toListId, toIndex: index });
    });
  }

  function finish() {
    setActiveId(null);
    setActiveType(null);
    setDragLists(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const working = dragLists ?? optimisticLists;

    if (!over) {
      finish();
      return;
    }

    const activeIdStr = String(active.id);
    const overId = String(over.id);
    const isList = active.data.current?.type === "list";

    if (isList) {
      const from = working.findIndex((l) => l.id === activeIdStr);
      const to = working.findIndex((l) => l.id === overId);
      if (from === -1 || to === -1 || from === to) {
        finish();
        return;
      }

      const move: BoardMove = { kind: "list", listId: activeIdStr, toIndex: to };
      const next = applyMove(working, move);
      const { afterListId, beforeListId } = neighboursOfList(next, activeIdStr);

      setActiveId(null);
      setActiveType(null);
      startTransition(async () => {
        applyOptimistic(move);
        setDragLists(null);
        const result = await enqueue(() =>
          moveListAction({ listId: activeIdStr, afterListId, beforeListId }),
        );
        if (!result.ok) {
          toast.error(result.message ?? "Could not move that list.");
        }
      });
      return;
    }

    // --- card ---
    const from = locateCard(working, activeIdStr);
    if (!from) {
      finish();
      return;
    }

    const toListId = listIdFromOver(working, overId);
    if (!toListId) {
      finish();
      return;
    }

    const targetList = working.find((l) => l.id === toListId);
    if (!targetList) {
      finish();
      return;
    }

    const overCardIndex = targetList.cards.findIndex((c) => c.id === overId);
    const toIndex =
      overCardIndex === -1 ? targetList.cards.length - 1 : overCardIndex;

    const move: BoardMove = {
      kind: "card",
      cardId: activeIdStr,
      toListId,
      toIndex: Math.max(0, toIndex),
    };

    const next = applyMove(working, move);
    const after = locateCard(next, activeIdStr);
    const before = locateCard(optimisticLists, activeIdStr);

    // Nothing actually changed — skip the round trip.
    if (
      after &&
      before &&
      next[after.listIndex].id === optimisticLists[before.listIndex].id &&
      after.cardIndex === before.cardIndex
    ) {
      finish();
      return;
    }

    const { afterCardId, beforeCardId } = neighboursOfCard(
      next,
      toListId,
      activeIdStr,
    );

    setActiveId(null);
    setActiveType(null);
    startTransition(async () => {
      applyOptimistic(move);
      setDragLists(null);
      const result = await enqueue(() =>
        moveCardAction({
          cardId: activeIdStr,
          targetListId: toListId,
          afterCardId,
          beforeCardId,
        }),
      );
      if (!result.ok) {
        toast.error(result.message ?? "Could not move that card.");
      }
    });
  }

  return (
    <div
      className="flex h-full flex-col"
      // Focus anywhere inside the board (a composer, a rename field) pauses
      // polling until focus leaves again.
      onFocusCapture={() => setComposerActive(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setComposerActive(false);
        }
      }}
    >
      <div className="mb-3 flex shrink-0 justify-end">
        <ActivityPanel boardId={boardId} />
      </div>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={finish}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${active.id}.`,
          onDragOver: ({ over }) =>
            over ? `Now over ${over.id}.` : "No drop target.",
          onDragEnd: ({ over }) =>
            over ? `Dropped onto ${over.id}.` : "Drop cancelled.",
          onDragCancel: () => "Move cancelled.",
        },
      }}
    >
      <SortableContext items={listIds} strategy={horizontalListSortingStrategy}>
        {/* One list per viewport with snap points on phones; free horizontal
            scroll from `sm` up. */}
        <ol className="flex h-full snap-x snap-mandatory items-start gap-4 overflow-x-auto pb-2 sm:snap-none">
          {board.map((list) => (
            <SortableList
              key={list.id}
              list={list}
              members={members}
              canWrite={canWrite}
            />
          ))}
          {canWrite ? (
            <li className="shrink-0 snap-center sm:snap-align-none">
              <AddList boardId={boardId} />
            </li>
          ) : null}
        </ol>
      </SortableContext>

      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {activeCard ? <CardBody card={activeCard} overlay /> : null}
        {activeList ? <ListPreview list={activeList} /> : null}
      </DragOverlay>
    </DndContext>
    </div>
  );
}
