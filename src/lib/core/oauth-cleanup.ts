import "server-only";

import { sql as raw } from "drizzle-orm";

import { db } from "@/db";
import { REFRESH_TOKEN_TTL_SECONDS } from "@/lib/oauth";

/**
 * Housekeeping for the OAuth tables.
 *
 * Spent authorization codes and dead tokens are kept for a while on purpose —
 * a code row is what identifies the family to revoke when a stolen code is
 * replayed, and a revoked token row is what turns a reused refresh token into
 * a detection rather than a silent 401. Both stop being useful long before
 * they stop taking up space, so the windows below are generous.
 *
 * Runs from the existing cron sweep; this is a second step in that job, not a
 * second schedule. Nothing here is time-critical: skipping a night costs rows,
 * not correctness.
 */

/**
 * A code row outlives the code by as long as the family it started can live.
 *
 * The row is what identifies the family to revoke when a stolen code is
 * replayed (`oauth_tokens.family_id` *is* this row's id), and a refresh token
 * descended from it is valid for `REFRESH_TOKEN_TTL_SECONDS`. Pruning the code
 * sooner than that would quietly retire replay detection while the grant it
 * protects is still live — so a code is only deleted once it is older than a
 * whole refresh lifetime, or once its family holds nothing live to revoke.
 */
const CODE_RETENTION_SECONDS = REFRESH_TOKEN_TTL_SECONDS;
/** A dead family is still worth a day, so a same-night replay is still seen. */
const DEAD_FAMILY_GRACE_DAYS = 1;
/** Long enough that a client rotating monthly still trips the replay check. */
const TOKEN_RETENTION_DAYS = 30;

export type OauthCleanupSummary = {
  codesDeleted: number;
  tokensDeleted: number;
};

export async function cleanupOauth(): Promise<OauthCleanupSummary> {
  const codes = await db.execute<{ id: string }>(raw`
    DELETE FROM oauth_authorization_codes c
    WHERE c.expires_at < now() - (${CODE_RETENTION_SECONDS} || ' seconds')::interval
       OR (
         c.expires_at < now() - (${DEAD_FAMILY_GRACE_DAYS} || ' days')::interval
         AND NOT EXISTS (
           SELECT 1 FROM oauth_tokens t
           WHERE t.family_id = c.id
             AND t.revoked_at IS NULL
             AND t.expires_at > now()
         )
       )
    RETURNING c.id
  `);

  const tokens = await db.execute<{ id: string }>(raw`
    DELETE FROM oauth_tokens
    WHERE (
      expires_at < now() - (${TOKEN_RETENTION_DAYS} || ' days')::interval
      OR revoked_at < now() - (${TOKEN_RETENTION_DAYS} || ' days')::interval
    )
    RETURNING id
  `);

  return { codesDeleted: codes.length, tokensDeleted: tokens.length };
}
