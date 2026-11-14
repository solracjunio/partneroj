// Run with: node --test .github/scripts/
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  coverageSection,
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

describe("render", () => {
  it("puts both in one summary, with the legend", () => {
    const text = render({ coverage, mutation: { files: {} } });
    assert.match(text, /^## Coverage and mutation/);
    assert.match(text, /### Coverage \(all packages\)\n\n\| Measure \|/);
    assert.match(text, /### Mutation \(packages\/domain\)\n\n\| Mutants \|/);
    assert.match(text, /🟢 90% or more · 🟡 80% to 90% · 🔴 below 80%/);
  });

  it("says which data is missing instead of failing", () => {
    // A failed test step leaves no coverage report; the summary still runs.
    const text = render({ coverage: null, mutation: null });
    assert.match(text, /_No coverage report: the tests did not finish\._/);
    assert.match(
      text,
      /_No mutation report: the mutation run did not finish\._/,
    );
  });
});
