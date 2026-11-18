// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

// Package boundaries (ADR 0008). Tests and test helpers may build data
// straight in the tables: they check the guarantee, they don't use it.
const testFiles = ["**/*.test.ts", "**/*.test.tsx", "**/testing.ts"];

// What packages/db exports from its schema, read from the files themselves
// so a new table is in the rule without anybody remembering to add it.
const schemaDir = join(import.meta.dirname, "packages/db/src/schema");
const schemaExports = readdirSync(schemaDir)
  .filter((file) => file.endsWith(".ts"))
  .flatMap((file) => [
    ...readFileSync(join(schemaDir, file), "utf8").matchAll(
      /^export const (\w+)/gm,
    ),
  ])
  .map(([, name]) => /** @type {string} */ (name));

const queriesStayInDb =
  "Queries live in packages/db, where each one has its partnership's WHERE (ADR 0008): add a function there.";

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
  {
    // A file above 400 lines of code almost always does more than one
    // thing: split it by what each part changes for. The CI summary lists
    // the largest (eslint.complexity.config.js). Tests are left out: they
    // grow by case, and describe blocks already organize them.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts"],
    ignores: testFiles,
    rules: {
      "max-lines": [
        "error",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // No import cycles anywhere: a cycle hides who depends on whom.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      // Without these the plugin treats .ts files as unknown and follows
      // none of their imports: no cycle would ever be found.
      "import-x/extensions": [".ts", ".tsx", ".js"],
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          project: ["apps/*/tsconfig.json", "packages/*/tsconfig.json"],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: { "import-x/no-cycle": ["error", { ignoreExternal: true }] },
  },
  {
    files: ["packages/domain/src/**/*.ts"],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.)",
              message:
                "The domain is pure (ADR 0008): no database, network, clock or framework.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/contracts/src/**/*.ts"],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.|zod$)",
              message:
                "Contracts run in the browser and on the server (ADR 0008): only zod.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(@partneroj/db|drizzle-orm|pg|pg-boss)(/|$)",
              message:
                "The web app talks to the API through @partneroj/contracts, never to the database (ADR 0008).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/api/src/**/*.ts", "apps/worker/src/**/*.ts"],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@partneroj/db",
              importNames: schemaExports,
              message: queriesStayInDb,
            },
          ],
          patterns: [
            { regex: "^(drizzle-orm|pg)(/|$)", message: queriesStayInDb },
          ],
        },
      ],
    },
  },
  {
    // One copy of each small helper: copies drift apart. Each lives in the
    // module the message names, and only there.
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    ignores: ["apps/api/src/validation/uuid.ts", "packages/db/src/testing.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "VariableDeclarator[id.name='UUID']",
          message:
            "Check an id with isUuid from apps/api/src/validation/uuid.ts.",
        },
        {
          selector: "FunctionDeclaration[id.name='waitForALockWait']",
          message:
            "Use waitForALockWait from packages/db/src/testing.ts (@partneroj/db/testing).",
        },
      ],
    },
  },
  prettier,
);
