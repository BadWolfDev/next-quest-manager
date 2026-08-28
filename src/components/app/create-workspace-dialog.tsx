"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { createWorkspaceAction } from "@/actions/workspaces";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idleState, type ActionState } from "@/lib/action-result";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create workspace"}
    </Button>
  );
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  // Success handling lives inside the action rather than an effect: the dialog
  // closes and the route refreshes in the same transition as the result.
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await createWorkspaceAction(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Workspace created.");
        onOpenChange(false);
        router.refresh();
      }
      return result;
    },
    idleState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              Workspaces hold boards and the people who can see them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-5">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              name="name"
              required
              maxLength={60}
              autoComplete="off"
              placeholder="Product team"
              aria-invalid={Boolean(state.fields?.name)}
            />
            {state.message && !state.ok ? (
              <p role="alert" className="text-destructive text-xs">
                {state.fields?.name ?? state.message}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Submit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
