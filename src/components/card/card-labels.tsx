"use client";

import { Check, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useState } from "react";

import { createLabelAction, setCardLabelAction } from "@/actions/card-detail";
import { deleteLabelAction, updateLabelAction } from "@/actions/labels";
import { useBoundAction, useQuickAction } from "@/components/card/card-hooks";
import type { CardDetailLabel } from "@/components/card/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Theme-aware palette offered when creating or recolouring a label.
 *
 * Deliberately not `BOARD_BACKGROUNDS` from `lib/palette.ts`: those are large
 * surfaces behind white text, these are small chips that must stay legible as
 * both fill and border.
 */
export const LABEL_COLORS = [
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

function ColorSwatches({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: string;
}) {
  const fallback = defaultValue ?? LABEL_COLORS[0];
  const known = (LABEL_COLORS as readonly string[]).includes(fallback);
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {LABEL_COLORS.map((color, index) => (
        <label key={color} className="cursor-pointer">
          <span className="sr-only">Colour {color}</span>
          <input
            type="radio"
            name={name}
            value={color}
            defaultChecked={known ? color === fallback : index === 0}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="peer-checked:ring-ring peer-focus-visible:ring-ring/60 block size-5 ring-offset-2 peer-checked:ring-2 peer-focus-visible:ring-2"
            style={{ background: color }}
          />
        </label>
      ))}
    </div>
  );
}

/** One row of the picker: toggle on the card, or open the edit form. */
function LabelRow({
  label,
  attached,
  cardId,
  boardId,
}: {
  label: CardDetailLabel;
  attached: boolean;
  cardId: string;
  boardId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, quick] = useQuickAction();
  const [, renameAction] = useBoundAction(updateLabelAction, () =>
    setEditing(false),
  );

  if (editing) {
    return (
      <li className="border-t py-2 first:border-t-0">
        <form action={renameAction}>
          <input type="hidden" name="labelId" value={label.id} />
          <label htmlFor={`label-name-${label.id}`} className="sr-only">
            Label name
          </label>
          <Input
            id={`label-name-${label.id}`}
            name="name"
            defaultValue={label.name}
            required
            maxLength={40}
            autoFocus
            autoComplete="off"
            className="h-8 text-sm"
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <ColorSwatches name="color" defaultValue={label.color} />

          <div className="mt-2 flex items-center gap-1.5">
            <Button type="submit" size="sm" className="h-7 text-xs">
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>

            {confirming ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="ml-auto h-7 text-xs"
                disabled={pending}
                onClick={() =>
                  quick(
                    deleteLabelAction,
                    { labelId: label.id },
                    { successMessage: true, onDone: () => setEditing(false) },
                  )
                }
              >
                Really delete?
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive ml-auto h-7 text-xs"
                aria-label={`Delete label ${label.name || "Label"}`}
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        aria-pressed={attached}
        onClick={() =>
          quick(setCardLabelAction, {
            cardId,
            boardId,
            labelId: label.id,
            attached: attached ? "false" : "true",
          })
        }
        className="hover:bg-accent flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left text-sm"
      >
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0"
          style={{ background: label.color }}
        />
        <span className="min-w-0 flex-1 truncate">
          {label.name || "Label"}
        </span>
        <Check
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            attached ? "opacity-100" : "opacity-0",
          )}
        />
      </button>
      <button
        type="button"
        aria-label={`Edit label ${label.name || "Label"}`}
        onClick={() => setEditing(true)}
        className="text-muted-foreground hover:text-foreground shrink-0 p-1.5"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

export function CardLabels({
  cardId,
  boardId,
  boardLabels,
  attachedLabelIds,
  canWrite,
}: {
  cardId: string;
  boardId: string;
  boardLabels: CardDetailLabel[];
  attachedLabelIds: string[];
  canWrite: boolean;
}) {
  const attached = new Set(attachedLabelIds);
  const [createKey, setCreateKey] = useState(0);
  const [, createAction] = useBoundAction(createLabelAction, () =>
    setCreateKey((n) => n + 1),
  );

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      {boardLabels
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
              <Tag className="size-3.5" aria-hidden="true" />
              Labels
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <p className="text-muted-foreground mb-1.5 px-1 text-xs font-medium">
              Board labels
            </p>
            <ul className="max-h-56 overflow-y-auto">
              {boardLabels.length === 0 ? (
                <li className="text-muted-foreground px-1 py-2 text-sm">
                  No labels yet.
                </li>
              ) : (
                boardLabels.map((label) => (
                  <LabelRow
                    key={label.id}
                    label={label}
                    attached={attached.has(label.id)}
                    cardId={cardId}
                    boardId={boardId}
                  />
                ))
              )}
            </ul>

            <form
              key={createKey}
              action={createAction}
              className="mt-2 border-t pt-2"
            >
              <input type="hidden" name="boardId" value={boardId} />
              <label
                htmlFor="new-label-name"
                className="text-muted-foreground mb-1.5 block px-1 text-xs font-medium"
              >
                New label
              </label>
              <Input
                id="new-label-name"
                name="name"
                required
                maxLength={40}
                placeholder="Label name"
                autoComplete="off"
                className="h-8 text-sm"
              />
              <ColorSwatches name="color" />
              <Button type="submit" size="sm" className="mt-2 w-full">
                <Plus className="size-3.5" aria-hidden="true" />
                Create label
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
