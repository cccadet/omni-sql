# Building

## Prepare and validate resources

Release-style builds bundle Node, a JRE, the backend, and the JVM sidecar.
Prepare them on the host that will be built:

```bash
pnpm install --frozen-lockfile
pnpm prepare:resources
pnpm validate:resources
```

The resource preparer rejects a different target. Native Node addons must be
built for the target host; source builds do not cross-build portable runtime
resources. Staged files are:

```text
apps/desktop/src-tauri/resources/backend/index.mjs
apps/desktop/src-tauri/resources/runtime/node/node       # node.exe on Windows
apps/desktop/src-tauri/resources/runtime/jre/bin/java
apps/desktop/src-tauri/resources/sidecar/omni-sql-sidecar.jar
```

`prepare:resources` builds and stages the sidecar JAR through the Gradle
wrapper. If resources are prepared or validated manually, the expected source
artifact is `services/jvm-sidecar/build/libs/omni-sql-sidecar.jar`; create it
with `services/jvm-sidecar/gradlew jar` (or `gradlew.bat jar`) when needed.

## Host build dependencies

Ubuntu 22.04:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf libssl-dev libfuse2 xdg-utils file libayatana-appindicator3-dev
```

Windows requires [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
and [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/),
plus Node 22, pnpm 11.17.0, Rust stable, and JDK 21.

## Tauri build

```bash
pnpm build:tauri
```

The Tauri configuration runs resource preparation, resource validation, and
the desktop Vite build before bundling. Outputs are under
`apps/desktop/src-tauri/target/release/bundle/` (`deb` on Linux and Windows
installer formats such as `nsis`).

## Release flow

The release workflow accepts tags matching exactly `vX.Y.Z`. It requires
successful CI (including SonarCloud) for the exact tagged commit on the default
branch, verifies the repository and runs real database integration before
building native resources. Builds run on Windows x64, Linux x64 and macOS
arm64/x64. Published assets include Windows `.exe`, Linux `.deb`, macOS `.dmg`
and updater archives/signatures, `latest.json`, and `SHA256SUMS`.

Run `pnpm verify:release` locally before a release tag. It reuses successful
coverage and integration checkpoints when the relevant files and baseline are
unchanged. To run only database integration without regenerating coverage, use
`bash scripts/integration-release.sh` with Java 21, Node 22, pnpm, Rust and Docker
available. On Linux, install the Tauri build dependencies above and
`unixodbc-dev`; the MongoDB SQL integration also compiles Rust code. Evidence
(TAP results, logs, commit/working-tree state and tool/fixture versions) is saved
under `artifacts/release-integration` and uploaded by the release workflow even
on failure. Required suites reject missing fixtures and unexpected skips;
the RPC suite permits only its six existing unsupported JDBC scenarios.

The Windows build requires the `TAURI_SIGNING_PRIVATE_KEY` repository secret.
Set it to the complete contents of the updater private key. If that key has a
password, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep an offline backup:
losing the private key prevents existing installations from accepting future
updates. The public key embedded in `tauri.conf.json` is safe to commit.

Source builds target the host platform and architecture only. Cross-target
resource preparation is rejected because native Node addons cannot be reused
across architectures.
