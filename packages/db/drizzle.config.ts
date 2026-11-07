import { defineConfig } from "drizzle-kit";

// Only `generate` is used: it diffs src/schema.ts against the last snapshot
// and writes a new SQL file. Migrations are applied by runMigrations().
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
