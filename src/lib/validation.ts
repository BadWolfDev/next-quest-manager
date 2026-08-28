import { z } from "zod";

/** Every entity id in NQM is a UUID and every URL segment is validated as one. */
export const uuidSchema = z.uuid({ message: "Invalid id." });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email address."));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "That password is too long.");

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(80, "Keep it under 80 characters.");

export const signUpSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Give the workspace a name.")
  .max(60, "Keep it under 60 characters.");

export const boardNameSchema = z
  .string()
  .trim()
  .min(1, "Give the board a name.")
  .max(80, "Keep it under 80 characters.");

export const listNameSchema = z
  .string()
  .trim()
  .min(1, "Give the list a name.")
  .max(80, "Keep it under 80 characters.");

export const cardTitleSchema = z
  .string()
  .trim()
  .min(1, "Give the card a title.")
  .max(500, "Keep it under 500 characters.");

export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Pick a valid colour.");

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;

/** Collapses a ZodError into `{ field: firstMessage }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) {
      out[key] = issue.message;
    }
  }
  return out;
}

/** URL-safe slug derived from a workspace name, with a short uniqueness tail. */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}
