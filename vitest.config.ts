// One run over every package, for the coverage report: `pnpm coverage`.
// Each package keeps its own config (the database ones need a long hook
// timeout), and `pnpm test` inside a package still runs only that one.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    // Each database test file starts its own Postgres container; all of
    // them at once in one run made a start time out.
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      include: ["{packages,apps}/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        // The test helper itself (Testcontainers), never run in production.
        "packages/db/src/testing.ts",
      ],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
