"use client";

import { Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { createBoardAction } from "@/actions/boards";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState, type ActionState } from "@/lib/action-result";
import { BOARD_BACKGROUNDS } from "@/lib/palette";
import { cn } from "@/lib/utils";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create board"}
    </Button>
  );
}

export function CreateBoardDialog({
  workspaceId,
  variant = "default",
}: {
  workspaceId: string;
  variant?: "default" | "tile";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [background, setBackground] = useState<string>(
    BOARD_BACKGROUNDS[0].value,
  );
  // Success handling lives inside the action rather than an effect: the dialog
  // closes and the route refreshes in the same transition as the result.
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await createBoardAction(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Board created.");
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    idleState,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "tile" ? (
          <button
            type="button"
            className="hover:border-primary/60 hover:bg-accent/40 focus-visible:ring-ring/60 text-muted-foreground hover:text-foreground flex aspect-[16/10] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm transition-colors focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-5" />
            New board
          </button>
        ) : (
          <Button>
            <Plus className="size-4" />
            New board
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form action={formAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="background" value={background} />

          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>
              Starts with Backlog / In Progress / Done, ready to rename.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="board-name">Name</Label>
              <Input
                id="board-name"
                name="name"
                required
                maxLength={80}
                autoComplete="off"
                placeholder="Q1 Roadmap"
                aria-invalid={Boolean(state.fields?.name)}
              />
              {state.message && !state.ok ? (
                <p role="alert" className="text-destructive text-xs">
                  {state.fields?.name ?? state.message}
                </p>
              ) : null}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Background</legend>
              <div className="flex flex-wrap gap-2">
                {BOARD_BACKGROUNDS.map((option) => {
                  const selected = background === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={selected}
                      onClick={() => setBackground(option.value)}
                      style={{ background: option.value }}
                      className={cn(
                        "focus-visible:ring-ring/70 grid size-8 place-items-center rounded-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                        selected ? "scale-110" : "hover:scale-105",
                      )}
                    >
                      {selected ? (
                        <Check className="size-4 text-white drop-shadow" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
