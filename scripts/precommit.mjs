/* global process */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

execFileSync("git", ["diff", "--cached", "--check"], { stdio: "inherit" });
const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { encoding: "utf8" });
const files = staged.split("\0").filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) && existsSync(file));
if (files.length) {
  const unstaged = execFileSync("git", ["diff", "--name-only", "--", ...files], { encoding: "utf8" });
  if (unstaged.trim()) throw new Error("Stage the complete files before linting: " + unstaged.trim());
  execFileSync(process.execPath, [process.env.npm_execpath, "exec", "eslint", ...files], { stdio: "inherit" });
}
