import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUpdaterManifest } from "./create-updater-manifest.mjs";

test("publishes distinct signed Windows, Apple Silicon and Intel updates and rejects incomplete releases", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omni-updater-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const names = ["omni-sql_0.7.0_x64-setup.exe", "omni-sql_0.7.0_darwin-arm64.app.tar.gz", "omni-sql_0.7.0_darwin-x64.app.tar.gz"];
  for (const [index, name] of names.entries()) {
    fs.writeFileSync(path.join(directory, name), "installer");
    fs.writeFileSync(path.join(directory, `${name}.sig`), `signature-${index}\n`);
  }
  const manifest = createUpdaterManifest(directory, "0.7.0");
  for (const [index, platform] of ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"].entries()) {
    assert.equal(manifest.platforms[platform].signature, `signature-${index}`);
    assert.equal(manifest.platforms[platform].url, `https://github.com/cccadet/omni-sql/releases/download/v0.7.0/${names[index]}`);
  }
  assert.throws(() => createUpdaterManifest(directory, "../bad"), /Expected release version/);
  fs.writeFileSync(path.join(directory, `${names[1]}.sig`), "\n");
  assert.throws(() => createUpdaterManifest(directory, "0.7.0"), /Empty updater signature/);
  fs.rmSync(path.join(directory, `${names[1]}.sig`));
  assert.throws(() => createUpdaterManifest(directory, "0.7.0"), /ENOENT/);
  fs.rmSync(path.join(directory, names[1]));
  assert.throws(() => createUpdaterManifest(directory, "0.7.0"), /Expected one updater asset for darwin-aarch64/);
});
