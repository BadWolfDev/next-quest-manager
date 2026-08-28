"use client";

import {
  Check,
  MoreHorizontal,
  Plus,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";

import {
  addChecklistItemAction,
  archiveCardAction,
  createChecklistAction,
  createLabelAction,
  deleteChecklistItemAction,
  moveCardToListAction,
  setCardLabelAction,
  toggleChecklistItemAction,
  updateCardDetailAction,
} from "@/actions/card-detail";
import {
  AssigneeChips,
  AssigneePopover,
  type AssignableMember,
} from "@/components/board/assignee-popover";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { idleState, type ActionState } from "@/lib/action-result";
import { cn } from "@/lib/utils";

/** Theme-aware palette offered when creating a label. */
const LABEL_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#0ea5e9",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
  "#ffcd75",
  "#7df9ff",
  "#ff2e93",
] as const;

export type CardDetailData = {
  card: {
    id: string;
    title: string;
    description: string | null;
    listId: string;
    listName: string;
    updatedLabel: string;
    ref: string;
  };
  board: { id: string; name: string };
  assignees: { userId: string; name: string; image: string | null }[];
  members: AssignableMember[];
  boardLabels: { id: string; name: string; color: string }[];
  attachedLabelIds: string[];
  lists: { id: string; name: string }[];
  checklists: {
    id: string;
    title: string;
    items: { id: string; content: string; completed: boolean }[];
  }[];
  canWrite: boolean;
};

function useBoundAction(
  action: (p: ActionState, f: FormData) => Promise<ActionState>,
  onDone?: () => void,
) {
  const router = useRouter();
  return useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.ok) {
      onDone?.();
      router.refresh();
      if (result.message) toast.success(result.message);
    } else {
      toast.error(result.message ?? "That didn't work.");
    }
    return result;
  }, idleState);
}

export function CardDetail({
  data,
  onClose,
}: {
  data: CardDetailData;
  onClose: () => void;
}) {
  const router = useRouter();
  const { card, board, canWrite } = data;

  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [pending, startTransition] = useTransition();

  const [, titleAction] = useBoundAction(updateCardDetailAction, () =>
    setEditingTitle(false),
  );
  const [, descAction] = useBoundAction(updateCardDetailAction, () =>
    setEditingDesc(false),
  );
  const [, checklistAction] = useBoundAction(createChecklistAction);
  const [, itemAction] = useBoundAction(addChecklistItemAction);
  const [, labelCreateAction] = useBoundAction(createLabelAction);
  const [, moveAction] = useBoundAction(moveCardToListAction);
  const [, archiveAction] = useBoundAction(archiveCardAction, onClose);

  const attached = new Set(data.attachedLabelIds);
  const allItems = data.checklists.flatMap((c) => c.items);
  const doneCount = allItems.filter((i) => i.completed).length;
  const progress = allItems.length
    ? Math.round((doneCount / allItems.length) * 100)
    : 0;

  /** Fire-and-refresh helper for the small toggle/delete/label buttons. */
  function quick(
    action: (p: ActionState, f: FormData) => Promise<ActionState>,
    fields: Record<string, string>,
  ) {
    startTransition(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const result = await action({ ok: false }, fd);
      if (!result.ok) toast.error(result.message ?? "That didn't work.");
      else router.refresh();
    });
  }

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
                <Button variant="ghost" size="icon" className="size-[26px]" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <form action={archiveAction}>
                  <input type="hidden" name="cardId" value={card.id} />
                  <input type="hidden" name="boardId" value={board.id} />
                  <DropdownMenuItem asChild variant="destructive">
                    <button type="submit" className="w-full cursor-pointer">
                      <Trash2 className="size-4" />
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
            <X className="size-4" />
          </Button>
        </div>
      </div>

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
            <Button type="submit" size="sm">Save</Button>
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

        {/* Labels */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {data.boardLabels
            .filter((l) => attached.has(l.id))
            .map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
                style={{
                  background: `color-mix(in oklab, ${l.color} 22%, transparent)`,
                  color: l.color,
                  border: `1px solid ${l.color}`,
                }}
              >
                {l.name || "Label"}
              </span>
            ))}

          {canWrite ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  <Tag className="size-3.5" />
                  Labels
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-2">
                <p className="text-muted-foreground mb-1.5 px-1 text-xs font-medium">
                  Board labels
                </p>
                <ul className="max-h-48 overflow-y-auto">
                  {data.boardLabels.length === 0 ? (
                    <li className="text-muted-foreground px-1 py-2 text-sm">
                      No labels yet.
                    </li>
                  ) : (
                    data.boardLabels.map((l) => {
                      const on = attached.has(l.id);
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              quick(setCardLabelAction, {
                                cardId: card.id,
                                boardId: board.id,
                                labelId: l.id,
                                attached: on ? "false" : "true",
                              })
                            }
                            className="hover:bg-accent flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-sm"
                          >
                            <span
                              aria-hidden="true"
                              className="size-3.5 shrink-0"
                              style={{ background: l.color }}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {l.name || "Label"}
                            </span>
                            <Check
                              className={cn(
                                "size-4 shrink-0",
                                on ? "opacity-100" : "opacity-0",
                              )}
                            />
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>

                <form action={labelCreateAction} className="mt-2 border-t pt-2">
                  <input type="hidden" name="boardId" value={board.id} />
                  <p className="text-muted-foreground mb-1.5 px-1 text-xs font-medium">
                    New label
                  </p>
                  <Input
                    name="name"
                    required
                    maxLength={40}
                    placeholder="Label name"
                    autoComplete="off"
                    className="h-8 text-sm"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {LABEL_COLORS.map((c, i) => (
                      <label key={c} className="cursor-pointer">
                        <input
                          type="radio"
                          name="color"
                          value={c}
                          defaultChecked={i === 0}
                          className="peer sr-only"
                        />
                        <span
                          className="peer-checked:ring-ring block size-5 ring-offset-2 peer-checked:ring-2"
                          style={{ background: c }}
                        />
                      </label>
                    ))}
                  </div>
                  <Button type="submit" size="sm" className="mt-2 w-full">
                    <Plus className="size-3.5" />
                    Create label
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>

        {/* Split: description | right rail --------------------------------- */}
        <div className="mt-6 flex flex-col gap-6 sm:flex-row">
          <div className="min-w-0 flex-1">
            <h2 className="nqm-skin-kicker text-muted-foreground mb-2 text-xs uppercase tracking-wide">
              Description
            </h2>

            {editingDesc && canWrite ? (
              <form action={descAction} className="space-y-2">
                <input type="hidden" name="cardId" value={card.id} />
                <input type="hidden" name="boardId" value={board.id} />
                <Textarea
                  name="description"
                  defaultValue={card.description ?? ""}
                  autoFocus
                  rows={8}
                  maxLength={20_000}
                  aria-label="Card description"
                  className="text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingDesc(false);
                  }}
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm">Save</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingDesc(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => setEditingDesc(true)}
                className={cn(
                  "block w-full text-left text-sm leading-relaxed",
                  canWrite && "hover:bg-accent/40 -mx-2 rounded px-2 py-1",
                )}
              >
                {card.description ? (
                  /*
                    react-markdown renders to React elements and does NOT
                    interpret raw HTML unless `rehype-raw` is added — which it
                    is not. User content therefore never reaches the DOM as
                    markup.
                  */
                  <div className="nqm-prose space-y-2">
                    <Markdown>{card.description}</Markdown>
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    {canWrite
                      ? "Add a more detailed description…"
                      : "No description."}
                  </span>
                )}
              </button>
            )}
          </div>

          <aside className="w-full shrink-0 sm:w-[190px]">
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

            {allItems.length > 0 ? (
              <>
                <h2 className="nqm-skin-kicker text-muted-foreground mb-2 mt-5 text-xs uppercase tracking-wide">
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
              </>
            ) : null}
          </aside>
        </div>

        {/* Checklists ------------------------------------------------------ */}
        <section className="mt-7">
          <h2 className="nqm-skin-kicker text-muted-foreground mb-3 text-xs uppercase tracking-wide">
            Checklist
          </h2>

          {data.checklists.length === 0 ? (
            canWrite ? (
              <form action={checklistAction} className="flex gap-2">
                <input type="hidden" name="cardId" value={card.id} />
                <input type="hidden" name="boardId" value={board.id} />
                <Input
                  name="title"
                  required
                  maxLength={80}
                  placeholder="Checklist name"
                  autoComplete="off"
                  className="h-8 max-w-xs text-sm"
                />
                <Button type="submit" size="sm">
                  <Plus className="size-3.5" />
                  Add checklist
                </Button>
              </form>
            ) : (
              <p className="text-muted-foreground text-sm">No checklist.</p>
            )
          ) : (
            data.checklists.map((cl) => (
              <div key={cl.id} className="mb-5">
                <p className="mb-2 text-sm font-medium">{cl.title}</p>
                <ul className="space-y-3.5">
                  {cl.items.map((item) => (
                    <li key={item.id} className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        disabled={!canWrite || pending}
                        aria-label={item.content}
                        onChange={() =>
                          quick(toggleChecklistItemAction, {
                            itemId: item.id,
                            boardId: board.id,
                            completed: item.completed ? "false" : "true",
                          })
                        }
                        className="accent-primary mt-0.5 size-4 shrink-0"
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm",
                          item.completed &&
                            "text-muted-foreground line-through opacity-60",
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
                            quick(deleteChecklistItemAction, {
                              itemId: item.id,
                              boardId: board.id,
                            })
                          }
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>

                {canWrite ? (
                  <form action={itemAction} className="mt-3 flex gap-2">
                    <input type="hidden" name="checklistId" value={cl.id} />
                    <input type="hidden" name="boardId" value={board.id} />
                    <Input
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
            ))
          )}
        </section>
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
