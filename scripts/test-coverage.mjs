import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const reports = [
  ["apps/desktop", "coverage/lcov.info"],
  ["packages/adapters-pg", "coverage/lcov.info"],
  ["packages/adapters-mysql", "coverage/lcov.info"],
  ["packages/adapters-mssql", "coverage/lcov.info"],
  ["packages/adapters-oracle", "coverage/lcov.info"],
  ["packages/adapters-jdbc", "coverage/lcov.info"],
  ["packages/autocomplete-engine", "coverage/lcov.info"],
  ["packages/dialect-descriptors", "coverage/lcov.info"],
  ["packages/metadata-cache", "coverage/lcov.info"],
  ["packages/backend", "coverage/lcov.info"],
  ["packages/mcp-server", "coverage/lcov.info"],
];

function normalizeLcovPaths(directory, report) {
  const reportPath = resolve(root, directory, report);
  if (!existsSync(reportPath)) throw new Error(`Coverage report was not created: ${relative(root, reportPath)}`);

  const normalized = readFileSync(reportPath, "utf8").replace(/^SF:(.+)$/gm, (_, sourceFile) => {
    const resolved = resolve(root, directory, sourceFile);
    return `SF:${relative(root, resolved)}`;
  });
  writeFileSync(reportPath, normalized);
}

execFileSync("pnpm", ["--filter", "desktop", "test:coverage"], { cwd: root, stdio: "inherit" });
for (const [directory] of reports) {
  if (directory === "apps/desktop") continue;
  execFileSync("pnpm", ["--dir", directory, "coverage"], { cwd: root, stdio: "inherit" });
}
for (const [directory, report] of reports) normalizeLcovPaths(directory, report);
