/**
 * Deploy-time migration step, run by `vercel-build` before `next build`.
 *
 * Why this exists: a deploy once shipped code that referenced a column whose
 * migration had never been applied, and every board page 500ed until someone
 * ran the migration by hand. Schema and code now ship together or not at all.
 *
 * It is deliberately inert unless BOTH conditions hold:
 *   - `VERCEL=1`      — we are inside a Vercel build
 *   - a database URL  — there is something to migrate
 *
 * So a plain local `npm run build` never opens a connection. If the migration
 * fails, this exits non-zero and takes the build down with it: deploying code
 * ahead of its schema is the exact failure we are preventing.
 */
import {
  assertMigrationTargetAllowed,
  resolveDatabaseUrl,
  runMigrations,
} from "./migrate";

async function main() {
  if (process.env.VERCEL !== "1") {
    console.log(
      "[deploy-migrate] not a Vercel build (VERCEL != 1) — skipping migrations.",
    );
    return;
  }

  const { url, source } = resolveDatabaseUrl();
  if (!url) {
    // Not fatal here: the app's own startup validation reports a missing
    // DATABASE_URL with a much clearer message than a migration failure would.
    console.warn(
      "[deploy-migrate] VERCEL=1 but no DATABASE_URL / DATABASE_URL_UNPOOLED — skipping migrations.",
    );
    return;
  }

  assertMigrationTargetAllowed(url);
  console.log(
    `[deploy-migrate] migrating ${new URL(url).hostname} (via ${source}) before build …`,
  );
  await runMigrations(url);
  console.log("[deploy-migrate] migrations applied.");
}

main().catch((error) => {
  console.error("\n[deploy-migrate] MIGRATION FAILED — failing the build.");
  console.error(
    "Deploying now would ship code against an older schema, which is the\n" +
      "incident this step exists to prevent.\n",
  );
  console.error(error);
  process.exit(1);
});
