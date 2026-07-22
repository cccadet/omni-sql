import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extract } from "./prepare-resources.mjs";

const script = fileURLToPath(new URL("./prepare-resources.mjs", import.meta.url));

test("converts Tauri Linux platform/arch environment to linux-x64", () => {
  const output = execFileSync(process.execPath, [script, "--print-target"], {
    env: { ...process.env, TAURI_ENV_PLATFORM: "linux", TAURI_ENV_ARCH: "x86_64" },
    encoding: "utf8",
  });
  assert.equal(output.trim(), "linux-x64");
});

test("rejects a Tauri target that differs from the host", () => {
  assert.throws(
    () => execFileSync(process.execPath, [script, "--print-target"], {
      env: { ...process.env, TAURI_ENV_PLATFORM: "windows", TAURI_ENV_ARCH: "x64" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
    (error) => error.stderr.toString().includes("does not match host target"),
  );
});

test("extracts Windows ZIPs with PowerShell paths instead of tar.exe", () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "omni-sql-extract-"));
  const archive = "D:\\runner\\downloads\\node.zip";
  let command;
  extract(archive, destination, "win32", (file, args) => { command = { file, args }; });
  assert.equal(command.file, "powershell.exe");
  assert.equal(command.args[0], "-NoLogo");
  assert.match(command.args[4], /Expand-Archive/);
  assert.match(command.args[4], /-LiteralPath 'D:\\runner\\downloads\\node\.zip'/);
  assert.match(command.args[4], new RegExp(`-DestinationPath '${destination.replaceAll("\\", "\\\\")}'`));
  assert.equal(command.args.length, 5);
  assert.equal(command.args[4].includes("$args"), false);
  assert.equal(command.args.includes("tar.exe"), false);
  fs.rmSync(destination, { recursive: true, force: true });
});

test("escapes Windows paths when invoking PowerShell", () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "omni-sql-extract-"));
  const archive = "D:\\runner\\O'Reilly\\node.zip";
  let command;
  extract(archive, destination, "win32", (file, args) => { command = { file, args }; });
  assert.equal(command.file, "powershell.exe");
  assert.match(command.args[4], /-LiteralPath 'D:\\runner\\O''Reilly\\node\.zip'/);
  fs.rmSync(destination, { recursive: true, force: true });
});
