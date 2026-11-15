// Hotspots: the files that change often AND are large, where mixed
// responsibilities usually hide (Adam Tornhill, "Your Code as a Crime
// Scene"). Each file's score is its commits on main times its lines of
// code; the subjects of those commits say why it changed, and reading
// them tells one reason from several. Run at the end of each block:
//   pnpm hotspots
// It reads `git log` and reports/complexity/eslint.json (pnpm complexity),
// so the lines are counted as the lint's limit counts them. A renamed
// file starts over: git log without --follow sees a new file.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** `git log --format=@@%s --name-only` → [{ subject, files }]. */
export function parseLog(text) {
  const commits = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      const subject = line.slice(2).replace(/ \(#\d+\)$/, "");
      commits.push({ subject, files: [] });
    } else if (line.trim() !== "" && commits.length > 0) {
      commits.at(-1).files.push(line.trim());
    }
  }
  return commits;
}

/**
 * The apps' and packages' source, as the complexity counts it. Re-export
 * files (index.ts) are out: they change with every new export, a line
 * each time, never a reason.
 */
export function isProductionFile(file) {
  return (
    /^(apps|packages)\/[^/]+\/(src|sw)\/.+\.tsx?$/.test(file) &&
    !/\.test\.tsx?$|\/testing\.ts$|\.d\.ts$|\/index\.ts$/.test(file)
  );
}

/**
 * One row per file that still exists (has a size), highest score first.
 * `sizes` and `complexity` map a file to its lines of code and to its
 * most complex function's number.
 */
export function hotspotRows(commits, sizes, complexity) {
  const byFile = new Map();
  for (const { subject, files } of commits) {
    for (const file of files) {
      if (!isProductionFile(file) || !sizes.has(file)) continue;
      const subjects = byFile.get(file) ?? [];
      subjects.push(subject);
      byFile.set(file, subjects);
    }
  }
  return [...byFile]
    .map(([file, subjects]) => {
      const lines = sizes.get(file);
      return {
        file,
        commits: subjects.length,
        lines,
        maxComplexity: complexity.get(file) ?? null,
        score: subjects.length * lines,
        subjects,
      };
    })
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

const TOP = 10;
const READ = 5;

/** The top ten in a table, then the commits of the top five to read. */
export function renderHotspots(rows) {
  const top = rows.slice(0, TOP);
  const table = [
    "| File | Commits | Lines of code | Max complexity | Score |",
    "|---|--:|--:|--:|--:|",
    ...top.map(
      (r) =>
        `| \`${r.file}\` | ${r.commits} | ${r.lines} | ${r.maxComplexity ?? "—"} | ${r.score} |`,
    ),
  ].join("\n");
  const reasons = top
    .slice(0, READ)
    .map(
      (r) =>
        `#### \`${r.file}\`\n\n${r.subjects.map((s) => `- ${s}`).join("\n")}`,
    )
    .join("\n\n");
  return [
    "## Hotspots (commits × lines of code)",
    "",
    table,
    "",
    "### Why the top five changed",
    "",
    "Several different reasons in one file is the sign to split it; many changes for the same reason (a new table in the schema) is not.",
    "",
    reasons,
    "",
  ].join("\n");
}

/** Lines of code and the most complex function, per file, from ESLint's report. */
export function measures(report, root) {
  const sizes = new Map();
  const complexity = new Map();
  for (const { filePath, messages } of report) {
    const file = filePath.startsWith(`${root}/`)
      ? filePath.slice(root.length + 1)
      : filePath;
    for (const m of messages) {
      const lines = /too many lines \((\d+)\)/.exec(m.message);
      if (m.ruleId === "max-lines" && lines !== null) {
        sizes.set(file, Number(lines[1]));
      }
      const found = /has a complexity of (\d+)/.exec(m.message);
      if (m.ruleId === "complexity" && found !== null) {
        const n = Number(found[1]);
        complexity.set(file, Math.max(n, complexity.get(file) ?? 0));
      }
    }
  }
  return { sizes, complexity };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const log = execFileSync(
    "git",
    ["log", "--format=@@%s", "--name-only", "--no-merges", "HEAD"],
    { encoding: "utf8" },
  );
  const report = JSON.parse(
    readFileSync("reports/complexity/eslint.json", "utf8"),
  );
  const { sizes, complexity } = measures(report, process.cwd());
  process.stdout.write(
    renderHotspots(hotspotRows(parseLog(log), sizes, complexity)),
  );
}
