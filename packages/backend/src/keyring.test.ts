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
