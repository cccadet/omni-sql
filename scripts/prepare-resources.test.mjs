import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extract, pnpmCommand, pnpmInvocation, runPnpm, stageNode } from "./prepare-resources.mjs";

const script = fileURLToPath(new URL("./prepare-resources.mjs", import.meta.url));

test("selects the Windows pnpm launcher", () => {
  assert.equal(pnpmCommand("win32"), "pnpm.cmd");
  assert.equal(pnpmCommand("linux"), "pnpm");
  assert.equal(pnpmCommand("darwin"), "pnpm");
});

test("builds a Windows pnpm invocation through ComSpec and preserves arguments", () => {
  assert.deepEqual(
    pnpmInvocation(["--filter", "@omni-sql/backend", "build"], "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm.cmd", "--filter", "@omni-sql/backend", "build"],
    },
  );
});

test("executes the constructed Windows pnpm invocation", () => {
  let invocation;
  runPnpm(["--filter", "@omni-sql/backend", "build"], { cwd: "/repo" }, "win32", (command, args, options) => {
    invocation = { command, args, options };
  }, { ComSpec: "cmd.exe" });
  assert.deepEqual(invocation, {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "pnpm.cmd", "--filter", "@omni-sql/backend", "build"],
    options: { cwd: "/repo" },
  });
});

test("preserves the direct pnpm execution on Unix", () => {
  let invocation;
  runPnpm(["--filter", "@omni-sql/backend", "build"], { cwd: "/repo" }, "linux", (command, args, options) => {
    invocation = { command, args, options };
  });
  assert.deepEqual(invocation, {
    command: "pnpm",
    args: ["--filter", "@omni-sql/backend", "build"],
    options: { cwd: "/repo" },
  });
});

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

test("stages node.exe from the Windows ZIP directory tree", () => {
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), "omni-sql-node-extract-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "omni-sql-node-output-"));
  const source = path.join(extracted, "node-v22.23.1-win-x64", "node.exe");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "windows node");

  stageNode(out, "windows-x64", extracted);

  assert.equal(fs.readFileSync(path.join(out, "runtime/node/node.exe"), "utf8"), "windows node");
  fs.rmSync(extracted, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

test("fails when a Windows node.exe is absent from the extracted tree", () => {
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), "omni-sql-node-extract-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "omni-sql-node-output-"));

  assert.throws(() => stageNode(out, "windows-x64", extracted), /Node archive has no node\.exe/);
  fs.rmSync(extracted, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});
