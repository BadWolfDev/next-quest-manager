import { runMigrations } from "../scripts/migrate";

/**
 * Migrate the integration-test database once, before any test file runs.
 *
 * Several `*.test.ts` files exercise Postgres and each calls `runMigrations`
 * in its own `beforeAll`. Vitest runs files in parallel, so on a *fresh*
 * database two of them would race to create drizzle's bookkeeping table and
 * one would fail. Migrating here first turns every per-file call into the
 * no-op it is meant to be.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (url) await runMigrations(url);
}
