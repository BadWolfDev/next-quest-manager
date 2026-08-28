"use client";

import { Archive, GripVertical, MoreHorizontal, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { toast } from "sonner";

import { archiveListAction, renameListAction } from "@/actions/lists";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { idleState, type ActionState } from "@/lib/action-result";

type DragHandleProps = Record<string, unknown>;

export function ListHeader({
  listId,
  name,
  cardCount,
  canWrite = true,
  dragHandleProps,
}: {
  listId: string;
  name: string;
  cardCount: number;
  /** Viewers see the header but none of its controls. */
  canWrite?: boolean;
  dragHandleProps?: DragHandleProps;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [renameState, renameAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await renameListAction(previous, formData);
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.fields?.name ?? result.message ?? "Rename failed.");
      }
      return result;
    },
    idleState,
  );

  const [, archiveAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await archiveListAction(previous, formData);
      if (result.ok) {
        toast.success(`Archived “${name}”.`);
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not archive that list.");
      }
      return result;
    },
    idleState,
  );

  if (editing && canWrite) {
    return (
      <form ref={formRef} action={renameAction} className="px-1 pb-2">
        <input type="hidden" name="listId" value={listId} />
        <Input
          name="name"
          defaultValue={name}
          autoFocus
          required
          maxLength={80}
          autoComplete="off"
          aria-label="List name"
          aria-invalid={Boolean(renameState.fields?.name)}
          className="bg-card h-8 text-sm font-semibold"
          onBlur={(event) => event.currentTarget.form?.requestSubmit()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
        />
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1 px-1 pb-2">
      {canWrite ? (
      <button
        type="button"
        aria-label={`Reorder ${name}`}
        title="Drag to reorder list"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 -ml-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 active:cursor-grabbing"
        {...dragHandleProps}
      >
        <GripVertical className="size-4" />
      </button>
      ) : null}

      <button
        type="button"
        disabled={!canWrite}
        onClick={() => setEditing(true)}
        className="nqm-skin-list-title hover:bg-accent/60 focus-visible:ring-ring/60 min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2"
        title="Click to rename"
      >
        {name}
      </button>

      <span
        className="text-muted-foreground shrink-0 text-xs tabular-nums"
        aria-label={`${cardCount} ${cardCount === 1 ? "card" : "cards"}`}
      >
        {cardCount}
      </span>

      {canWrite ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={`Actions for ${name}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setEditing(true);
            }}
            className="cursor-pointer"
          >
            <Pencil className="size-4" />
            Rename list
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <form action={archiveAction}>
            <input type="hidden" name="listId" value={listId} />
            <DropdownMenuItem asChild variant="destructive">
              <button type="submit" className="w-full cursor-pointer">
                <Archive className="size-4" />
                Archive list
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
      ) : null}
    </div>
  );
}
