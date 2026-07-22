import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resources = path.join(root, "apps/desktop/src-tauri/resources");
const cache = path.join(root, ".cache/omni-sql-runtimes");

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(resources, "runtime-manifest.json"), "utf8"));
  const targets = Object.keys(manifest.targets);
  const cliTarget = process.argv.find((arg) => arg.startsWith("--target="))?.slice(9);
  const envTarget = tauriTarget();
  if (cliTarget && envTarget && cliTarget !== envTarget) {
    fail(`--target=${cliTarget} does not match Tauri target '${envTarget}'`);
  }
  const requestedTarget = cliTarget ?? envTarget ?? hostTarget();
  const validateOnly = process.argv.includes("--validate");
  const host = hostTarget();

  if (requestedTarget !== host) {
    fail(`--target=${requestedTarget} does not match host target '${host}'; release builds are native, so prepare resources on the target platform instead`);
  }
  const target = requestedTarget;
  if (!targets.includes(target)) fail(`unsupported target '${target}'; use ${targets.join(", ")}`);
  if (process.argv.includes("--print-target")) {
    console.log(target);
    return;
  }
  const spec = manifest.targets[target];
  const output = resources;

  if (validateOnly) {
    validate(output, target);
    console.log(`[omni-sql] resource validation passed: ${target}`);
    return;
  }

  for (const generated of ["backend", "runtime/node", "runtime/jre", "sidecar", "licenses"]) fs.rmSync(path.join(output, generated), { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const downloads = path.join(cache, target);
  fs.mkdirSync(downloads, { recursive: true });
  for (const kind of ["node", "jre"]) {
    const archive = path.join(downloads, spec[kind].file);
    downloadAndVerify(spec[kind], archive);
    extract(archive, path.join(downloads, `${kind}-extract`));
  }
  stageNode(output, target, path.join(downloads, "node-extract"));
  stageJre(output, target, path.join(downloads, "jre-extract"));
  stageBackend(output);
  stageSidecar(output);
  stageLicenses(output, downloads);
  validate(output, target);
  console.log(`[omni-sql] prepared ${target} at ${path.relative(root, output)}`);
}

function normalizeTarget(platform, arch) {
  const normalizedPlatform = { win32: "windows", windows: "windows", darwin: "darwin", linux: "linux" }[platform];
  const normalizedArch = { x64: "x64", x86_64: "x64", amd64: "x64", arm64: "arm64", aarch64: "arm64" }[arch];
  if (!normalizedPlatform || !normalizedArch) return undefined;
  const target = `${normalizedPlatform}-${normalizedArch}`;
  return ["windows-x64", "linux-x64", "darwin-x64", "darwin-arm64"].includes(target) ? target : undefined;
}

function tauriTarget() {
  const platform = process.env.TAURI_ENV_PLATFORM;
  const arch = process.env.TAURI_ENV_ARCH;
  if (platform || arch) {
    const target = normalizeTarget(platform, arch);
    if (!target) fail(`unsupported Tauri target platform/arch '${platform ?? ""}/${arch ?? ""}'`);
    return target;
  }
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE;
  if (!triple) return undefined;
  const [archPart, , platformPart] = triple.split("-");
  const target = normalizeTarget(platformPart === "pc" ? triple.split("-")[2] : platformPart, archPart);
  if (!target) fail(`unsupported Tauri target triple '${triple}'`);
  return target;
}

function hostTarget() {
  const target = normalizeTarget(process.platform, process.arch);
  if (!target) fail(`unsupported host platform/arch '${process.platform}/${process.arch}'`);
  return target;
}
export function pnpmCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}
export function windowsCommandInvocation(command, args = [], env = process.env) {
  return {
    command: env.ComSpec ?? env.COMSPEC ?? "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  };
}
export function pnpmInvocation(args = [], platform = process.platform, env = process.env) {
  if (platform === "win32") return windowsCommandInvocation(pnpmCommand(platform), args, env);
  return { command: pnpmCommand(platform), args };
}
export function runPnpm(args, options = {}, platform = process.platform, run = execFileSync, env = process.env) {
  const invocation = pnpmInvocation(args, platform, env);
  return run(invocation.command, invocation.args, options);
}
export function gradleInvocation(args = ["jar"], platform = process.platform, env = process.env) {
  if (platform === "win32") return windowsCommandInvocation("gradlew.bat", args, env);
  return { command: "./gradlew", args };
}
export function runGradle(args = ["jar"], options = {}, platform = process.platform, run = execFileSync, env = process.env) {
  const invocation = gradleInvocation(args, platform, env);
  return run(invocation.command, invocation.args, options);
}
function fail(message) { throw new Error(`[omni-sql] resource preparation failed: ${message}`); }
function downloadAndVerify(item, destination) {
  if (!fs.existsSync(destination)) execFileSync(process.platform === "win32" ? "curl.exe" : "curl", ["--fail", "--location", "--retry", "3", "--output", destination, item.url], { stdio: "inherit" });
  const actual = crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
  if (actual !== item.sha256) { fs.rmSync(destination, { force: true }); fail(`SHA-256 mismatch for ${item.file}: expected ${item.sha256}, got ${actual}`); }
}
export function extract(archive, destination, platform = process.platform, run = execFileSync) {
  fs.rmSync(destination, { recursive: true, force: true }); fs.mkdirSync(destination, { recursive: true });
  if (archive.endsWith(".zip")) {
    if (platform === "win32") {
      // tar.exe treats a drive-letter path as an archive/option fragment. Keep
      // native paths out of its argument parser and let PowerShell handle them.
      // Arguments after a -Command string are not reliably exposed as $args by
      // Windows PowerShell, so embed both paths as escaped PowerShell literals.
      const quote = (value) => `'${value.replaceAll("'", "''")}'`;
      const command = `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(destination)} -Force`;
      run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { stdio: "inherit" });
    } else {
      run("unzip", ["-q", archive, "-d", destination], { stdio: "inherit" });
    }
  }
  else run("tar", ["-xf", archive, "-C", destination], { stdio: "inherit" });
}
function firstDirectory(dir) { const entry = fs.readdirSync(dir, { withFileTypes: true }).find((item) => item.isDirectory()); return entry ? path.join(dir, entry.name) : dir; }
export function stageNode(out, targetName, extracted) {
  const dir = path.join(out, "runtime/node"); fs.mkdirSync(dir, { recursive: true });
  const binary = targetName.startsWith("windows") ? "node.exe" : "node";
  const source = targetName.startsWith("windows")
    ? findFile(extracted, binary)
    : path.join(firstDirectory(extracted), "bin", binary);
  if (!source || !fs.existsSync(source)) fail(`Node archive has no ${binary}`);
  fs.copyFileSync(source, path.join(dir, binary)); if (binary !== "node") return;
  fs.chmodSync(path.join(dir, binary), 0o755);
}
function stageJre(out, targetName, extracted) {
  const src = firstDirectory(extracted); const home = targetName.startsWith("darwin") ? path.join(src, "Contents/Home") : src; const destination = path.join(out, "runtime/jre");
  const java = targetName.startsWith("windows") ? "java.exe" : "java"; if (!fs.existsSync(path.join(home, `bin/${java}`))) fail(`JRE archive has no bin/${java}`); fs.cpSync(home, destination, { recursive: true, dereference: true });
  if (java === "java") fs.chmodSync(path.join(destination, "bin/java"), 0o755);
}
function stageBackend(out) {
  runPnpm(["--filter", "@omni-sql/backend", "build"], { cwd: root, stdio: "inherit" });
  const source = path.join(root, "packages/backend/dist"); const destination = path.join(out, "backend"); if (!fs.existsSync(path.join(source, "index.mjs"))) fail("backend build did not produce dist/index.mjs");
  fs.cpSync(source, destination, { recursive: true, dereference: true });
  const layout = JSON.parse(fs.readFileSync(path.join(source, "external-layout.json"), "utf8"));
  for (const specifier of layout.nodeModules) copyPackageTree(specifier, destination);
}
function packageRoot(specifier, parentSource) {
  const searchPaths = [parentSource ?? root, path.join(root, "packages/backend"), path.join(root, "packages/adapters-oracle")];
  const resolved = execFileSync(process.execPath, ["--input-type=module", "-e", `import {createRequire} from 'node:module'; console.log(createRequire(import.meta.url).resolve(${JSON.stringify(specifier)}, {paths: ${JSON.stringify(searchPaths)}}))`], { cwd: root, encoding: "utf8" }).trim();
  let current = path.dirname(resolved);
  while (current !== path.dirname(current)) { if (fs.existsSync(path.join(current, "package.json"))) return current; current = path.dirname(current); }
  fail(`cannot locate external package ${specifier}`);
}
function copyPackageTree(specifier, backendDir, destinationParent, parentSource) {
  const sourceRoot = packageRoot(specifier, parentSource); const destination = path.join(destinationParent ?? path.join(backendDir, "node_modules"), specifier);
  if (fs.existsSync(destination)) return; fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(sourceRoot, destination, { recursive: true, dereference: true, filter: (source) => path.basename(source) !== "node_modules" });
  const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
  for (const dependency of Object.keys({ ...packageJson.dependencies, ...packageJson.optionalDependencies, ...packageJson.peerDependencies })) {
    try { copyPackageTree(dependency, backendDir, path.join(destination, "node_modules"), sourceRoot); }
    catch (error) { if (!packageJson.optionalDependencies?.[dependency]) throw error; }
  }
}
function stageSidecar(out) {
  const cwd = path.join(root, "services/jvm-sidecar"); runGradle(["jar"], { cwd, stdio: "inherit" });
  const jar = path.join(cwd, "build/libs/omni-sql-sidecar.jar"); if (!fs.existsSync(jar)) fail(`missing sidecar JAR: ${jar}`); fs.mkdirSync(path.join(out, "sidecar"), { recursive: true }); fs.copyFileSync(jar, path.join(out, "sidecar/omni-sql-sidecar.jar"));
}
function stageLicenses(out, downloads) {
  const licenses = path.join(out, "licenses"); fs.mkdirSync(licenses, { recursive: true }); fs.copyFileSync(path.join(root, "LICENSE"), path.join(licenses, "omni-sql-LICENSE"));
  for (const [name, dir] of [["node", path.join(downloads, "node-extract")], ["jre", path.join(downloads, "jre-extract")]]) for (const file of ["LICENSE", "NOTICE", "NOTICE.txt"]) { const found = findFile(dir, file); if (found) fs.copyFileSync(found, path.join(licenses, `${name}-${file}`)); }
}
function findFile(dir, wanted) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, item.name); if (item.isFile() && item.name.toLowerCase() === wanted.toLowerCase()) return p; if (item.isDirectory()) { const found = findFile(p, wanted); if (found) return found; } } return undefined; }
function validate(dir, targetName) { const binary = targetName.startsWith("windows") ? "node.exe" : "node"; const java = targetName.startsWith("windows") ? "java.exe" : "java"; for (const p of [path.join(dir, "backend/index.mjs"), path.join(dir, `runtime/node/${binary}`), path.join(dir, `runtime/jre/bin/${java}`), path.join(dir, "sidecar/omni-sql-sidecar.jar"), path.join(dir, "runtime-manifest.json"), path.join(dir, "licenses")]) if (!fs.existsSync(p)) fail(`missing required resource ${path.relative(dir, p)}`); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
