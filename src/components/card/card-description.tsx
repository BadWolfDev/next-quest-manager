"use client";

import { useState } from "react";

import { updateCardDetailAction } from "@/actions/card-detail";
import { CardMarkdown, useBoundAction } from "@/components/card/card-hooks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The description editor.
 *
 * Deliberately a plain textarea with a Write/Preview toggle rather than a rich
 * text widget: the stored value is markdown *source*, and the preview uses the
 * very same renderer the read view uses, so what you see is what will be
 * stored and shown.
 */
export function CardDescription({
  cardId,
  boardId,
  description,
  canWrite,
}: {
  cardId: string;
  boardId: string;
  description: string | null;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState(description ?? "");
  const [, saveAction] = useBoundAction(updateCardDetailAction, () => {
    setEditing(false);
    setPreview(false);
  });

  function open() {
    setDraft(description ?? "");
    setPreview(false);
    setEditing(true);
  }

  if (editing && canWrite) {
    return (
      <form action={saveAction} className="space-y-2">
        <input type="hidden" name="cardId" value={cardId} />
        <input type="hidden" name="boardId" value={boardId} />

        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label="Description editor mode"
        >
          <Button
            type="button"
            role="tab"
            aria-selected={!preview}
            size="sm"
            variant={preview ? "ghost" : "secondary"}
            className="h-7 text-xs"
            onClick={() => setPreview(false)}
          >
            Write
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={preview}
            size="sm"
            variant={preview ? "secondary" : "ghost"}
            className="h-7 text-xs"
            onClick={() => setPreview(true)}
          >
            Preview
          </Button>
          <span className="text-muted-foreground ml-1 text-xs">
            Markdown supported
          </span>
        </div>

        {/*
          The textarea stays mounted while previewing — unmounting it would
          drop its value from the form, and re-mounting would lose the caret.
        */}
        <div className={preview ? "hidden" : undefined}>
          <Textarea
            name="description"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            rows={8}
            maxLength={20_000}
            aria-label="Card description"
            className="text-sm"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setEditing(false);
                setPreview(false);
              }
            }}
          />
        </div>

        {preview ? (
          <div className="min-h-[8rem] rounded border p-3 text-sm leading-relaxed">
            {draft.trim() ? (
              <CardMarkdown>{draft}</CardMarkdown>
            ) : (
              <span className="text-muted-foreground">Nothing to preview.</span>
            )}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setPreview(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <button
      type="button"
      disabled={!canWrite}
      onClick={open}
      className={cn(
        "block w-full text-left text-sm leading-relaxed",
        canWrite && "hover:bg-accent/40 -mx-2 rounded px-2 py-1",
      )}
    >
      {description ? (
        <CardMarkdown>{description}</CardMarkdown>
      ) : (
        <span className="text-muted-foreground">
          {canWrite ? "Add a more detailed description…" : "No description."}
        </span>
      )}
    </button>
  );
}
