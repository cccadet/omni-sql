# Building and releasing

## Host dependencies

All platforms need Node 22+, pnpm 11.17.0 (pinned in `package.json`), Rust
stable, Java 21+ and the Tauri CLI 2.x
(`cargo install tauri-cli --version "^2.0" --locked`).

Ubuntu 22.04:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf libssl-dev libfuse2 xdg-utils file libayatana-appindicator3-dev unixodbc-dev
```

Windows needs [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
and the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

## Bundled resources

Release builds bundle Node, a JRE, the backend and the JVM sidecar. Prepare them
on the host you are building for:

```bash
pnpm install --frozen-lockfile
pnpm prepare:resources
pnpm validate:resources
```

`prepare:resources` builds the sidecar JAR with the Gradle wrapper and stages:

```text
apps/desktop/src-tauri/resources/backend/index.mjs
apps/desktop/src-tauri/resources/runtime/node/node       # node.exe on Windows
apps/desktop/src-tauri/resources/runtime/jre/bin/java
apps/desktop/src-tauri/resources/sidecar/omni-sql-sidecar.jar
```

Builds target the host platform and architecture only: native Node addons cannot
be reused across architectures, so cross-target preparation is rejected.

The backend bundle (`pnpm --filter @omni-sql/backend build`, producing
`packages/backend/dist/index.mjs`) inlines pure JavaScript drivers. Its
`external-layout.json` lists the native packages copied beside it:
`@napi-rs/keyring`, `oracledb`, `odbc` and `@polyglot-sql/sdk` (with its WASM).

## Tauri build

```bash
pnpm build:tauri
```

This runs resource preparation, validation and the Vite build, then bundles.
Outputs land in `apps/desktop/src-tauri/target/release/bundle/`.

## Release workflow

1. Put user-facing notes in `docs/releases/vX.Y.Z.md` (see the
   [template](releases/TEMPLATE.md)), ending with a Full Changelog compare link,
   inside the PR so the merge commit is the tagged commit.
2. After merging, push the tag `vX.Y.Z` on the merge commit right away.
3. The workflow waits for CI on `main` for that exact commit (typecheck, lint,
   coverage, SonarCloud, database integration), then builds on Windows x64,
   Linux x64 and macOS arm64/x64. It fails without the release notes file.

Published assets: Windows `.exe` and `x64-portable.zip`, Linux `.deb`, macOS
`.dmg`, updater archives and signatures, `latest.json` and `SHA256SUMS`. The
release notes become the GitHub Release body.

Versioning: features bump the minor version and reset the patch; fixes-only
releases bump the patch. Never overwrite a pushed release tag.

The updater needs the `TAURI_SIGNING_PRIVATE_KEY` repository secret (the full
private key) and, if the key has a password, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
Keep an offline backup: losing the key prevents existing installations from
accepting updates. The public key in `tauri.conf.json` is safe to commit.
