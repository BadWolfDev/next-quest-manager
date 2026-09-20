"use client";

import { ArrowRightLeft, Copy, MoreHorizontal, Trash2, X } from "lucide-react";
import { useState } from "react";

import {
  archiveCardAction,
  moveCardToListAction,
  updateCardDetailAction,
} from "@/actions/card-detail";
import {
  AssigneeChips,
  AssigneePopover,
} from "@/components/board/assignee-popover";
import { CardChecklists } from "@/components/card/card-checklists";
import { CardComments } from "@/components/card/card-comments";
import { CardDescription } from "@/components/card/card-description";
import { CardDueDate } from "@/components/card/card-due-date";
import { useBoundAction } from "@/components/card/card-hooks";
import { CardLabels } from "@/components/card/card-labels";
import {
  CopyCardDialog,
  MoveToBoardDialog,
} from "@/components/card/card-transfer";
import { CardWatch } from "@/components/card/card-watch";
import type { CardDetailData } from "@/components/card/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type { CardDetailData } from "@/components/card/types";

export function CardDetail({
  data,
  onClose,
}: {
  data: CardDetailData;
  onClose: () => void;
}) {
  const { card, board, canWrite } = data;

  const [editingTitle, setEditingTitle] = useState(false);
  // "copy" | "move" | null. The dialogs are siblings of the dropdown, so the
  // menu closing cannot unmount them.
  const [dialog, setDialog] = useState<"copy" | "move" | null>(null);

  const [, titleAction] = useBoundAction(updateCardDetailAction, () =>
    setEditingTitle(false),
  );
  const [, moveAction] = useBoundAction(moveCardToListAction);
  const [, archiveAction] = useBoundAction(archiveCardAction, onClose);

  const allItems = data.checklists.flatMap((c) => c.items);
  const doneCount = allItems.filter((i) => i.completed).length;
  const progress = allItems.length
    ? Math.round((doneCount / allItems.length) * 100)
    : 0;
  const checklistComplete = allItems.length > 0 && doneCount === allItems.length;

  return (
    <div className="flex max-h-[85vh] w-full flex-col overflow-hidden">
      {/* Title bar ------------------------------------------------------- */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
        <span className="nqm-skin-kicker text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
          <span
            aria-hidden="true"
            className="bg-primary inline-block size-2 shrink-0"
          />
          Card detail · {card.ref}
        </span>

        <div className="flex items-center gap-1">
          {canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-[26px]"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog("copy")}>
                  <Copy className="size-4" aria-hidden="true" />
                  Copy card
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("move")}>
                  <ArrowRightLeft className="size-4" aria-hidden="true" />
                  Move to board…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action={archiveAction}>
                  <input type="hidden" name="cardId" value={card.id} />
                  <input type="hidden" name="boardId" value={board.id} />
                  <DropdownMenuItem asChild variant="destructive">
                    <button type="submit" className="w-full cursor-pointer">
                      <Trash2 className="size-4" aria-hidden="true" />
                      Archive card
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-[26px]"
            onClick={onClose}
            aria-label="Close card"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {canWrite ? (
        <>
          <CopyCardDialog
            open={dialog === "copy"}
            onOpenChange={(open) => setDialog(open ? "copy" : null)}
            cardId={card.id}
            cardTitle={card.title}
            lists={data.lists}
            currentListId={card.listId}
          />
          <MoveToBoardDialog
            open={dialog === "move"}
            onOpenChange={(open) => setDialog(open ? "move" : null)}
            cardId={card.id}
            currentBoardId={board.id}
            boards={data.workspaceBoards}
          />
        </>
      ) : null}

      {/* Body ------------------------------------------------------------ */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {/* Title */}
        {editingTitle && canWrite ? (
          <form action={titleAction} className="flex gap-2">
            <input type="hidden" name="cardId" value={card.id} />
            <input type="hidden" name="boardId" value={board.id} />
            <Input
              name="title"
              defaultValue={card.title}
              autoFocus
              required
              maxLength={500}
              aria-label="Card title"
              className="flex-1 text-lg font-semibold"
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditingTitle(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <button
            type="button"
            disabled={!canWrite}
            onClick={() => setEditingTitle(true)}
            className={cn(
              "nqm-skin-modal-title block w-full text-left text-xl font-semibold tracking-tight",
              canWrite && "hover:bg-accent/40 -mx-1 rounded px-1",
            )}
          >
            {card.title}
          </button>
        )}

        <p className="nqm-skin-kicker text-muted-foreground mt-2 text-xs uppercase tracking-wide">
          In list · {card.listName}
        </p>

        <CardLabels
          cardId={card.id}
          boardId={board.id}
          boardLabels={data.boardLabels}
          attachedLabelIds={data.attachedLabelIds}
          canWrite={canWrite}
        />

        {/* Split: description | right rail --------------------------------- */}
        <div className="mt-6 flex flex-col gap-6 sm:flex-row">
          <div className="min-w-0 flex-1">
            <h2 className="nqm-skin-kicker text-muted-foreground mb-2 text-xs uppercase tracking-wide">
              Description
            </h2>
            <CardDescription
              cardId={card.id}
              boardId={board.id}
              description={card.description}
              canWrite={canWrite}
            />
          </div>

          <aside className="w-full shrink-0 space-y-5 sm:w-[210px]">
            <div>
              <h2 className="nqm-skin-kicker text-muted-foreground mb-2 text-xs uppercase tracking-wide">
                Members
              </h2>
              <div className="flex items-center gap-2">
                <AssigneeChips assignees={data.assignees} max={4} />
                {canWrite ? (
                  <AssigneePopover
                    cardId={card.id}
                    cardTitle={card.title}
                    assignees={data.assignees}
                    members={data.members}
                  />
                ) : null}
              </div>
            </div>

            <CardDueDate
              cardId={card.id}
              boardId={board.id}
              dueDateIso={card.dueDateIso}
              completed={checklistComplete}
              canWrite={canWrite}
            />

            <CardWatch
              cardId={card.id}
              watchers={data.watchers}
              watching={data.watching}
            />

            {allItems.length > 0 ? (
              <div>
                <h2 className="nqm-skin-kicker text-muted-foreground mb-2 text-xs uppercase tracking-wide">
                  Progress
                </h2>
                <div
                  className="bg-muted h-2 w-full overflow-hidden border"
                  role="progressbar"
                  aria-valuenow={doneCount}
                  aria-valuemin={0}
                  aria-valuemax={allItems.length}
                  aria-label="Checklist progress"
                >
                  <div
                    className="bg-primary h-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-muted-foreground mt-1.5 text-xs tabular-nums">
                  {doneCount} / {allItems.length}
                </p>
              </div>
            ) : null}
          </aside>
        </div>

        <CardChecklists
          cardId={card.id}
          boardId={board.id}
          checklists={data.checklists}
          canWrite={canWrite}
        />

        <CardComments
          cardId={card.id}
          comments={data.comments}
          canWrite={canWrite}
        />
      </div>

      {/* Footer ---------------------------------------------------------- */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>Close</Button>

          {canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Move</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Move to list
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {data.lists.map((l) => (
                  <form key={l.id} action={moveAction}>
                    <input type="hidden" name="cardId" value={card.id} />
                    <input type="hidden" name="boardId" value={board.id} />
                    <input type="hidden" name="targetListId" value={l.id} />
                    <DropdownMenuItem asChild>
                      <button
                        type="submit"
                        className="w-full cursor-pointer"
                        disabled={l.id === card.listId}
                      >
                        {l.name}
                        {l.id === card.listId ? " ✓" : ""}
                      </button>
                    </DropdownMenuItem>
                  </form>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <span className="nqm-skin-kicker text-muted-foreground text-xs uppercase tracking-wide">
          Updated {card.updatedLabel}
        </span>
      </div>
    </div>
  );
}
