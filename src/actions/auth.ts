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
import { hashPassword } from "@/lib/password";
import {
  AUTH_RATE_LIMIT,
  clientIpFromHeaders,
  rateLimit,
} from "@/lib/rate-limit";
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
      // The very first account on a fresh instance becomes the admin.
      const [{ count }] = await tx
        .select({ count: raw<number>`count(*)::int` })
        .from(users);
      const isFirstUser = Number(count) === 0;

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
