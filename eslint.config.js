// @ts-check
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/coverage/",
      "**/node_modules/",
      ".devbox/",
      // Mutation testing: the report and the sandbox of a stopped run.
      "**/reports/",
      "**/.stryker-tmp/",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // The root has no tsconfig of its own; the coverage config is
          // its only TypeScript file.
          allowDefaultProject: ["vitest.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Cyclomatic complexity (1 + decision points): a function above 15
    // fails the lint. The CI summary lists the most complex ones
    // (eslint.complexity.config.js); a function near the limit is split
    // before it grows past it. The throwaway prototype is left out.
    ignores: ["prototype/**"],
    rules: { complexity: ["error", 15] },
  },
  prettier,
);
