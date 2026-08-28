import "server-only";

import { sql as raw } from "drizzle-orm";

import { db } from "@/db";

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the current window expires. */
  retryAfter: number;
};

export type RateLimitOptions = {
  /** Opaque bucket key, e.g. `login:${ip}:${email}`. */
  key: string;
  /** Max attempts allowed inside one window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

/**
 * Postgres-backed fixed-window rate limiter.
 *
 * NQM has no Redis by design, so throttling lives in the `rate_limits` table.
 * The whole check-and-increment is a single atomic `INSERT … ON CONFLICT DO
 * UPDATE`: rows whose window has expired are reset to 1, live rows are bumped,
 * and the returned count tells us whether this attempt is over the limit. No
 * read-then-write race is possible.
 *
 * Fails **closed** — if Postgres is unreachable we deny the attempt rather than
 * letting an attacker knock out the database to disable throttling.
 */
export async function rateLimit({
  key,
  limit,
  windowSeconds,
}: RateLimitOptions): Promise<RateLimitResult> {
  try {
    const rows = await db.execute<{ count: number; window_start: Date }>(raw`
      INSERT INTO rate_limits (key, window_start, count)
      VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start < now() - (${windowSeconds} || ' seconds')::interval
            THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start < now() - (${windowSeconds} || ' seconds')::interval
            THEN now()
          ELSE rate_limits.window_start
        END
      RETURNING count, window_start
    `);

    const row = rows[0];
    if (!row) {
      return { ok: false, remaining: 0, retryAfter: windowSeconds };
    }

    const count = Number(row.count);
    const windowStart = new Date(row.window_start).getTime();
    const elapsed = Math.floor((Date.now() - windowStart) / 1000);
    const retryAfter = Math.max(1, windowSeconds - elapsed);

    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter,
    };
  } catch (error) {
    console.error("[rate-limit] failing closed:", error);
    return { ok: false, remaining: 0, retryAfter: windowSeconds };
  }
}

/** Best-effort housekeeping — safe to call from a cron job. */
export async function pruneRateLimits(olderThanSeconds = 86_400) {
  await db.execute(raw`
    DELETE FROM rate_limits
    WHERE window_start < now() - (${olderThanSeconds} || ' seconds')::interval
  `);
}

/**
 * Best-effort client IP from proxy headers. Vercel sets `x-forwarded-for`;
 * self-hosted deployments behind nginx/Caddy do too. Falls back to a constant
 * bucket so throttling still applies (globally) when no IP is available.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export const AUTH_RATE_LIMIT = {
  limit: 10,
  windowSeconds: 15 * 60,
} as const;
