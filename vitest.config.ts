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
        // Entry points: they only read the environment (or find #root),
        // call code that has its own tests and handle the process exit.
        // Keep them that thin; logic that grows here belongs in a module
        // with tests, as admin-cli's commands did (admin-commands.ts).
        // The Nest *.module.ts files stay counted: they wire the API.
        "apps/api/src/main.ts",
        "apps/worker/src/main.ts",
        "apps/web/src/main.tsx",
        "packages/db/src/*-cli.ts",
      ],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
