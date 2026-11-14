// @ts-check
// Only for measuring (pnpm complexity, the CI's summary): every
// function's cyclomatic complexity, from ESLint's own `complexity` rule
// with max 0, so each function is reported with its number. No type
// information and no other rule, so it runs fast. The usual lint is
// eslint.config.js; this one never fails a run.
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Not even listed in the report: built output and generated reports.
  { ignores: ["**/dist/", "**/coverage/", "**/node_modules/", "**/reports/"] },
  {
    // Production code only: tests, test helpers and the throwaway
    // prototype are left out.
    files: [
      "apps/*/src/**/*.{ts,tsx}",
      "apps/web/sw/**/*.ts",
      "packages/*/src/**/*.ts",
    ],
    ignores: ["**/*.test.{ts,tsx}", "**/testing.ts", "**/*.d.ts"],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: { complexity: ["warn", 0] },
  },
);
