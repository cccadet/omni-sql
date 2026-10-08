import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import process from "node:process";

export function checkIntegrationTap(tap, allowedSkips = 0) {
  const summary = Object.fromEntries([...tap.matchAll(/^# (tests|pass|fail|skipped|todo|cancelled) (\d+)\s*$/gm)].map((match) => [match[1], Number(match[2])]));
  if (!summary.tests || !summary.pass || summary.fail !== 0 || summary.skipped !== allowedSkips
      || summary.tests !== summary.pass + summary.skipped || (summary.todo ?? 0) !== 0 || (summary.cancelled ?? 0) !== 0) {
    throw new Error(`Required integration did not pass or had unexpected skips: ${JSON.stringify(summary)}; allowed skips=${allowedSkips}`);
  }
}

export function checkMongoSqlLog(log) {
  if (!/^test .*::mongo_sql_real_database_readonly_catalog \.\.\. ok\s*$/m.test(log)
      || !/^test result: ok\. [1-9]\d* passed; 0 failed; 0 ignored;/m.test(log)) {
    throw new Error("Required Mongo SQL integration test did not run and pass");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = readFileSync(process.argv[2], "utf8");
  if (process.argv[3] === "--mongo-sql") checkMongoSqlLog(report);
  else checkIntegrationTap(report, Number(process.argv[3] ?? 0));
}
