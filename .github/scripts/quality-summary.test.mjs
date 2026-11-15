// Run with: node --test .github/scripts/
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  complexityLight,
  complexityRows,
  complexitySection,
  coverageSection,
  fileSizeLight,
  fileSizeRows,
  fileSizeSection,
  light,
  mutationSection,
  percent,
  render,
} from "./quality-summary.mjs";

const lines = (covered, total) => ({
  lines: { total, covered, pct: (100 * covered) / total },
});

const coverage = {
  total: {
    lines: { total: 200, covered: 184, pct: 92 },
    functions: { total: 50, covered: 44, pct: 88 },
    branches: { total: 100, covered: 79, pct: 79 },
  },
  "/repo/packages/domain/src/split.ts": lines(40, 40),
  "/repo/packages/domain/src/balances.ts": lines(60, 60),
  "/repo/apps/web/src/push.ts": lines(84, 100),
};

const mutant = (status, line = 1, mutatorName = "EqualityOperator") => ({
  status,
  mutatorName,
  location: { start: { line, column: 1 } },
});

describe("percent and light", () => {
  it("shows one decimal", () => {
    assert.equal(percent(92), "92.0%");
    assert.equal(percent(100), "100.0%");
  });

  it("is green from 90 %, yellow from 80 %, red below", () => {
    assert.equal(light(90), "🟢");
    assert.equal(light(100), "🟢");
    assert.equal(light(89.9), "🟡");
    assert.equal(light(80), "🟡");
    assert.equal(light(79.9), "🔴");
  });

  it("takes the color of the value shown, never one that contradicts it", () => {
    // 89.96 shows as "90.0%": yellow beside it would read as a mistake.
    assert.equal(percent(89.96), "90.0%");
    assert.equal(light(89.96), "🟢");
  });
});

describe("coverageSection", () => {
  it("gives the totals with their lights", () => {
    const text = coverageSection(coverage);
    assert.match(text, /^\| Lines \| 92\.0% \| 🟢 \|$/m);
    assert.match(text, /^\| Functions \| 88\.0% \| 🟡 \|$/m);
    assert.match(text, /^\| Branches \| 79\.0% \| 🔴 \|$/m);
  });

  it("gives each package's lines, from the per-file entries, lowest first", () => {
    const text = coverageSection(coverage);
    assert.match(text, /^\| web \| 84\.0% \| 🟡 \| 84 of 100 \|$/m);
    assert.match(text, /^\| domain \| 100\.0% \| 🟢 \| 100 of 100 \|$/m);
    assert.ok(text.indexOf("| web |") < text.indexOf("| domain |"));
  });

  it("aligns the numbers to the right", () => {
    assert.match(coverageSection(coverage), /^\|---\|--:\|:-:\|$/m);
  });
});

describe("mutationSection", () => {
  it("gives the score of detected mutants", () => {
    const report = {
      files: {
        "src/split.ts": {
          mutants: [
            mutant("Killed"),
            mutant("Killed"),
            mutant("Timeout"),
            mutant("Ignored"),
          ],
        },
      },
    };
    const text = mutationSection(report);
    assert.match(text, /^\| Killed \| 100\.0% \| 🟢 \| 3 of 3 \|$/m);
    assert.doesNotMatch(text, /Survivors/);
  });

  it("counts survivors and no-coverage as undetected, and names them", () => {
    const report = {
      files: {
        "src/split.ts": {
          mutants: [
            mutant("Killed"),
            mutant("Killed"),
            mutant("Killed"),
            mutant("Survived", 42, "ConditionalExpression"),
          ],
        },
        "src/balances.ts": { mutants: [mutant("NoCoverage", 7)] },
      },
    };
    const text = mutationSection(report);
    assert.match(text, /^\| Killed \| 60\.0% \| 🔴 \| 3 of 5 \|$/m);
    assert.match(
      text,
      /^\| `src\/split\.ts` \| 42 \| ConditionalExpression \| Survived \|$/m,
    );
    assert.match(
      text,
      /^\| `src\/balances\.ts` \| 7 \| EqualityOperator \| NoCoverage \|$/m,
    );
  });

  it("leaves compile and runtime errors out of the score", () => {
    const report = {
      files: {
        "src/a.ts": {
          mutants: [
            mutant("Killed"),
            mutant("CompileError"),
            mutant("RuntimeError"),
          ],
        },
      },
    };
    assert.match(mutationSection(report), /\| 100\.0% \| 🟢 \| 1 of 1 \|/);
  });
});

/** ESLint's JSON report: one entry per file, a message per function. */
const fn = (name, complexity, line = 1) => ({
  ruleId: "complexity",
  line,
  message: `${name} has a complexity of ${complexity}. Maximum allowed is 0.`,
});
const eslintReport = [
  {
    filePath: "/repo/packages/db/src/admin-commands.ts",
    messages: [
      fn("Async function 'runAdminCommand'", 24, 38),
      fn("Function 'help'", 1, 90),
    ],
  },
  {
    filePath: "/repo/apps/web/src/FeedPage.tsx",
    messages: [fn("Function 'FeedPage'", 12, 22), fn("Arrow function", 3, 40)],
  },
  { filePath: "/repo/apps/web/src/money.ts", messages: [] },
];

describe("complexityRows", () => {
  it("gives each function's name, place and complexity, the paths from the root", () => {
    assert.deepEqual(complexityRows(eslintReport, "/repo"), [
      {
        name: "runAdminCommand",
        file: "packages/db/src/admin-commands.ts",
        line: 38,
        complexity: 24,
      },
      {
        name: "help",
        file: "packages/db/src/admin-commands.ts",
        line: 90,
        complexity: 1,
      },
      {
        name: "FeedPage",
        file: "apps/web/src/FeedPage.tsx",
        line: 22,
        complexity: 12,
      },
      {
        name: "Arrow function",
        file: "apps/web/src/FeedPage.tsx",
        line: 40,
        complexity: 3,
      },
    ]);
  });

  it("keeps only the complexity rule's messages", () => {
    const other = [
      {
        filePath: "/repo/apps/web/src/a.ts",
        messages: [{ ruleId: "no-unused-vars", line: 1, message: "x" }],
      },
    ];
    assert.deepEqual(complexityRows(other, "/repo"), []);
  });
});

describe("complexityLight", () => {
  it("is green up to 10, yellow up to 15, red above", () => {
    assert.equal(complexityLight(10), "🟢");
    assert.equal(complexityLight(11), "🟡");
    assert.equal(complexityLight(15), "🟡");
    assert.equal(complexityLight(16), "🔴");
  });
});

describe("complexitySection", () => {
  const rows = complexityRows(eslintReport, "/repo");

  it("counts the functions in each range", () => {
    const text = complexitySection(rows);
    assert.match(text, /^\| 1–10 \| 2 \| 🟢 \|$/m);
    assert.match(text, /^\| 11–15 \| 1 \| 🟡 \|$/m);
    assert.match(text, /^\| 16\+ \| 1 \| 🔴 \|$/m);
  });

  it("lists the most complex first, with where they are", () => {
    const text = complexitySection(rows);
    assert.match(
      text,
      /^\| runAdminCommand \| `packages\/db\/src\/admin-commands\.ts:38` \| 24 \| 🔴 \|$/m,
    );
    assert.ok(text.indexOf("runAdminCommand") < text.indexOf("| FeedPage |"));
  });

  it("lists at most five", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      name: `f${i}`,
      file: "a.ts",
      line: i + 1,
      complexity: 20 - i,
    }));
    const text = complexitySection(many);
    assert.match(text, /\| f4 \|/);
    assert.doesNotMatch(text, /\| f5 \|/);
  });
});

const size = (file, lines) => ({
  filePath: `/repo/${file}`,
  messages: [
    {
      ruleId: "max-lines",
      line: 1,
      message: `File has too many lines (${lines}). Maximum allowed is 0.`,
    },
  ],
});

const sizeReport = [
  size("packages/db/src/schema.ts", 311),
  size("apps/web/src/ExpenseForm.tsx", 262),
  size("apps/web/src/push.ts", 40),
  size("apps/web/src/Huge.tsx", 420),
];

describe("fileSizeRows", () => {
  it("gives each file's lines of code, the path from the root", () => {
    assert.deepEqual(fileSizeRows(sizeReport, "/repo"), [
      { file: "packages/db/src/schema.ts", lines: 311 },
      { file: "apps/web/src/ExpenseForm.tsx", lines: 262 },
      { file: "apps/web/src/push.ts", lines: 40 },
      { file: "apps/web/src/Huge.tsx", lines: 420 },
    ]);
  });

  it("keeps only the max-lines messages", () => {
    // The same report holds the complexity of each function.
    assert.deepEqual(fileSizeRows(eslintReport, "/repo"), []);
  });
});

describe("fileSizeLight", () => {
  it("is green up to 300, yellow up to the lint's 400, red above", () => {
    assert.equal(fileSizeLight(300), "🟢");
    assert.equal(fileSizeLight(301), "🟡");
    assert.equal(fileSizeLight(400), "🟡");
    assert.equal(fileSizeLight(401), "🔴");
  });
});

describe("fileSizeSection", () => {
  const rows = fileSizeRows(sizeReport, "/repo");

  it("counts the files in each range", () => {
    const text = fileSizeSection(rows);
    assert.match(text, /\| 1–300 \| 2 \| 🟢 \|/);
    assert.match(text, /\| 301–400 \| 1 \| 🟡 \|/);
    assert.match(text, /\| 401\+ \| 1 \| 🔴 \|/);
  });

  it("lists the largest first, at most five", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      file: `apps/web/src/f${i}.ts`,
      lines: 100 + i,
    }));
    const text = fileSizeSection(many);
    assert.equal((text.match(/`apps\/web\/src\/f\d\.ts`/g) ?? []).length, 5);
    assert.ok(text.indexOf("f6.ts") < text.indexOf("f2.ts"));
    assert.doesNotMatch(text, /f1\.ts/);
  });

  it("shows each file with its lines and light", () => {
    const text = fileSizeSection(rows);
    assert.match(text, /\| `apps\/web\/src\/Huge\.tsx` \| 420 \| 🔴 \|/);
    assert.ok(text.indexOf("Huge.tsx") < text.indexOf("schema.ts"));
  });
});

describe("render", () => {
  it("puts both in one summary, with the legend", () => {
    const text = render({
      coverage,
      mutation: { files: {} },
      complexity: null,
    });
    assert.match(text, /^## Coverage and mutation/);
    assert.match(text, /### Coverage \(all packages\)\n\n\| Measure \|/);
    assert.match(text, /### Mutation \(packages\/domain\)\n\n\| Mutants \|/);
    assert.match(text, /🟢 90% or more · 🟡 80% to 90% · 🔴 below 80%/);
  });

  it("says which data is missing instead of failing", () => {
    // A failed test step leaves no coverage report; the summary still runs.
    const text = render({ coverage: null, mutation: null, complexity: null });
    assert.match(text, /_No coverage report: the tests did not finish\._/);
    assert.match(
      text,
      /_No mutation report: the mutation run did not finish\._/,
    );
  });

  it("adds the complexity, with its own legend", () => {
    const text = render({
      coverage,
      mutation: { files: {} },
      complexity: complexityRows(eslintReport, "/repo"),
    });
    assert.match(text, /### Complexity \(per function\)\n\n\| Range \|/);
    assert.match(text, /🟢 up to 10 · 🟡 11 to 15 · 🔴 above 15/);
    assert.ok(text.indexOf("### Mutation") < text.indexOf("### Complexity"));
  });

  it("adds the file sizes after the complexity, with their own legend", () => {
    const text = render({
      coverage,
      mutation: { files: {} },
      complexity: complexityRows(eslintReport, "/repo"),
      size: fileSizeRows(sizeReport, "/repo"),
    });
    assert.match(text, /### Size \(per file\)\n\n\| Range \|/);
    assert.match(text, /🟢 up to 300 · 🟡 301 to 400 · 🔴 above 400/);
    assert.ok(text.indexOf("### Complexity") < text.indexOf("### Size"));
  });

  it("says when the size report is missing", () => {
    const text = render({
      coverage,
      mutation: { files: {} },
      complexity: null,
      size: null,
    });
    assert.match(
      text,
      /_No size report: the complexity step did not finish\._/,
    );
  });

  it("says when the complexity report is missing", () => {
    const text = render({
      coverage,
      mutation: { files: {} },
      complexity: null,
    });
    assert.match(
      text,
      /_No complexity report: the complexity step did not finish\._/,
    );
  });
});
