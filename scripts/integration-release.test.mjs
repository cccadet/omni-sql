import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import process from "node:process";
import { checkIntegrationTap, checkMongoSqlLog } from "./check-integration-tap.mjs";

test("Mongo SQL gate rejects cargo succeeding with zero or unrelated tests", () => {
  assert.throws(() => checkMongoSqlLog("running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;"), /did not run/);
  assert.throws(() => checkMongoSqlLog("test unrelated ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;"), /did not run/);
  const namedTest = "test data_engine::mongo_tests::mongo_sql_real_database_readonly_catalog ... ok\n";
  assert.throws(() => checkMongoSqlLog(`${namedTest}test result: FAILED. 0 passed; 1 failed; 0 ignored;`), /did not run/);
  checkMongoSqlLog(`${namedTest}test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 70 filtered out;`);
});

test("integration evidence rejects empty, failing and silently skipped suites", () => {
  assert.throws(() => checkIntegrationTap(""), /did not pass/);
  assert.throws(() => checkIntegrationTap("# tests 1\n# pass 0\n# fail 1\n# skipped 0\n"), /did not pass/);
  assert.throws(() => checkIntegrationTap("# tests 1\n# pass 0\n# fail 0\n# skipped 1\n"), /unexpected skips/);
  const valid = "# tests 20\n# pass 14\n# fail 0\n# skipped 6\n";
  assert.throws(() => checkIntegrationTap(valid), /unexpected skips/);
  checkIntegrationTap(valid, 6);
  assert.throws(() => checkIntegrationTap(valid.replace("skipped 6", "skipped 7"), 6), /unexpected skips/);
  assert.throws(() => checkIntegrationTap(valid.replace("pass 14", "pass 1"), 6), /did not pass/);
  assert.throws(() => checkIntegrationTap(`${valid}# todo 1\n`, 6), /did not pass/);
  assert.throws(() => checkIntegrationTap(`${valid}# cancelled 1\n`, 6), /did not pass/);
  checkIntegrationTap("# tests 1\n# pass 1\n# fail 0\n# skipped 0\n");
});

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
test("integration gate preserves setup failure and evidence despite cleanup errors", { skip: process.platform === "win32" && !existsSync(bash) }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "omni-integration-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const name of ["node", "pnpm", "java", "cargo"]) {
    writeFileSync(join(bin, name), "#!/bin/sh\necho fixture-version\n", { mode: 0o755 });
  }
  writeFileSync(join(bin, "docker"), "#!/bin/sh\necho fixture-docker-failure\nexit 23\n", { mode: 0o755 });
  const evidence = join(dir, "evidence");
  mkdirSync(evidence);
  writeFileSync(join(evidence, "smoke.tap"), "stale previous success");
  const result = spawnSync(bash, [resolve("scripts/integration-release.sh")], {
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, OMNI_SQL_INTEGRATION_ARTIFACT_DIR: evidence },
    encoding: "utf8", timeout: 60_000,
  });
  assert.equal(result.status, 23, result.stderr);
  assert.equal(existsSync(join(evidence, "smoke.tap")), false);
  const metadata = readFileSync(join(evidence, "run.txt"), "utf8");
  assert.match(metadata, /commit=[a-f0-9]{40}/);
  assert.match(metadata, /command=bash scripts\/integration-release.sh/);
  assert.match(metadata, /exit_status=23/);
  assert.match(metadata, /finished_utc=/);
  assert.match(readFileSync(join(evidence, "integration.log"), "utf8"), /fixture-docker-failure/);
  assert.match(readFileSync(join(evidence, "database.log"), "utf8"), /fixture-docker-failure/);
});
