import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Unit + integration test runner.
 *
 * Tests live next to the code they cover as `*.test.ts`, so the alias map has
 * to mirror `tsconfig.json`'s `@/*` path. `server-only` is aliased to the
 * marker package's empty build: importing it outside a React Server Component
 * throws by design, and half the modules worth testing (`lib/positions.ts`,
 * `lib/registration.ts`, `lib/authorize.ts`) start with it.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The Postgres integration tests migrate a database in `beforeAll`.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: [
      {
        find: /^server-only$/,
        replacement: fileURLToPath(
          new URL("./node_modules/server-only/empty.js", import.meta.url),
        ),
      },
      {
        find: /^@\/(.*)$/,
        replacement: fileURLToPath(new URL("./src/", import.meta.url)) + "$1",
      },
    ],
  },
});
