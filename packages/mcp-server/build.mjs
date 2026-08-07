import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(packageDir, "../..");
const distDir = path.join(packageDir, "dist");

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

await build({
  absWorkingDir: rootDir,
  entryPoints: ["packages/mcp-server/src/index.ts"],
  outfile: "packages/mcp-server/dist/index.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
});

fs.writeFileSync(path.join(distDir, "package.json"), '{"type":"module"}\n');
