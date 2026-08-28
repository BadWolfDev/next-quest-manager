/**
 * Log a server-side error without leaking user content.
 *
 * Deliberately NOT `server-only`: `action-result.ts` imports this and is itself
 * imported by client components (for `ActionState`/`idleState`), so marking it
 * server-only would drag the guard into the browser bundle and break the build.
 * There is nothing server-specific in here — it is a console wrapper.
 *
 * postgres.js attaches the failing `query` and its `parameters` to the error.
 * Those parameters are whatever the user typed — card titles, descriptions,
 * email addresses — so dumping the error wholesale writes user content into
 * production logs. In development the full object is genuinely useful, so the
 * verbosity is kept there and only trimmed in production.
 */
const PG_NOISY_FIELDS = [
  "query",
  "parameters",
  "params",
  "where",
  "detail",
  "internal_query",
] as const;

export function logError(scope: string, error: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    console.error(scope, error);
    return;
  }

  if (error instanceof Error) {
    const safe: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    };
    // Postgres error codes are diagnostic, not sensitive — keep them.
    for (const key of ["code", "severity", "constraint_name", "table_name", "column_name"]) {
      const value = (error as unknown as Record<string, unknown>)[key];
      if (value !== undefined) safe[key] = value;
    }
    const dropped = PG_NOISY_FIELDS.filter(
      (k) => (error as unknown as Record<string, unknown>)[k] !== undefined,
    );
    if (dropped.length > 0) safe.redacted = dropped;
    console.error(scope, safe);
    return;
  }

  console.error(scope, "(non-Error thrown)");
}
