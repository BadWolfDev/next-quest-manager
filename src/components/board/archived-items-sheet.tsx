"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import {
  listArchivedItemsAction,
  restoreCardAction,
  restoreListAction,
  type ArchivedItems,
} from "@/actions/archive";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { idleState, type ActionState } from "@/lib/action-result";

const EMPTY: ArchivedItems = { lists: [], cards: [] };

function RestoreSubmit({ label }: { label: string }) {
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

/**
 * Archived lists and cards for one board.
 *
 * Loaded on open rather than with the board: the archive is rarely looked at
 * and there is no reason to pay for it on every board render.
 */
export function ArchivedItemsSheet({
  boardId,
  open,
  onOpenChange,
  canRestore,
}: {
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Viewers may look but not un-archive. */
  canRestore: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ArchivedItems>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    startLoading(async () => {
      const result = await listArchivedItemsAction(boardId);
      if (cancelled) return;
      if (result.ok) {
        setItems(result.items);
        setError(null);
      } else {
        setItems(EMPTY);
        setError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function afterRestore(
    previous: ActionState,
    formData: FormData,
    run: (prev: ActionState, data: FormData) => Promise<ActionState>,
  ) {
    const result = await run(previous, formData);
    if (result.ok) {
      toast.success(result.message ?? "Restored.");
      const refreshed = await listArchivedItemsAction(boardId);
      if (refreshed.ok) setItems(refreshed.items);
      router.refresh();
    } else {
      toast.error(result.message ?? "Could not restore that.");
    }
    return result;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Archived items</SheetTitle>
          <SheetDescription>
            Nothing is ever deleted — archived lists and cards keep their
            history and can be brought back.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <Tabs defaultValue="cards">
            <TabsList className="w-full">
              <TabsTrigger value="cards">
                Cards ({items.cards.length})
              </TabsTrigger>
              <TabsTrigger value="lists">
                Lists ({items.lists.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cards" className="pt-3">
              {loading && items.cards.length === 0 ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : items.cards.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No archived cards.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {items.cards.map((card) => (
                    <li
                      key={card.id}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {card.title}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {card.listName}
                          {card.archivedLabel
                            ? ` · archived ${card.archivedLabel}`
                            : ""}
                        </span>
                      </span>
                      {canRestore ? (
                        <RestoreForm
                          name="cardId"
                          value={card.id}
                          label={`Restore card ${card.title}`}
                          run={restoreCardAction}
                          onRun={afterRestore}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="lists" className="pt-3">
              {loading && items.lists.length === 0 ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : items.lists.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No archived lists.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {items.lists.map((list) => (
                    <li
                      key={list.id}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {list.name}
                        </span>
                        {list.archivedLabel ? (
                          <span className="text-muted-foreground block text-xs">
                            Archived {list.archivedLabel}
                          </span>
                        ) : null}
                      </span>
                      {canRestore ? (
                        <RestoreForm
                          name="listId"
                          value={list.id}
                          label={`Restore list ${list.name}`}
                          run={restoreListAction}
                          onRun={afterRestore}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RestoreForm({
  name,
  value,
  label,
  run,
  onRun,
}: {
  name: "cardId" | "listId";
  value: string;
  label: string;
  run: (prev: ActionState, data: FormData) => Promise<ActionState>;
  onRun: (
    prev: ActionState,
    data: FormData,
    run: (p: ActionState, d: FormData) => Promise<ActionState>,
  ) => Promise<ActionState>;
}) {
  const [, action] = useActionState<ActionState, FormData>(
    (previous, formData) => onRun(previous, formData, run),
    idleState,
  );

  return (
    <form action={action}>
      <input type="hidden" name={name} value={value} />
      <RestoreSubmit label={label} />
    </form>
  );
}
