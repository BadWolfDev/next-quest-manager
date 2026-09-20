import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ConsentScreen } from "@/components/oauth/consent-screen";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionUser } from "@/lib/authorize";
import { getClient } from "@/lib/core/oauth";
import {
  SCOPE_DESCRIPTIONS,
  errorRedirect,
  isHttpRedirect,
  publicOriginFromHeaders,
  validateAuthorizationRequest,
  type Scope,
} from "@/lib/oauth";

/**
 * The OAuth authorization endpoint (RFC 6749 §3.1).
 *
 * A page rather than a route handler, because the whole point is that a human
 * looks at it. It is inside the protected area of the app on purpose: a
 * signed-out visitor is bounced to `/login?next=…` by `proxy.ts` and lands back
 * here with the request intact.
 *
 * Two classes of error are handled differently, and the distinction is from the
 * spec rather than taste (§4.1.2.1):
 *
 *  - an unknown `client_id` or an unregistered `redirect_uri` are **rendered**,
 *    never redirected. Redirecting would make this endpoint a forwarder to any
 *    URL an attacker can put in a query string.
 *  - everything else goes back to the (verified) redirect URI as an `error`
 *    parameter, which is what the client is waiting for.
 *
 * Nothing is minted here. The page only *describes* the request; the code is
 * issued by the server action, which re-validates all of it.
 */
export const metadata: Metadata = { title: "Authorize application" };

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function ErrorCard({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Nothing has been shared. Close this window and start the connection
          again from the application that sent you here.
        </p>
      </CardContent>
    </Card>
  );
}

export default async function AuthorizePage({
  searchParams,
}: PageProps<"/oauth/authorize">) {
  const params = await searchParams;

  const clientId = first(params.client_id);
  const redirectUriParam = first(params.redirect_uri);
  const responseType = first(params.response_type);
  const codeChallenge = first(params.code_challenge);
  const codeChallengeMethod = first(params.code_challenge_method);
  const state = first(params.state);
  const scopeParam = first(params.scope);
  const resource = first(params.resource);

  /* ---- Errors that must never be redirected (§4.1.2.1) ------------------ */

  const client = await getClient(clientId);
  if (!client) {
    return (
      <ErrorCard
        title="Unknown application"
        detail="No application is registered with that client_id on this instance."
      />
    );
  }

  /* ---- Everything else, validated once, shared with the action ---------- */

  const validated = validateAuthorizationRequest(
    client,
    {
      responseType,
      redirectUri: redirectUriParam,
      scope: scopeParam,
      codeChallenge,
      codeChallengeMethod,
      resource,
    },
    publicOriginFromHeaders(await headers()),
  );

  if (!validated.ok) {
    if (!validated.redirectable || !validated.redirectUri) {
      return (
        <ErrorCard
          title="Unregistered redirect address"
          detail={`${client.name} asked to be sent back to an address it has not registered. This is exactly the check that stops an authorization code being delivered somewhere it should not go.`}
        />
      );
    }

    const target = errorRedirect(
      validated.redirectUri,
      validated.error,
      state,
      validated.description,
    );
    if (isHttpRedirect(target)) redirect(target);
    // A private-use scheme cannot be an HTTP Location target, so the only
    // honest thing left is to say what went wrong.
    return (
      <ErrorCard
        title="This request cannot be approved"
        detail={validated.description}
      />
    );
  }

  /* ---- The human decides ------------------------------------------------ */

  // Belt and braces: `proxy.ts` already bounces signed-out visitors to
  // /login?next=… with this request intact, but a page that mints access must
  // not depend on a redirect layer for its authentication.
  const user = await getSessionUser();
  if (!user) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = first(value);
      if (single !== null) query.set(key, single);
    }
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }

  return (
    <ConsentScreen
      client={{
        id: client.id,
        name: client.name,
        clientUri: client.clientUri,
        logoUri: client.logoUri,
      }}
      user={{ email: user.email, name: user.name }}
      request={{
        redirectUri: validated.redirectUri,
        scope: validated.scope,
        state: state ?? "",
        codeChallenge: validated.codeChallenge,
        codeChallengeMethod: validated.codeChallengeMethod,
        resource: validated.resource ?? "",
      }}
      permissions={validated.scopes.map((scope: Scope) => ({
        scope,
        description: SCOPE_DESCRIPTIONS[scope],
      }))}
    />
  );
}
