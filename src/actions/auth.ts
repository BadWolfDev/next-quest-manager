"use server";

import { AuthError } from "next-auth";

import { eq, sql as raw } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signIn } from "@/auth";
import { db } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import { toActionError, type ActionState } from "@/lib/action-result";
import { AuthorizationError } from "@/lib/errors";
import { hashPassword } from "@/lib/password";
import {
  AUTH_RATE_LIMIT,
  clientIpFromHeaders,
  rateLimit,
} from "@/lib/rate-limit";
import {
  claimUserInviteUse,
  isClosedRegistration,
  resolveUserInvite,
} from "@/lib/registration";
import { signInSchema, signUpSchema, slugify } from "@/lib/validation";

const nextPathSchema = z
  .string()
  // Only same-origin absolute paths — never an off-site open redirect.
  .regex(/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/)
  .max(512)
  .catch("/app");

function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || value.length === 0) return "/app";
  return nextPathSchema.parse(value);
}

/**
 * Sign in with email + password.
 * Throttling and argon2id verification happen inside the credentials provider.
 */
export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const next = safeNext(formData.get("next"));

  try {
    const input = signInSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    await signIn("credentials", { ...input, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // CredentialsSignin is the generic "bad email or password" case — never
      // distinguish "no such user" from "wrong password".
      const message =
        error.type === "CredentialsSignin"
          ? "That email and password combination didn't work."
          : (error.cause?.err?.message ??
            "We couldn't sign you in. Please try again.");
      return { ok: false, message };
    }
    return toActionError(error);
  }

  redirect(next);
}

/**
 * Create an account.
 *
 * Everything below — user row, personal workspace, owner membership, activity
 * entry — happens in one transaction, so a partial signup can never leave an
 * account without a workspace.
 */
export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Carries an invite (or any other destination) across the signup detour.
  const next = safeNext(formData.get("next"));
  let email: string;
  let password: string;

  try {
    const input = signUpSchema.parse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
    });
    email = input.email;
    password = input.password;

    /*
      Closed registration is enforced HERE, not in the UI. The signup page
      hides its form, but this action is a public endpoint and must refuse on
      its own — hiding a form is not access control.
    */
    const closed = isClosedRegistration();
    const rawInvite = formData.get("inviteToken");
    const inviteToken =
      typeof rawInvite === "string" && rawInvite.length > 0 ? rawInvite : null;

    let inviteId: string | null = null;

    if (closed) {
      if (!inviteToken) {
        return {
          ok: false,
          message:
            "This instance is invite-only. Ask an administrator for an invite link.",
        };
      }

      const resolved = await resolveUserInvite(inviteToken);
      if (!resolved.ok) {
        return { ok: false, message: "This invite link can no longer be used." };
      }
      if (
        resolved.invite.email &&
        resolved.invite.email.toLowerCase() !== input.email
      ) {
        return {
          ok: false,
          message: "This invite was issued for a different email address.",
          fields: { email: "Does not match the invite." },
        };
      }
      inviteId = resolved.invite.id;
    }

    const ip = clientIpFromHeaders(new Headers(await headers()));
    const limited = await rateLimit({
      key: `signup:${ip}`,
      ...AUTH_RATE_LIMIT,
    });
    if (!limited.ok) {
      return {
        ok: false,
        message: "Too many sign-up attempts. Try again in a few minutes.",
      };
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      return {
        ok: false,
        message: "That email is already registered. Try signing in instead.",
        fields: { email: "Already registered." },
      };
    }

    const passwordHash = await hashPassword(password);

    await db.transaction(async (tx) => {
      // Claim the invite in the same transaction that creates the user, so a
      // failure anywhere below gives the seat back.
      if (inviteId) {
        const claimed = await claimUserInviteUse(tx, inviteId);
        if (!claimed) {
          throw new AuthorizationError("This invite is no longer usable.");
        }
      }

      /*
        The very first account on an OPEN instance becomes the admin. Never in
        closed mode: the bootstrap admin is created on first login, so a /join
        signup that happened first would otherwise seize the admin role on an
        instance somebody else operates.
      */
      const [{ count }] = await tx
        .select({ count: raw<number>`count(*)::int` })
        .from(users);
      const isFirstUser = !closed && Number(count) === 0;

      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          passwordHash,
          role: isFirstUser ? "admin" : "user",
        })
        .returning({ id: users.id });

      const slug = `${slugify(input.name)}-${crypto.randomUUID().slice(0, 8)}`;

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: `${input.name}'s Workspace`,
          slug,
          createdBy: user.id,
          theme: { accent: "violet" },
        })
        .returning({ id: workspaces.id });

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });

      await recordActivity(tx, {
        workspaceId: workspace.id,
        actorId: user.id,
        type: "workspace.created",
        data: { name: `${input.name}'s Workspace`, reason: "signup" },
      });
    });
  } catch (error) {
    // Unique-violation race: two concurrent signups for the same email.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      return {
        ok: false,
        message: "That email is already registered. Try signing in instead.",
        fields: { email: "Already registered." },
      };
    }
    return toActionError(error);
  }

  // Sign the new account straight in.
  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: true,
        message: "Account created. Please sign in.",
      };
    }
    throw error;
  }

  redirect(next);
}
