"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import {
  decideAuthorizationAction,
  type AuthorizeDecisionState,
} from "@/actions/oauth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { idleState } from "@/lib/action-result";

/**
 * The OAuth consent screen.
 *
 * Every field of the authorization request is carried as a hidden input, and
 * the action re-derives the whole decision from them — the client row, the
 * redirect allowlist, the PKCE challenge, the scope ceiling. These inputs are
 * a *convenience for the browser*, not a trusted channel; nothing here is
 * believed on the server.
 *
 * Navigation happens on the client rather than through `redirect()` because a
 * registered redirect URI may use a private-use scheme (`cursor://…`), which
 * cannot be the target of an HTTP `Location` header.
 */
export type ConsentClient = {
  id: string;
  name: string;
  clientUri: string | null;
  logoUri: string | null;
};

function Submit({
  value,
  variant,
  children,
}: {
  value: "approve" | "deny";
  variant?: "default" | "outline";
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={value}
      variant={variant}
      disabled={pending}
    >
      {pending ? "Working…" : children}
    </Button>
  );
}

export function ConsentScreen({
  client,
  user,
  request,
  permissions,
}: {
  client: ConsentClient;
  user: { email: string; name: string };
  request: {
    redirectUri: string;
    scope: string;
    state: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    resource: string;
  };
  permissions: { scope: string; description: string }[];
}) {
  const [state, formAction] = useActionState<AuthorizeDecisionState, FormData>(
    decideAuthorizationAction,
    idleState as AuthorizeDecisionState,
  );

  useEffect(() => {
    if (state.ok && state.redirectTo) {
      // `assign`, not `replace`: leaving the consent screen in history means
      // Back returns here rather than skipping past it into the app.
      window.location.assign(state.redirectTo);
    }
  }, [state]);

  let host: string | null = null;
  if (client.clientUri) {
    try {
      host = new URL(client.clientUri).host;
    } catch {
      host = null;
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          {client.logoUri ? (
            // A plain <img>: the URL is chosen by a self-registered client, so
            // it can never be in next/image's allowlist. `no-referrer` keeps
            // the instance's hostname out of the logo host's logs.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={client.logoUri}
              alt=""
              width={40}
              height={40}
              referrerPolicy="no-referrer"
              className="size-10 shrink-0 rounded-lg border object-contain"
            />
          ) : (
            <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg border">
              <ShieldCheck className="text-muted-foreground size-5" />
            </span>
          )}
          <div className="min-w-0">
            <CardTitle className="truncate text-xl">{client.name}</CardTitle>
            <CardDescription>
              wants to connect to your Next Quest Manager account
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Signed in as <span className="text-foreground font-medium">{user.email}</span>.
          {host ? (
            <>
              {" "}
              The application identifies itself as{" "}
              <span className="text-foreground font-medium">{host}</span>.
            </>
          ) : null}
        </p>

        <div>
          <h2 className="text-sm font-medium">It will be able to:</h2>
          <ul className="mt-2.5 space-y-2.5">
            {permissions.map((permission) => (
              <li key={permission.scope} className="flex gap-2.5 text-sm">
                <Check className="text-primary mt-0.5 size-4 shrink-0" />
                <span className="text-muted-foreground leading-relaxed">
                  {permission.description}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-muted-foreground text-xs leading-relaxed">
          It acts as you: it sees exactly the workspaces you belong to and
          nothing else. You can disconnect it at any time from Settings →
          Connected apps. After approving you will be sent to{" "}
          <code className="font-mono break-all">{request.redirectUri}</code>.
        </p>

        {state.message && !state.ok ? (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        ) : null}
      </CardContent>

      <CardFooter>
        <form action={formAction} className="flex w-full justify-end gap-2">
          <input type="hidden" name="client_id" value={client.id} />
          <input type="hidden" name="redirect_uri" value={request.redirectUri} />
          <input type="hidden" name="scope" value={request.scope} />
          <input type="hidden" name="state" value={request.state} />
          <input
            type="hidden"
            name="code_challenge"
            value={request.codeChallenge}
          />
          <input
            type="hidden"
            name="code_challenge_method"
            value={request.codeChallengeMethod}
          />
          <input type="hidden" name="resource" value={request.resource} />

          <Submit value="deny" variant="outline">
            Cancel
          </Submit>
          <Submit value="approve">Approve</Submit>
        </form>
      </CardFooter>
    </Card>
  );
}
