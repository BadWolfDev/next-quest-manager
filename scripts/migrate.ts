/**
 * Migration plumbing, shared by the two entry points:
 *   scripts/db-migrate.ts     — `npm run db:migrate` (manual / local / CI)
 *   scripts/deploy-migrate.ts — the Vercel build step
 *
 * Importing this module does nothing on its own; nothing here runs until an
 * entry point calls it. Safe to run repeatedly — Drizzle records what it has
 * applied in `drizzle.__drizzle_migrations`, so a second run is a no-op.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Load `.env` for local runs. Absent on Vercel, which is fine. */
export function loadLocalEnv() {
  if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED) return;
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // No .env — the caller reports the missing variable.
  }
}

/**
 * The connection string to migrate through.
 *
 * `DATABASE_URL_UNPOOLED` wins when present. Neon's pooled endpoint runs
 * PgBouncer in transaction mode, which cannot hold the session-level advisory
 * lock and multi-statement DDL a migration needs; the direct endpoint can.
 * The app itself still uses the pooled URL at runtime.
 */
export function resolveDatabaseUrl(): {
  url: string | undefined;
  source: string;
} {
  if (process.env.DATABASE_URL_UNPOOLED) {
    return { url: process.env.DATABASE_URL_UNPOOLED, source: "DATABASE_URL_UNPOOLED" };
  }
  return { url: process.env.DATABASE_URL, source: "DATABASE_URL" };
}

/**
 * Refuse to migrate a remote database unless something has explicitly said so.
 *
 * `.env.local` (written by the Vercel/Neon integration) holds the *production*
 * connection string and Next.js loads it at higher priority than `.env`, so a
 * stray local shell can easily end up pointed at production. That is the only
 * thing this guard exists to prevent.
 *
 * Two things count as consent:
 *  - `VERCEL=1` — we are inside a deploy, which is exactly when migrating a
 *    remote database is the correct thing to do. Making this implicit is what
 *    lets someone fork the repo and deploy with zero extra configuration.
 *  - `NQM_ALLOW_REMOTE_MIGRATE=1` — for CI or a manual release step elsewhere.
 */
export function assertMigrationTargetAllowed(target: string): void {
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    console.error("[migrate] DATABASE_URL is not a parseable URL.");
    process.exit(1);
  }

  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocal) return;
  if (process.env.VERCEL === "1") return;
  if (process.env.NQM_ALLOW_REMOTE_MIGRATE === "1") return;

  console.error(
    `\n[migrate] Refusing to migrate a non-local database.\n\n` +
      `  host: ${host}\n\n` +
      `This guard protects local development from the production connection\n` +
      `string in .env.local. If this is deliberate, re-run with:\n` +
      `  NQM_ALLOW_REMOTE_MIGRATE=1 npm run db:migrate\n` +
      `(Vercel deploys set VERCEL=1 and are allowed automatically.)\n`,
  );
  process.exit(1);
}

/** Apply pending migrations. Throws on failure so callers can fail the build. */
export async function runMigrations(url: string): Promise<void> {
  // One dedicated connection: migrations must not interleave.
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}

