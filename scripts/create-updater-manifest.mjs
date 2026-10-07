/* global process */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createUpdaterManifest(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected release version X.Y.Z");
  const assets = fs.readdirSync(directory);
  const platforms = {};
  for (const [platform, suffix] of [
    ["windows-x86_64", "-setup.exe"],
    ["darwin-aarch64", "_darwin-arm64.app.tar.gz"],
    ["darwin-x86_64", "_darwin-x64.app.tar.gz"],
  ]) {
    const matches = assets.filter((name) => name.endsWith(suffix));
    if (matches.length !== 1) throw new Error(`Expected one updater asset for ${platform}, got ${matches.length}`);
    const name = matches[0];
    const signature = fs.readFileSync(path.join(directory, `${name}.sig`), "utf8").trim();
    if (!signature) throw new Error(`Empty updater signature for ${platform}`);
    platforms[platform] = {
      signature,
      url: `https://github.com/cccadet/omni-sql/releases/download/v${version}/${encodeURIComponent(name)}`,
    };
  }
  return { version, pub_date: new Date().toISOString(), platforms };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, version] = process.argv.slice(2);
  fs.writeFileSync(path.join(directory, "latest.json"), `${JSON.stringify(createUpdaterManifest(directory, version), null, 2)}\n`);
}
