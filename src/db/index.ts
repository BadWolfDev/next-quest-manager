import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";
import { env } from "@/lib/env";

/**
 * Postgres is the only external dependency Next Quest Manager has.
 *
 * The client is cached on `globalThis` so Next.js dev hot-reloads (and warm
 * serverless lambdas) reuse a single connection pool instead of leaking one per
 * module evaluation.
 *
 * `prepare: false` is required for transaction-pooled Postgres (PgBouncer in
 * transaction mode, Supabase's pooler, Neon's pooled endpoint) which cannot
 * carry named prepared statements across connections.
 */
const globalForDb = globalThis as unknown as {
  __nqmSql?: ReturnType<typeof postgres>;
};

function createClient() {
  return postgres(env.DATABASE_URL, {
    prepare: false,
    // Serverless-friendly: keep the pool small and let idle connections go.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 15,
  });
}

export const sql = globalForDb.__nqmSql ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__nqmSql = sql;
}

export const db = drizzle(sql, { schema });

export type Database = typeof db;
export { schema };
