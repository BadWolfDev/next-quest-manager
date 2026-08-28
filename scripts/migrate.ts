/**
 * Applies pending Drizzle migrations from ./drizzle.
 *
 * Run with `npm run db:migrate`. Safe to run repeatedly and safe to run as a
 * release step (Vercel build command, Docker entrypoint, CI) — Drizzle records
 * applied migrations in `drizzle.__drizzle_migrations`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  process.loadEnvFile?.(".env");
}

const url = process.env.DATABASE_URL;

if (!url) {
  console.error(
    "\n[Next Quest Manager] DATABASE_URL is not set.\n" +
      "Copy .env.example to .env and point DATABASE_URL at your Postgres instance, e.g.\n" +
      "  DATABASE_URL=postgres://postgres:postgres@localhost:5432/nextquest\n",
  );
  process.exit(1);
}

/**
 * Guard against migrating a remote database by accident.
 *
 * `.env.local` (written by the Vercel/Neon integration) holds the *production*
 * connection string and Next.js loads it at higher priority than `.env`, so a
 * stray shell can easily end up pointed at production. Local hosts run freely;
 * anything else has to be opted into explicitly, which is what a deploy
 * pipeline does.
 */
function assertMigrationTargetAllowed(target: string) {
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    console.error("[migrate] DATABASE_URL is not a parseable URL.");
    process.exit(1);
  }

  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (isLocal || process.env.NQM_ALLOW_REMOTE_MIGRATE === "1") return;

  console.error(
    `\n[migrate] Refusing to migrate a non-local database.\n\n` +
      `  host: ${host}\n\n` +
      `If this is deliberate (a deploy step, for example), re-run with:\n` +
      `  NQM_ALLOW_REMOTE_MIGRATE=1 npm run db:migrate\n`,
  );
  process.exit(1);
}

async function main() {
  assertMigrationTargetAllowed(url!);
  console.log(`[migrate] target: ${new URL(url!).hostname}`);

  // A dedicated single connection with max:1 — migrations must not interleave.
  const client = postgres(url!, { max: 1, prepare: false, onnotice: () => {} });
  const db = drizzle(client);

  console.log("[migrate] applying migrations from ./drizzle …");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] done.");

  await client.end();
}

main().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
