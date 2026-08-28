/**
 * CLI entry point: `npm run db:migrate`.
 *
 * Applies pending migrations to whatever DATABASE_URL points at, subject to the
 * remote-host guard in `migrate.ts`.
 */
import {
  assertMigrationTargetAllowed,
  loadLocalEnv,
  resolveDatabaseUrl,
  runMigrations,
} from "./migrate";

async function main() {
  loadLocalEnv();
  const { url, source } = resolveDatabaseUrl();

  if (!url) {
    console.error(
      "\n[Next Quest Manager] DATABASE_URL is not set.\n" +
        "Copy .env.example to .env and point DATABASE_URL at your Postgres instance, e.g.\n" +
        "  DATABASE_URL=postgres://postgres:postgres@localhost:5432/nextquest\n",
    );
    process.exit(1);
  }

  assertMigrationTargetAllowed(url);
  console.log(`[migrate] target: ${new URL(url).hostname} (via ${source})`);
  console.log("[migrate] applying migrations from ./drizzle …");
  await runMigrations(url);
  console.log("[migrate] done.");
}

main().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
