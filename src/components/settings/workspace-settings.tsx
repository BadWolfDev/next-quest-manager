"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import {
  deleteWorkspaceAction,
  renameWorkspaceAction,
} from "@/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { idleState, type ActionState } from "@/lib/action-result";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : children}
    </Button>
  );
}

export function WorkspaceSettings({
  workspaceId,
  workspaceName,
  myRole,
}: {
  workspaceId: string;
  workspaceName: string;
  myRole: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const canRename = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const [renameState, renameFormAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await renameWorkspaceAction(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Workspace renamed.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Rename failed.");
      }
      return result;
    },
    idleState,
  );

  const [deleteState, deleteFormAction] = useActionState<ActionState, FormData>(
    deleteWorkspaceAction,
    idleState,
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Workspace settings
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Name and lifecycle for {workspaceName}.
        </p>
      </div>

      <section className="rounded-xl border p-5">
        <h2 className="text-base font-semibold">Name</h2>
        <form action={renameFormAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Input
            name="name"
            defaultValue={workspaceName}
            required
            maxLength={60}
            disabled={!canRename}
            aria-label="Workspace name"
            aria-invalid={Boolean(renameState.fields?.name)}
            className="max-w-sm flex-1"
          />
          {canRename ? <Submit>Save</Submit> : null}
        </form>
        {!canRename ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Only owners and admins can rename this workspace.
          </p>
        ) : null}
      </section>

      {isOwner ? (
        <section className="border-destructive/30 rounded-xl border p-5">
          <h2 className="text-destructive text-base font-semibold">
            Delete this workspace
          </h2>
          <p className="text-muted-foreground mt-1.5 max-w-prose text-sm leading-relaxed">
            Every board, list, card, comment and invite in it is deleted
            permanently. This cannot be undone. Type{" "}
            <strong className="text-foreground">{workspaceName}</strong> to
            confirm.
          </p>
          <form action={deleteFormAction} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <Input
              name="confirmName"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={workspaceName}
              aria-label="Type the workspace name to confirm"
              autoComplete="off"
              className="max-w-sm flex-1"
            />
            <Button
              type="submit"
              variant="destructive"
              disabled={confirmName.trim() !== workspaceName}
            >
              Delete workspace
            </Button>
          </form>
          {deleteState.message && !deleteState.ok ? (
            <p role="alert" className="text-destructive mt-2 text-xs">
              {deleteState.message}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
