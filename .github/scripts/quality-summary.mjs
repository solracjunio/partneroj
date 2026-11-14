// The coverage and mutation summary of a CI run, as markdown tables with
// a traffic light per value, written to the run's Job Summary. Reads the
// reports the run already made, so it costs no extra test run:
//   coverage/coverage-summary.json                 (pnpm coverage)
//   packages/domain/reports/mutation/mutation.json (pnpm --filter @partneroj/domain mutation)
//   reports/complexity/eslint.json                 (pnpm complexity)
// Usage: node .github/scripts/quality-summary.mjs >> "$GITHUB_STEP_SUMMARY"
// Locally, `pnpm quality` runs them all and prints the same tables.
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** One decimal: "92.0%". */
export function percent(pct) {
  return `${pct.toFixed(1)}%`;
}

/**
 * 🟢 from 90 %, 🟡 from 80 %, 🔴 below. Decided on the value as shown,
 * so 89.96 % ("90.0%") is green and the light never contradicts the
 * number beside it.
 */
export function light(pct) {
  const shown = Number(pct.toFixed(1));
  if (shown >= 90) return "🟢";
  if (shown >= 80) return "🟡";
  return "🔴";
}

const LEGEND = "🟢 90% or more · 🟡 80% to 90% · 🔴 below 80%";

/** A markdown table; numbers are right-aligned, lights centered. */
function table(header, align, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `|${align.join("|")}|`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

/** apps/web/src/push.ts → "web"; null for anything outside a package. */
function packageOf(file) {
  return /\/(?:apps|packages)\/([^/]+)\/src\//.exec(file)?.[1] ?? null;
}

/** The totals, then each package's lines, from the lowest up. */
export function coverageSection(summary) {
  const { total } = summary;
  const totals = table(
    ["Measure", "Value", ""],
    ["---", "--:", ":-:"],
    [
      ["Lines", total.lines.pct],
      ["Functions", total.functions.pct],
      ["Branches", total.branches.pct],
    ].map(([name, pct]) => [name, percent(pct), light(pct)]),
  );

  const byPackage = new Map();
  for (const [file, entry] of Object.entries(summary)) {
    const name = packageOf(file);
    if (name === null) continue;
    const sum = byPackage.get(name) ?? { covered: 0, total: 0 };
    sum.covered += entry.lines.covered;
    sum.total += entry.lines.total;
    byPackage.set(name, sum);
  }
  const packages = [...byPackage]
    .map(([name, s]) => ({
      name,
      ...s,
      pct: s.total === 0 ? 100 : (100 * s.covered) / s.total,
    }))
    .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));

  const perPackage = table(
    ["Package", "Lines", "", "Covered"],
    ["---", "--:", ":-:", "--:"],
    packages.map((p) => [
      p.name,
      percent(p.pct),
      light(p.pct),
      `${p.covered} of ${p.total}`,
    ]),
  );
  return `${totals}\n\n${perPackage}`;
}

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/**
 * Stryker's score: detected (killed, timed out) over detected plus
 * undetected (survived, no test reached it). Ignored mutants and those
 * that did not compile or run are out, as in Stryker's own report.
 */
function mutationScore(report) {
  let detected = 0;
  const undetected = [];
  for (const [file, { mutants }] of Object.entries(report.files)) {
    for (const m of mutants) {
      if (DETECTED.has(m.status)) detected += 1;
      if (UNDETECTED.has(m.status)) undetected.push({ file, ...m });
    }
  }
  const counted = detected + undetected.length;
  const pct = counted === 0 ? 100 : (100 * detected) / counted;
  return { detected, counted, pct, undetected };
}

/** The score, then each undetected mutant, so a failed run says where to look. */
export function mutationSection(report) {
  const { detected, counted, pct, undetected } = mutationScore(report);
  const score = table(
    ["Mutants", "Score", "", "Detected"],
    ["---", "--:", ":-:", "--:"],
    [["Killed", percent(pct), light(pct), `${detected} of ${counted}`]],
  );
  if (undetected.length === 0) return score;
  const survivors = table(
    ["File", "Line", "Mutator", "Status"],
    ["---", "--:", "---", "---"],
    undetected.map((m) => [
      `\`${m.file}\``,
      String(m.location.start.line),
      m.mutatorName,
      m.status,
    ]),
  );
  return `${score}\n\n**Survivors**\n\n${survivors}`;
}

/**
 * Each function's cyclomatic complexity (1 + its decision points), from
 * ESLint's JSON report of the `complexity` rule with max 0, which reports
 * every function. The name is the one quoted in the message ("Async
 * function 'x'"), or the kind when it has none ("Arrow function").
 */
export function complexityRows(report, root) {
  const rows = [];
  for (const { filePath, messages } of report) {
    const file = filePath.startsWith(`${root}/`)
      ? filePath.slice(root.length + 1)
      : filePath;
    for (const m of messages) {
      if (m.ruleId !== "complexity") continue;
      const found = /^(.*?) has a complexity of (\d+)/.exec(m.message);
      if (found === null) continue;
      const kind = found[1];
      const name = /'(.+)'/.exec(kind)?.[1] ?? kind;
      rows.push({ name, file, line: m.line, complexity: Number(found[2]) });
    }
  }
  return rows;
}

/** 🟢 up to 10, 🟡 up to 15, 🔴 above: the usual reading of McCabe's. */
export function complexityLight(n) {
  if (n <= 10) return "🟢";
  if (n <= 15) return "🟡";
  return "🔴";
}

const COMPLEXITY_LEGEND = "🟢 up to 10 · 🟡 11 to 15 · 🔴 above 15";
const TOP = 5;

/** How many functions in each range, then the TOP most complex. */
export function complexitySection(rows) {
  const ranges = table(
    ["Range", "Functions", ""],
    ["---", "--:", ":-:"],
    [
      ["1–10", rows.filter((r) => r.complexity <= 10).length, "🟢"],
      [
        "11–15",
        rows.filter((r) => r.complexity > 10 && r.complexity <= 15).length,
        "🟡",
      ],
      ["16+", rows.filter((r) => r.complexity > 15).length, "🔴"],
    ],
  );
  const top = [...rows]
    .sort(
      (a, b) =>
        b.complexity - a.complexity ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    )
    .slice(0, TOP);
  const mostComplex = table(
    ["Function", "Where", "Complexity", ""],
    ["---", "---", "--:", ":-:"],
    top.map((r) => [
      r.name,
      `\`${r.file}:${r.line}\``,
      String(r.complexity),
      complexityLight(r.complexity),
    ]),
  );
  return `${ranges}\n\n${mostComplex}`;
}

export function render({ coverage, mutation, complexity }) {
  return [
    "## Coverage and mutation",
    "",
    "### Coverage (all packages)",
    "",
    coverage === null
      ? "_No coverage report: the tests did not finish._"
      : coverageSection(coverage),
    "",
    "### Mutation (packages/domain)",
    "",
    mutation === null
      ? "_No mutation report: the mutation run did not finish._"
      : mutationSection(mutation),
    "",
    LEGEND,
    "",
    "### Complexity (per function)",
    "",
    complexity === null
      ? "_No complexity report: the complexity step did not finish._"
      : complexitySection(complexity),
    "",
    COMPLEXITY_LEGEND,
    "",
  ].join("\n");
}

/** The functions' complexity, or null without the report. */
function complexityOf(report) {
  return report === null ? null : complexityRows(report, process.cwd());
}

/** The report's JSON, or null when the step that writes it did not finish. */
function readReport(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(
    render({
      coverage: readReport("coverage/coverage-summary.json"),
      mutation: readReport("packages/domain/reports/mutation/mutation.json"),
      complexity: complexityOf(readReport("reports/complexity/eslint.json")),
    }),
  );
}
