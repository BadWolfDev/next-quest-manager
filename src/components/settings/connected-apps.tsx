"use client";

import { Plug, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { toast } from "sonner";

import {
  revokeClientGrantAction,
  type ConnectedAppRow,
} from "@/actions/oauth";
import { Button } from "@/components/ui/button";
import { idleState, type ActionState } from "@/lib/action-result";

const SCOPE_LABELS: Record<string, string> = {
  "nqm:read": "read",
  "nqm:write": "write",
};

/** Apps connected over OAuth, and the one control that matters: disconnect. */
export function ConnectedApps({ apps }: { apps: ConnectedAppRow[] }) {
  const router = useRouter();

  const [, revokeFormAction] = useActionState<ActionState, FormData>(
    async (previous, formData) => {
      const result = await revokeClientGrantAction(previous, formData);
      if (result.ok) {
        toast.success(result.message ?? "Disconnected.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not disconnect that app.");
      }
      return result;
    },
    idleState,
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connected apps
        </h1>
        <p className="text-muted-foreground mt-1.5 max-w-prose text-sm leading-relaxed">
          Applications you have approved over OAuth. Each one acts as you and
          sees exactly the workspaces you belong to. Disconnecting revokes every
          token it holds immediately.
        </p>
      </div>

      <section className="mt-8" aria-label="Connected applications">
        {apps.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-12 text-center">
            <Plug className="text-muted-foreground mx-auto size-6" />
            <h2 className="mt-3 text-base font-medium">Nothing connected yet</h2>
            <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm">
              Add this instance as a connector in Claude.ai, Claude Code or
              Cursor and approve it — it will appear here. For headless use,
              mint an{" "}
              <Link href="/settings/tokens" className="underline">
                access token
              </Link>{" "}
              instead.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-xl border">
            {apps.map((app) => (
              <li
                key={app.clientId}
                className="flex flex-wrap items-center gap-3 px-4 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {app.name}
                    </span>
                    {app.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[0.7rem] font-medium"
                      >
                        {SCOPE_LABELS[scope] ?? scope}
                      </span>
                    ))}
                    {!app.active ? (
                      <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[0.7rem] font-medium">
                        no active token
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {app.clientUri ? `${app.clientUri} · ` : ""}
                    {`authorised ${app.authorisedLabel} · last used ${app.lastUsedLabel}`}
                  </p>
                </div>

                <form action={revokeFormAction}>
                  <input type="hidden" name="clientId" value={app.clientId} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Disconnect
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
