import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const reports = [
  ["apps/desktop", "coverage/lcov.info"],
  ["packages/adapters-core", "coverage/lcov.info"],
  ["packages/adapters-pg", "coverage/lcov.info"],
  ["packages/adapters-mysql", "coverage/lcov.info"],
  ["packages/adapters-mssql", "coverage/lcov.info"],
  ["packages/adapters-oracle", "coverage/lcov.info"],
  ["packages/adapters-jdbc", "coverage/lcov.info"],
  ["packages/adapters-odbc", "coverage/lcov.info"],
  ["packages/autocomplete-engine", "coverage/lcov.info"],
  ["packages/dialect-descriptors", "coverage/lcov.info"],
  ["packages/metadata-cache", "coverage/lcov.info"],
  ["packages/backend", "coverage/lcov.info"],
  ["packages/mcp-server", "coverage/lcov.info"],
  ["packages/ts-types", "coverage/lcov.info"],
];

function resolveSourcePath(directory, sourceFile, reportPath) {
  const workspace = resolve(root, directory);
  const candidates = isAbsolute(sourceFile)
    ? [resolve(sourceFile)]
    : [resolve(workspace, sourceFile), resolve(root, sourceFile)];
  const sourcePath = candidates.find(existsSync);
  if (!sourcePath) {
    throw new Error(`Coverage source does not exist: ${sourceFile} in ${relative(root, reportPath)}`);
  }
  const sourceRelative = relative(root, sourcePath);
  if (sourceRelative === "" || sourceRelative === ".." || sourceRelative.startsWith(`..${sep}`) || isAbsolute(sourceRelative)) {
    throw new Error(`Coverage source is outside the repository: ${sourceFile} in ${relative(root, reportPath)}`);
  }
  return sourceRelative;
}

function normalizeLcovPaths(directory, report) {
  const reportPath = resolve(root, directory, report);
  if (!existsSync(reportPath)) throw new Error(`Coverage report was not created: ${relative(root, reportPath)}`);

  let recordCount = 0;
  let covered = 0;
  let total = 0;
  const normalized = readFileSync(reportPath, "utf8").replace(/^SF:(.+)$/gm, (_, sourceFile) => {
    recordCount += 1;
    return `SF:${resolveSourcePath(directory, sourceFile, reportPath)}`;
  });
  if (recordCount === 0) throw new Error(`Coverage report has no source records: ${relative(root, reportPath)}`);
  for (const [, hits] of normalized.matchAll(/^LH:(\d+)$/gm)) covered += Number(hits);
  for (const [, lines] of normalized.matchAll(/^LF:(\d+)$/gm)) total += Number(lines);
  if (total === 0 || covered > total) throw new Error(`Invalid coverage counts: ${relative(root, reportPath)}`);
  writeFileSync(reportPath, normalized);
  console.log(`${directory}: ${covered}/${total} lines (${(100 * covered / total).toFixed(1)}%)`);
  return { covered, total };
}

const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run coverage with pnpm test:coverage");
for (const [directory, report] of reports) {
  const path = resolve(root, directory, report);
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
}
for (const [directory] of reports) {
  if (directory === "apps/desktop") continue;
  execFileSync(process.execPath, [pnpm, "--dir", directory, "coverage"], { cwd: root, stdio: "inherit" });
}
execFileSync(process.execPath, [pnpm, "--filter", "desktop", "test:coverage"], { cwd: root, stdio: "inherit" });
const counts = reports.map(([directory, report]) => normalizeLcovPaths(directory, report));
const covered = counts.reduce((sum, count) => sum + count.covered, 0);
const total = counts.reduce((sum, count) => sum + count.total, 0);
const percentage = 100 * covered / total;
console.log(`Total TypeScript: ${covered}/${total} lines (${percentage.toFixed(1)}%)`);
if (percentage < 80) throw new Error(`Line coverage ${percentage.toFixed(1)}% is below 80%`);
