import { z } from "zod";

import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { fieldErrors } from "@/lib/validation";
import { logError } from "@/lib/log-error";

export type ActionState = {
  ok: boolean;
  message?: string;
  fields?: Record<string, string>;
};

export const idleState: ActionState = { ok: false };

/**
 * Uniform failure translation for server actions.
 *
 * Zod issues become per-field messages; authorization failures become a generic
 * message (never "this board exists but you can't see it"); everything else
 * becomes a neutral message with the real error logged server-side only.
 */
export function toActionError(error: unknown): ActionState {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fields: fieldErrors(error),
    };
  }
  if (error instanceof AuthenticationError) {
    return { ok: false, message: "Please sign in and try again." };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, message: error.message };
  }
  logError("[action]", error);
  return { ok: false, message: "Something went wrong. Please try again." };
}
