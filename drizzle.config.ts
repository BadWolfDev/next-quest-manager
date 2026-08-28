import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  // drizzle-kit runs outside Next.js, so load .env manually when present.
  process.loadEnvFile?.(".env");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
