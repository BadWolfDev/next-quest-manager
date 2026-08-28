"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { acceptInviteAction } from "@/actions/invites";
import { Button } from "@/components/ui/button";
import { idleState, type ActionState } from "@/lib/action-result";

function Submit({ workspaceName }: { workspaceName: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Joining…" : `Join ${workspaceName}`}
    </Button>
  );
}

export function AcceptInviteForm({
  token,
  workspaceName,
}: {
  token: string;
  workspaceName: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    acceptInviteAction,
    idleState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.message && !state.ok ? (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {state.message}
        </p>
      ) : null}
      <Submit workspaceName={workspaceName} />
    </form>
  );
}
