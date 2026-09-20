"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { restoreBoardAction } from "@/actions/boards";
import { Button } from "@/components/ui/button";
import { idleState, type ActionState } from "@/lib/action-result";

export type ArchivedBoard = {
  id: string;
  name: string;
  archivedLabel: string;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 gap-1.5"
      disabled={pending}
      aria-label={label}
    >
      <RotateCcw className="size-3.5" />
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}

function RestoreBoardForm({ board }: { board: ArchivedBoard }) {
  const router = useRouter();
  const [, restore] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await restoreBoardAction(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Board restored.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not restore that board.");
      }
      return result;
    },
    idleState,
  );

  return (
    <form action={restore}>
      <input type="hidden" name="boardId" value={board.id} />
      <Submit label={`Restore ${board.name}`} />
    </form>
  );
}

/**
 * Archived boards for a workspace.
 *
 * Restoring is admin-only and the core op enforces that regardless — hiding the
 * button is a courtesy, not the control.
 */
export function ArchivedBoards({
  boards,
  canRestore,
}: {
  boards: ArchivedBoard[];
  canRestore: boolean;
}) {
  if (boards.length === 0) return null;

  return (
    <section className="mt-10" aria-label="Archived boards">
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Archived boards
      </h2>
      <ul className="mt-3 space-y-1.5">
        {boards.map((board) => (
          <li
            key={board.id}
            className="flex items-center gap-2 rounded-lg border px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{board.name}</span>
              {board.archivedLabel ? (
                <span className="text-muted-foreground block text-xs">
                  Archived {board.archivedLabel}
                </span>
              ) : null}
            </span>
            {canRestore ? <RestoreBoardForm board={board} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
