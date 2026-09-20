"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { toActionError, type ActionState } from "@/lib/action-result";
import { requireUser } from "@/lib/authorize";
import {
  getClient,
  issueAuthorizationCode,
  listConnectedApps,
  recordConsent,
  revokeClientGrant,
} from "@/lib/core/oauth";
import { relativeLabel } from "@/lib/format";
import {
  errorRedirect,
  matchRedirectUri,
  publicOriginFromHeaders,
  successRedirect,
  validateAuthorizationRequest,
} from "@/lib/oauth";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The consent decision and the Connected apps screen.
 *
 * Every export here is a public HTTP endpoint, so none of them takes an actor:
 * the acting user is always resolved from the session by `requireUser()`.
 * Naming a user by argument would be impersonation by argument.
 *
 * The decision action re-validates the *entire* authorization request from the
 * submitted fields — client, redirect URI, PKCE challenge, scope, audience —
 * rather than trusting that the page that rendered the form had already checked
 * them. A hidden field is a value the browser sends, not a value the server
 * knows, and this form is as reachable by a script as by the consent screen.
 */

const AUTHORIZE_RATE_LIMIT = { limit: 30, windowSeconds: 5 * 60 } as const;

const decisionSchema = z.object({
  decision: z.enum(["approve", "deny"]),
  client_id: z.string().trim().min(1).max(200),
  redirect_uri: z.string().trim().min(1).max(2048),
  scope: z.string().trim().max(200).optional().default(""),
  state: z.string().max(2048).optional().default(""),
  code_challenge: z.string().trim().min(43).max(128),
  code_challenge_method: z.string().trim().max(20),
  resource: z.string().trim().max(2048).optional().default(""),
});

export type AuthorizeDecisionState = ActionState & {
  /**
   * Where the browser must go next. Returned rather than redirected to,
   * because a registered redirect URI may use a private-use scheme
   * (`cursor://…`, `com.example.app:/cb`) that cannot be an HTTP `Location`
   * target. The client component navigates to it.
   */
  redirectTo?: string;
};

/** Approve or deny a pending authorization request. */
export async function decideAuthorizationAction(
  _prev: AuthorizeDecisionState,
  formData: FormData,
): Promise<AuthorizeDecisionState> {
  try {
    const input = decisionSchema.parse(Object.fromEntries(formData.entries()));

    const user = await requireUser();

    const limited = await rateLimit({
      key: `oauth:authorize:${user.id}`,
      ...AUTHORIZE_RATE_LIMIT,
    });
    if (!limited.ok) {
      return {
        ok: false,
        message: "Too many authorization attempts. Try again in a few minutes.",
      };
    }

    // Re-load the client rather than believing the form about who it is.
    const client = await getClient(input.client_id);
    if (!client) {
      return { ok: false, message: "That application is not registered." };
    }

    // Re-check the redirect against the registered allowlist *before* anything
    // else, including the deny path. This is the one check that must never be
    // skipped: everything else only decides *whether* a code is minted, this
    // decides *who receives it*.
    const redirectUri = matchRedirectUri(client.redirectUris, input.redirect_uri);
    if (!redirectUri) {
      return {
        ok: false,
        message: "That redirect address is not registered for this application.",
      };
    }

    const state = input.state === "" ? null : input.state;

    if (input.decision === "deny") {
      return {
        ok: true,
        redirectTo: errorRedirect(
          redirectUri,
          "access_denied",
          state,
          "The user declined the request.",
        ),
      };
    }

    // The same validation the consent page ran, from the same function — the
    // page's checks are a courtesy to the human, these are the ones that count.
    const validated = validateAuthorizationRequest(
      client,
      {
        redirectUri: input.redirect_uri,
        scope: input.scope,
        codeChallenge: input.code_challenge,
        codeChallengeMethod: input.code_challenge_method,
        resource: input.resource,
      },
      publicOriginFromHeaders(await headers()),
    );

    if (!validated.ok) {
      if (!validated.redirectable || !validated.redirectUri) {
        return { ok: false, message: validated.description };
      }
      return {
        ok: true,
        redirectTo: errorRedirect(
          validated.redirectUri,
          validated.error,
          state,
          validated.description,
        ),
      };
    }

    const code = await issueAuthorizationCode({
      clientId: client.id,
      userId: user.id,
      redirectUri: validated.redirectUri,
      scope: validated.scope,
      codeChallenge: validated.codeChallenge,
      codeChallengeMethod: validated.codeChallengeMethod,
      resource: validated.resource,
    });

    // Recorded now rather than at the token exchange, so "Connected apps"
    // reflects what the person actually agreed to even if the client never
    // completes the exchange.
    await recordConsent(user.id, client.id, validated.scope);
    revalidatePath("/settings/apps");

    return {
      ok: true,
      redirectTo: successRedirect(validated.redirectUri, code, state),
    };
  } catch (error) {
    return toActionError(error);
  }
}

export type ConnectedAppRow = {
  clientId: string;
  name: string;
  clientUri: string | null;
  scopes: string[];
  /**
   * Rendered on the server. Formatting a date during a client render makes the
   * server and the client disagree — the same hydration trap the tokens screen
   * documents.
   */
  authorisedLabel: string;
  lastUsedLabel: string;
  active: boolean;
};

/** The caller's own connected apps. Scoped to their id in SQL. */
export async function listMyConnectedApps(): Promise<ConnectedAppRow[]> {
  const user = await requireUser();
  const apps = await listConnectedApps(user.id);

  return apps.map((app) => ({
    clientId: app.clientId,
    name: app.name,
    clientUri: app.clientUri,
    scopes: app.scopes,
    authorisedLabel: app.authorisedAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    lastUsedLabel: relativeLabel(app.lastUsedAt),
    active: app.activeTokens > 0,
  }));
}

/** Disconnect an app: revoke every token it holds for the caller, drop consent. */
export async function revokeClientGrantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { clientId } = z
      .object({ clientId: z.string().trim().min(1).max(200) })
      .parse({ clientId: formData.get("clientId") });

    const user = await requireUser();
    await revokeClientGrant(user.id, clientId);

    revalidatePath("/settings/apps");
    return { ok: true, message: "Disconnected." };
  } catch (error) {
    return toActionError(error);
  }
}
