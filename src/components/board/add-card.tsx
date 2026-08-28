"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { createCardAction } from "@/actions/cards";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { idleState, type ActionState } from "@/lib/action-result";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Adding…" : "Add card"}
    </Button>
  );
}

/**
 * Inline card composer at the foot of a list.
 *
 * Enter submits, Shift+Enter makes a newline, Escape dismisses. The form stays
 * open after a successful add so several cards can be typed in a row — the
 * server action revalidates the board, so the new card arrives on the next
 * render pass. Optimistic insertion is phase 2, together with drag & drop.
 */
export function AddCard({ listId, listName }: { listId: string; listName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await createCardAction(previous, formData);
      if (result.ok) {
        formRef.current?.reset();
        textareaRef.current?.focus();
        router.refresh();
      }
      return result;
    },
    idleState,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:ring-ring/60 mt-2 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2"
      >
        <Plus className="size-4" />
        Add card
      </button>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="listId" value={listId} />
      <Textarea
        ref={textareaRef}
        name="title"
        required
        autoFocus
        rows={2}
        maxLength={500}
        aria-label={`Title for a new card in ${listName}`}
        aria-invalid={Boolean(state.fields?.title)}
        placeholder="What needs doing?"
        className="bg-card resize-none text-sm"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />

      {state.message && !state.ok ? (
        <p role="alert" className="text-destructive text-xs">
          {state.fields?.title ?? state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <SubmitButton />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
