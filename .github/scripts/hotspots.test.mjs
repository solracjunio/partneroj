// Run with: node --test .github/scripts/
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hotspotRows,
  isProductionFile,
  measures,
  parseLog,
  renderHotspots,
} from "./hotspots.mjs";

const log = [
  "@@refactor(web): split the expense form (#80)",
  "",
  "apps/web/src/ExpenseForm.tsx",
  "apps/web/src/ExpenseForm.test.tsx",
  "apps/web/src/ExpenseReceipt.tsx",
  "@@feat(web): attach the receipt photo to a pocket expense (#44)",
  "",
  "apps/web/src/ExpenseForm.tsx",
  "packages/db/src/index.ts",
  "@@docs: log the hours (#77)",
  "",
  "docs/horas.md",
  "@@feat(db): add receipts (#20)",
  "",
  "packages/db/src/schema.ts",
  "apps/web/src/Gone.tsx",
].join("\n");

describe("parseLog", () => {
  it("gives each commit's subject, without the PR number, and its files", () => {
    assert.deepEqual(parseLog(log)[1], {
      subject: "feat(web): attach the receipt photo to a pocket expense",
      files: ["apps/web/src/ExpenseForm.tsx", "packages/db/src/index.ts"],
    });
    assert.equal(parseLog(log).length, 4);
  });

  it("keeps a commit that touched no file", () => {
    assert.deepEqual(parseLog("@@chore: empty (#1)\n"), [
      { subject: "chore: empty", files: [] },
    ]);
  });
});

describe("isProductionFile", () => {
  it("takes the apps' and packages' source", () => {
    assert.ok(isProductionFile("apps/web/src/ExpenseForm.tsx"));
    assert.ok(isProductionFile("packages/db/src/schema.ts"));
  });

  it("leaves out tests, test helpers, declarations and re-export files", () => {
    // index.ts changes with every new export: a line, not a reason.
    for (const file of [
      "apps/web/src/ExpenseForm.test.tsx",
      "packages/db/src/testing.ts",
      "packages/contracts/src/url.d.ts",
      "packages/db/src/index.ts",
      "docs/horas.md",
    ]) {
      assert.equal(isProductionFile(file), false, file);
    }
  });
});

describe("hotspotRows", () => {
  const sizes = new Map([
    ["apps/web/src/ExpenseForm.tsx", 262],
    ["apps/web/src/ExpenseReceipt.tsx", 90],
    ["packages/db/src/schema.ts", 311],
  ]);
  const complexity = new Map([["apps/web/src/ExpenseForm.tsx", 12]]);
  const rows = hotspotRows(parseLog(log), sizes, complexity);

  it("scores each file by its commits times its lines of code, highest first", () => {
    assert.deepEqual(
      rows.map((r) => [r.file, r.commits, r.lines, r.score]),
      [
        ["apps/web/src/ExpenseForm.tsx", 2, 262, 524],
        ["packages/db/src/schema.ts", 1, 311, 311],
        ["apps/web/src/ExpenseReceipt.tsx", 1, 90, 90],
      ],
    );
  });

  it("keeps the subjects, newest first: the reasons it changed", () => {
    assert.deepEqual(rows[0].subjects, [
      "refactor(web): split the expense form",
      "feat(web): attach the receipt photo to a pocket expense",
    ]);
  });

  it("gives the most complex function's number, or null without one", () => {
    assert.equal(rows[0].maxComplexity, 12);
    assert.equal(rows[1].maxComplexity, null);
  });

  it("leaves out files that no longer exist", () => {
    // Gone.tsx has no size: it was deleted or renamed since.
    assert.ok(rows.every((r) => r.file !== "apps/web/src/Gone.tsx"));
  });
});

describe("renderHotspots", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    file: `apps/web/src/f${i}.ts`,
    commits: 12 - i,
    lines: 100,
    maxComplexity: i === 0 ? 9 : null,
    score: (12 - i) * 100,
    subjects: [`feat: change ${i}`],
  }));

  it("lists the top ten in a table", () => {
    const text = renderHotspots(rows);
    assert.match(
      text,
      /\| `apps\/web\/src\/f0\.ts` \| 12 \| 100 \| 9 \| 1200 \|/,
    );
    assert.match(
      text,
      /\| `apps\/web\/src\/f9\.ts` \| 3 \| 100 \| — \| 300 \|/,
    );
    assert.doesNotMatch(text, /f10\.ts/);
  });

  it("then why each of the top five changed", () => {
    const text = renderHotspots(rows);
    assert.match(text, /#### `apps\/web\/src\/f0\.ts`\n\n- feat: change 0/);
    assert.match(text, /#### `apps\/web\/src\/f4\.ts`/);
    assert.doesNotMatch(text, /#### `apps\/web\/src\/f5\.ts`/);
  });
});

describe("measures", () => {
  it("reads each file's lines and its most complex function from ESLint's report", () => {
    const report = [
      {
        filePath: "/repo/apps/web/src/a.tsx",
        messages: [
          {
            ruleId: "max-lines",
            message: "File has too many lines (120). Maximum allowed is 0.",
          },
          {
            ruleId: "complexity",
            message:
              "Function 'a' has a complexity of 4. Maximum allowed is 0.",
          },
          {
            ruleId: "complexity",
            message:
              "Arrow function has a complexity of 9. Maximum allowed is 0.",
          },
        ],
      },
    ];
    const { sizes, complexity } = measures(report, "/repo");
    assert.deepEqual([...sizes], [["apps/web/src/a.tsx", 120]]);
    assert.deepEqual([...complexity], [["apps/web/src/a.tsx", 9]]);
  });
});
