"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { toActionError, type ActionState } from "@/lib/action-result";
import { generateToken } from "@/lib/api-tokens";
import { requireUser } from "@/lib/authorize";
import { relativeLabel } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";

const createTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the token a name.")
    .max(60, "Keep it under 60 characters."),
  readOnly: z.boolean().default(false),
  /** Days until expiry; empty means never. */
  expiresInDays: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(3650)])
    .default(""),
});

export type CreateTokenState = ActionState & {
  /** Present exactly once, on the response that created the token. */
  token?: string;
};

/**
 * Mint a personal access token.
 *
 * The raw value is returned here and never stored — only its SHA-256 digest
 * goes to the database, so this response is the one and only chance to copy it.
 */
export async function createTokenAction(
  _prev: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  try {
    const input = createTokenSchema.parse({
      name: formData.get("name"),
      readOnly: formData.get("readOnly") === "on",
      expiresInDays: formData.get("expiresInDays") ?? "",
    });

    const user = await requireUser();
    const { raw, hash, prefix } = generateToken();

    const expiresAt =
      typeof input.expiresInDays === "number"
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;

    await db.insert(apiTokens).values({
      userId: user.id,
      name: input.name,
      tokenPrefix: prefix,
      tokenHash: hash,
      readOnly: input.readOnly,
      expiresAt,
    });

    revalidatePath("/settings/tokens");
    return { ok: true, token: raw };
  } catch (error) {
    return toActionError(error);
  }
}

/** Revoke a token. Scoped to the caller's own tokens in the WHERE clause. */
export async function revokeTokenAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tokenId } = z
      .object({ tokenId: uuidSchema })
      .parse({ tokenId: formData.get("tokenId") });

    const user = await requireUser();

    await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          // Ownership is part of the update predicate, so another user's token
          // is simply not matched — there is no read-then-check window.
          eq(apiTokens.userId, user.id),
          isNull(apiTokens.revokedAt),
        ),
      );

    revalidatePath("/settings/tokens");
    return { ok: true, message: "Token revoked." };
  } catch (error) {
    return toActionError(error);
  }
}

export type TokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  readOnly: boolean;
  /**
   * Display fields are rendered here, on the server, rather than in the client
   * component. Calling `Date.now()` during render is impure and makes the
   * server and client disagree about "3m ago" — the same class of hydration bug
   * the theme toggle had.
   */
  expired: boolean;
  lastUsedLabel: string;
  expiresLabel: string | null;
};

/** The caller's own tokens, newest first. Revoked ones are not listed. */
export async function listMyTokens(): Promise<TokenRow[]> {
  const user = await requireUser();

  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      readOnly: apiTokens.readOnly,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    readOnly: row.readOnly,
    expired: row.expiresAt !== null && row.expiresAt.getTime() < now,
    lastUsedLabel: relativeLabel(row.lastUsedAt),
    expiresLabel: row.expiresAt
      ? row.expiresAt.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null,
  }));
}
