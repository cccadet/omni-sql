import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(packageDir, "../..");
const distDir = path.join(packageDir, "dist");
const external = ["@napi-rs/keyring", "oracledb", "@polyglot-sql/sdk"];

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

await build({
  absWorkingDir: rootDir,
  entryPoints: ["packages/backend/src/index.ts"],
  outfile: "packages/backend/dist/index.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

fs.writeFileSync(path.join(distDir, "package.json"), '{"type":"module"}\n');
fs.writeFileSync(path.join(distDir, "external-layout.json"), `${JSON.stringify({
  version: 1,
  entrypoint: "index.mjs",
  nodeModules: external,
  notes: "Copy these packages, including native binaries and adjacent resources, under node_modules/.",
}, null, 2)}\n`);

if (process.argv.includes("--validate")) await validateStagedArtifact();
console.log(`[omni-sql] production backend: ${path.relative(rootDir, path.join(distDir, "index.mjs"))}`);

function packageRoot(specifier, paths = [rootDir, path.join(rootDir, "packages/adapters-oracle"), packageDir]) {
  const require = createRequire(import.meta.url);
  const resolved = require.resolve(specifier, { paths });
  let current = path.dirname(resolved);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    current = path.dirname(current);
  }
  throw new Error(`cannot locate package root for ${specifier}`);
}

async function validateStagedArtifact() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "omni-sql-backend-stage-"));
  fs.cpSync(distDir, stage, { recursive: true });
  for (const specifier of external) copyPackageTree(specifier, stage);
  assertNoLinks(stage);

  const port = 41920 + Math.floor(Math.random() * 2000);
  const authToken = "build-validate-auth-token";
  const child = spawn(process.execPath, [path.join(stage, "index.mjs")], {
    cwd: stage,
    env: { ...process.env, NODE_ENV: "production", NODE_PATH: "", OMNI_SQL_PORT: String(port), OMNI_SQL_AUTH_TOKEN: authToken, OMNI_SQL_METADATA_DB: path.join(stage, "metadata.db") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitForHealth(port, child, authToken);
    await probeNativeKeyring(stage);
    await probeKeyringOperation(port, authToken);
    child.kill("SIGTERM");
    await waitForExit(child);
    console.log(`[omni-sql] staged /health probe passed (${stage})`);
  } catch (error) {
    child.kill("SIGTERM");
    await waitForExit(child).catch(() => undefined);
    throw new Error(`staged production probe failed: ${error.message}\n${output}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

// pnpm links are useful during development, but must not escape the production
// artifact. This also walks optional dependencies so native platform packages
// (such as @napi-rs/keyring-linux-x64-gnu) are copied into the stage.
function copyPackageTree(specifier, stage, parentSourceRoot, destinationParent) {
  const sourceRoot = packageRoot(specifier, parentSourceRoot ? [parentSourceRoot] : undefined);
  const destination = path.join(destinationParent ?? path.join(stage, "node_modules"), specifier);
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(sourceRoot, destination, {
    recursive: true,
    dereference: true,
    filter: (source) => path.basename(source) !== "node_modules",
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
  for (const dependency of Object.keys(dependencies)) {
    try {
      copyPackageTree(dependency, stage, sourceRoot, path.join(destination, "node_modules"));
    } catch (error) {
      if (manifest.optionalDependencies?.[dependency]) continue;
      throw error;
    }
  }
}

function assertNoLinks(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`staged artifact contains a symlink: ${entryPath}`);
    if (entry.isDirectory()) assertNoLinks(entryPath);
  }
}

async function probeNativeKeyring(stage) {
  await runNodeProbe(stage, [
    "const pkg = await import('@napi-rs/keyring');",
    "if (typeof pkg.default?.AsyncEntry !== 'function') throw new Error('AsyncEntry is unavailable');",
  ]);
}

async function runNodeProbe(cwd, statements) {
  const probe = spawn(process.execPath, ["--input-type=module", "-e", statements.join("\n")], {
    cwd, env: { ...process.env, NODE_PATH: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  probe.stdout.on("data", (chunk) => { output += chunk; });
  probe.stderr.on("data", (chunk) => { output += chunk; });
  const code = await waitForExit(probe);
  if (code !== 0) throw new Error(`staged keyring load failed (exit ${code}): ${output}`);
}

async function probeKeyringOperation(port, authToken) {
  const config = { id: "build-validate-keyring", label: "build validation", dialect: "postgres", endpoint: "postgres://127.0.0.1:1/unused", user: "build-validation" };
  const added = await rpc(port, "connection.add", { config, password: "build-validation-secret" }, authToken);
  if (added?.result?.ok !== true) throw new Error(`staged keyring operation failed: ${JSON.stringify(added)}`);
  const removed = await rpc(port, "connection.remove", { connectionId: config.id }, authToken);
  if (removed?.result?.ok !== true) throw new Error(`staged keyring delete failed: ${JSON.stringify(removed)}`);
}

function rpc(port, method, params, authToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const request = http.request({ hostname: "127.0.0.1", port, path: "/rpc", method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${authToken}`, "content-length": Buffer.byteLength(body) } }, (response) => {
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => { try { resolve(JSON.parse(raw)); } catch (error) { reject(error); } });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function waitForHealth(port, child, authToken) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const attempt = () => {
      if (child.exitCode !== null) return reject(new Error(`process exited with ${child.exitCode}`));
      const request = http.get(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${authToken}` } }, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else reject(new Error(`health returned HTTP ${response.statusCode}`));
      });
      request.on("error", () => {
        if (Date.now() < deadline) setTimeout(attempt, 50);
        else reject(new Error("health probe timed out"));
      });
    };
    attempt();
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.once("exit", (code) => resolve(code));
  });
}
