import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
