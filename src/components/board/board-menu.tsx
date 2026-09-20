"use client";

import { Archive, Boxes, MoreHorizontal, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { archiveBoardAction, renameBoardAction } from "@/actions/boards";
import { ArchivedItemsSheet } from "@/components/board/archived-items-sheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState, type ActionState } from "@/lib/action-result";

function Submit({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant?: "default" | "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Just a moment…" : children}
    </Button>
  );
}

/**
 * The board title's "…" menu.
 *
 * Both dialogs and the archive sheet are rendered as *siblings* of the
 * DropdownMenu: selecting a menu item closes the menu, which would unmount
 * anything nested inside it.
 */
export function BoardMenu({
  boardId,
  boardName,
  workspaceSlug,
  canWrite,
  canArchive,
}: {
  boardId: string;
  boardName: string;
  workspaceSlug: string;
  /** member+ — renaming is a write. */
  canWrite: boolean;
  /** admin+ — archiving a board takes it away from everyone. */
  canArchive: boolean;
}) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedItemsOpen, setArchivedItemsOpen] = useState(false);

  const [renameState, rename] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await renameBoardAction(previous, formData);
      if (result.ok) {
        setRenameOpen(false);
        toast.success("Board renamed.");
        router.refresh();
      } else {
        toast.error(result.fields?.name ?? result.message ?? "Rename failed.");
      }
      return result;
    },
    idleState,
  );

  const [, archive] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await archiveBoardAction(previous, formData);
      if (result.ok) {
        setArchiveOpen(false);
        toast.success(result.message ?? "Board archived.");
        // The board is gone from under us — go back to the workspace rather
        // than leaving a 404 on screen.
        router.push(`/w/${workspaceSlug}`);
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not archive that board.");
      }
      return result;
    },
    idleState,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Actions for ${boardName}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-52">
          {canWrite ? (
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(event) => {
                event.preventDefault();
                setRenameOpen(true);
              }}
            >
              <Pencil className="size-4" />
              Rename board
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={(event) => {
              event.preventDefault();
              setArchivedItemsOpen(true);
            }}
          >
            <Boxes className="size-4" />
            Archived items…
          </DropdownMenuItem>

          {canArchive ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="cursor-pointer"
                onSelect={(event) => {
                  event.preventDefault();
                  setArchiveOpen(true);
                }}
              >
                <Archive className="size-4" />
                Archive board
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
            <DialogDescription>
              The new name shows up everywhere this board is listed.
            </DialogDescription>
          </DialogHeader>

          <form action={rename} className="space-y-4">
            <input type="hidden" name="boardId" value={boardId} />
            <div className="space-y-1.5">
              <Label htmlFor="board-name">Name</Label>
              <Input
                id="board-name"
                name="name"
                defaultValue={boardName}
                required
                maxLength={80}
                autoComplete="off"
                aria-invalid={Boolean(renameState.fields?.name)}
              />
              {renameState.fields?.name ? (
                <p className="text-destructive text-xs">
                  {renameState.fields.name}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Submit>Save</Submit>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive “{boardName}”?</DialogTitle>
            <DialogDescription>
              The board disappears from the workspace for everyone. Nothing is
              deleted — an admin can restore it from the workspace page.
            </DialogDescription>
          </DialogHeader>

          <form action={archive}>
            <input type="hidden" name="boardId" value={boardId} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setArchiveOpen(false)}
              >
                Cancel
              </Button>
              <Submit variant="destructive">Archive board</Submit>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ArchivedItemsSheet
        boardId={boardId}
        open={archivedItemsOpen}
        onOpenChange={setArchivedItemsOpen}
        canRestore={canWrite}
      />
    </>
  );
}
