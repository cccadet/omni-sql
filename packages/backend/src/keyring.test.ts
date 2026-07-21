import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-keyring-"));
process.env.OMNI_SQL_DEV_KEYRING_FILE = path.join(tmpDir, "keyring.json");

const { setPassword, getPassword, deletePassword, passwordSlotFor } = await import("./keyring.ts");

test("keyring: roundtrip set/get/delete", async () => {
  const cfg = { id: "keyring-test" };
  assert.equal(passwordSlotFor(cfg), "connection:keyring-test");

  assert.equal(await getPassword(cfg), undefined);
  await setPassword(cfg, "s3cr3t");
  assert.equal(await getPassword(cfg), "s3cr3t");
  await deletePassword(cfg);
  assert.equal(await getPassword(cfg), undefined);
});

test("keyring: fallback creates platform-safe parent directories", async () => {
  const nestedPath = path.join(tmpDir, "nested", "keyring.json");
  process.env.OMNI_SQL_DEV_KEYRING_FILE = nestedPath;
  const cfg = { id: "nested-keyring-test" };

  await setPassword(cfg, "not-logged");
  assert.equal(await getPassword(cfg), "not-logged");
  assert.equal(fs.existsSync(nestedPath), true);
  await deletePassword(cfg);
  process.env.OMNI_SQL_DEV_KEYRING_FILE = path.join(tmpDir, "keyring.json");
});

test("keyring: fallback errors identify backend and slot without password", async () => {
  const brokenPath = path.join(tmpDir, "broken-keyring.json");
  process.env.OMNI_SQL_DEV_KEYRING_FILE = brokenPath;
  fs.writeFileSync(brokenPath, "{ broken", "utf8");

  await assert.rejects(getPassword({ id: "diagnostic-test" }), (error: unknown) => {
    assert.match(String(error), /keyring get failed/);
    assert.match(String(error), /connection:diagnostic-test/);
    assert.match(String(error), /dev fallback at/);
    assert.doesNotMatch(String(error), /not-logged/);
    return true;
  });
  process.env.OMNI_SQL_DEV_KEYRING_FILE = path.join(tmpDir, "keyring.json");
});
