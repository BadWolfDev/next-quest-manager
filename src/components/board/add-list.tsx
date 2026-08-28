"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { createListAction } from "@/actions/lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { idleState, type ActionState } from "@/lib/action-result";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Adding…" : "Add list"}
    </Button>
  );
}

/**
 * Inline list composer at the right-hand end of the board. Same interaction as
 * the card composer: Enter submits, Escape dismisses, the form stays open so
 * several lists can be added in a row.
 */
export function AddList({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await createListAction(previous, formData);
      if (result.ok) {
        formRef.current?.reset();
        inputRef.current?.focus();
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
        className="bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:ring-ring/60 flex w-72 shrink-0 items-center gap-1.5 rounded-xl border border-dashed px-3.5 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2"
      >
        <Plus className="size-4" />
        Add list
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="bg-muted/50 w-72 shrink-0 space-y-2 rounded-xl border p-2.5"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <Input
        ref={inputRef}
        name="name"
        required
        autoFocus
        maxLength={80}
        autoComplete="off"
        aria-label="Name for a new list"
        aria-invalid={Boolean(state.fields?.name)}
        placeholder="List name"
        className="bg-card text-sm"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      />

      {state.message && !state.ok ? (
        <p role="alert" className="text-destructive text-xs">
          {state.fields?.name ?? state.message}
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
