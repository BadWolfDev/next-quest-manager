"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { copyCardAction, moveCardToBoardAction } from "@/actions/card-detail";
import type { WorkspaceBoardOption } from "@/components/card/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { idleState } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/**
 * "Copy card" and "Move to board…".
 *
 * Both are rendered as *siblings* of the action dropdown, never inside it:
 * choosing a menu item closes the menu, which would unmount a dialog nested
 * within it before it could open.
 */

const SELECT_CLASS =
  "border-input bg-background focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-2 text-sm focus-visible:outline-none focus-visible:ring-3";

export function CopyCardDialog({
  open,
  onOpenChange,
  cardId,
  cardTitle,
  lists,
  currentListId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  cardTitle: string;
  lists: { id: string; name: string }[];
  currentListId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await copyCardAction(idleState, formData);
      if (!result.ok) {
        toast.error(result.message ?? "Couldn't copy that card.");
        return;
      }
      toast.success(result.message ?? "Card copied.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nqm-skin-modal sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Copy card</DialogTitle>
          <DialogDescription>
            The copy keeps the description, labels and checklists. Comments and
            assignees are not carried over.
          </DialogDescription>
        </DialogHeader>

        {/* `key` on the form resets the prefilled title each time it opens. */}
        <form
          key={open ? "open" : "closed"}
          onSubmit={onSubmit}
          className="space-y-4"
        >
          <input type="hidden" name="cardId" value={cardId} />

          <div className="space-y-1.5">
            <label htmlFor="copy-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="copy-title"
              name="title"
              required
              maxLength={500}
              defaultValue={`Copy of ${cardTitle}`.slice(0, 500)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="copy-list" className="text-sm font-medium">
              List
            </label>
            <select
              id="copy-list"
              name="targetListId"
              required
              defaultValue={currentListId}
              className={SELECT_CLASS}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || lists.length === 0}>
              Create copy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveToBoardDialog({
  open,
  onOpenChange,
  cardId,
  currentBoardId,
  boards,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: string;
  currentBoardId: string;
  boards: WorkspaceBoardOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [boardId, setBoardId] = useState(
    () => boards.find((b) => b.id !== currentBoardId)?.id ?? currentBoardId,
  );

  const selectedBoard = boards.find((b) => b.id === boardId);
  const lists = selectedBoard?.lists ?? [];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const targetListId = String(formData.get("targetListId") ?? "");
    startTransition(async () => {
      const result = await moveCardToBoardAction(idleState, formData);
      if (!result.ok) {
        toast.error(result.message ?? "Couldn't move that card.");
        return;
      }
      toast.success(result.message ?? "Card moved.");
      onOpenChange(false);
      // The card keeps its id; only its home changes, so follow it there.
      const destination = boards.find((b) =>
        b.lists.some((l) => l.id === targetListId),
      );
      router.replace(`/b/${destination?.id ?? boardId}/c/${cardId}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nqm-skin-modal sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Move to another board</DialogTitle>
          <DialogDescription>
            Only boards in this workspace are offered, and only ones you can
            write to.
          </DialogDescription>
        </DialogHeader>

        {boards.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            There is no other board in this workspace yet.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input type="hidden" name="cardId" value={cardId} />

            <div className="space-y-1.5">
              <label htmlFor="move-board" className="text-sm font-medium">
                Board
              </label>
              <select
                id="move-board"
                value={boardId}
                onChange={(event) => setBoardId(event.target.value)}
                className={SELECT_CLASS}
              >
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                    {board.id === currentBoardId ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="move-list" className="text-sm font-medium">
                List
              </label>
              <select
                id="move-list"
                name="targetListId"
                required
                // Remount when the board changes so the first list is picked.
                key={boardId}
                className={cn(SELECT_CLASS, lists.length === 0 && "opacity-60")}
                disabled={lists.length === 0}
              >
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
              {lists.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  That board has no lists yet.
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || lists.length === 0}>
                Move card
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
