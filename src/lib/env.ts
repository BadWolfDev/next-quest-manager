import "server-only";

/**
 * Startup environment validation.
 *
 * Next Quest Manager deliberately needs exactly two variables. Anything missing
 * fails loudly at first import with a message that says how to fix it, rather
 * than surfacing later as an opaque connection or JWT error.
 */

type EnvShape = {
  DATABASE_URL: string;
  AUTH_SECRET: string;
};

function readEnv(): EnvShape {
  const problems: string[] = [];

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    problems.push(
      "DATABASE_URL is not set. Point it at a Postgres instance, e.g.\n" +
        "  DATABASE_URL=postgres://postgres:postgres@localhost:5432/nextquest\n" +
        "  (run `docker compose up -d db` for a local one)",
    );
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push(
      `DATABASE_URL must be a postgres:// or postgresql:// URL (got "${databaseUrl.slice(0, 24)}…").`,
    );
  }

  // Auth.js reads AUTH_SECRET itself, but we check it here so the failure is a
  // clear startup error instead of a runtime decrypt failure.
  const authSecret = (
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    ""
  ).trim();
  if (!authSecret) {
    problems.push(
      "AUTH_SECRET is not set. Generate one with:\n" +
        "  openssl rand -base64 32",
    );
  } else if (authSecret.length < 32) {
    problems.push(
      "AUTH_SECRET is too short (needs at least 32 characters). Generate one with:\n" +
        "  openssl rand -base64 32",
    );
  }

  if (problems.length > 0) {
    const bullets = problems
      .map((p) => `  • ${p.split("\n").join("\n    ")}`)
      .join("\n\n");
    throw new Error(
      `\n[Next Quest Manager] Invalid environment configuration:\n\n` +
        bullets +
        `\n\nCopy .env.example to .env and fill it in.\n`,
    );
  }

  return { DATABASE_URL: databaseUrl!, AUTH_SECRET: authSecret };
}

/**
 * During `next build` the page-data collection step imports server modules
 * without a real environment. We only hard-fail when the value is actually
 * used, so builds stay possible without secrets present.
 */
let cached: EnvShape | null = null;

export const env: EnvShape = new Proxy({} as EnvShape, {
  get(_target, prop: string) {
    cached ??= readEnv();
    return cached[prop as keyof EnvShape];
  },
});
