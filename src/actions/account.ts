"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { requireUser } from "@/lib/authorize";
import {
  burnPasswordVerification,
  hashPassword,
  verifyPassword,
} from "@/lib/password";
import {
  AUTH_RATE_LIMIT,
  clientIpFromHeaders,
  rateLimit,
} from "@/lib/rate-limit";
import { nameSchema, passwordSchema } from "@/lib/validation";

/**
 * Account settings — the signed-in user's own profile.
 *
 * Both actions scope every write to `requireUser()`'s id. There is no user id
 * in the form and no `actor` parameter: every export of a `"use server"` file
 * is a public endpoint, so the only safe subject is the session's own user.
 */

const profileSchema = z.object({ name: nameSchema });

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    // Deliberately the same policy as signup — one place decides what a
    // password has to be.
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Those passwords do not match.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you have not used here before.",
  });

/** Change your display name. */
export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const { name } = profileSchema.parse({ name: formData.get("name") });

    await db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    // The name is rendered in the app shell (user menu, avatars), so the
    // layout has to be revalidated, not just the current page.
    revalidatePath("/app", "layout");
    return { ok: true, message: "Profile updated." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Change your password.
 *
 * Throttled on the same bucket shape as sign-in: this endpoint verifies a
 * password, so it is an oracle for the current one unless it is rate-limited.
 * The hash is re-read from the database rather than trusted from the session,
 * and the verification is a full argon2id pass — including on the impossible
 * path where the row has vanished, so the response time says nothing.
 */
export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const input = passwordChangeSchema.parse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });

    const ip = clientIpFromHeaders(new Headers(await headers()));
    const limited = await rateLimit({
      key: `password-change:${ip}:${user.id}`,
      ...AUTH_RATE_LIMIT,
    });
    if (!limited.ok) {
      return {
        ok: false,
        message: "Too many attempts. Try again in a few minutes.",
      };
    }

    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!row) {
      await burnPasswordVerification(input.currentPassword);
      return { ok: false, message: "Please sign in and try again." };
    }

    const valid = await verifyPassword(row.passwordHash, input.currentPassword);
    if (!valid) {
      return {
        ok: false,
        message: "That is not your current password.",
        fields: { currentPassword: "That is not your current password." },
      };
    }

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(input.newPassword),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Sessions are JWTs, so existing ones stay valid until they expire. That
    // is the documented phase-1 trade-off for stateless sessions; changing a
    // password is not an instant remote sign-out.
    return { ok: true, message: "Password changed." };
  } catch (error) {
    return toActionError(error);
  }
}
