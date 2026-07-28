# Development

## Prerequisites

- Node.js **>= 22** (`node:sqlite` is built in).
- pnpm **11.17.0**, pinned by the root `package.json` as
  `pnpm@11.17.0+sha512.cca3cea332ad254bb84145f966d19f4879615210346fc92c79a047f23a0d7b3cca3c3792f0076ba1f1831d277efbcf0a9119b31a9a60eca7fb3d6231f331ef72`.
  Use Corepack or install that exact version.
- Rust stable.
- Tauri CLI 2.x (`cargo install tauri-cli --version "^2.0" --locked`).
- JDK 21 or newer for the JVM sidecar.
- Gradle 8 or newer, or the checked-in Gradle wrapper. `bootstrap.sh` creates
  the wrapper when needed.

On Ubuntu 22.04, install Tauri dependencies:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf libssl-dev libfuse2 xdg-utils file libayatana-appindicator3-dev
```

On Windows, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
and the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

## Install and commands

From repository root:

```bash
pnpm install
pnpm verify
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Root scripts:

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Recursive TypeScript typecheck |
| `pnpm lint` | Recursive ESLint |
| `pnpm test` | Recursive package tests |
| `pnpm verify` | Typecheck, lint, and tests |
| `pnpm build` | Build packages |
| `pnpm dev:frontend` | Vite frontend at `http://localhost:1420` |
| `pnpm dev:backend` | Node backend at `http://localhost:41920/rpc` |
| `pnpm dev:tauri` | Full native desktop development |
| `pnpm build:tauri` | Tauri bundle build |
| `pnpm prepare:resources` | Prepare portable runtime resources |
| `pnpm validate:resources` | Validate prepared resources |

## Development workflows

### Frontend only

Run `pnpm dev:frontend`. This opens the React/Vite app in a browser for fast
iteration; it is not the production runtime. Run `pnpm dev:backend` separately
when backend requests are needed.

### Backend only

Run `pnpm dev:backend`. The Node service exposes authenticated HTTP JSON-RPC on
loopback port `41920`. Package tests can run independently with `pnpm test` or
from the relevant package directory.

### Full desktop

Run `pnpm dev:tauri`. Tauri starts Vite and the Node backend, then opens the
native window. The JVM sidecar is optional: without its JAR, autocomplete uses
tier 1 and continues to work.

### JVM sidecar

Build it before full desktop development when tier-2 CTE autocomplete or JDBC
features are needed:

```bash
cd services/jvm-sidecar
chmod +x bootstrap.sh gradlew
./bootstrap.sh       # first time, if the wrapper is absent
./gradlew jar
```

Windows PowerShell:

```powershell
cd services\jvm-sidecar
.\gradlew.bat jar
```

The JAR is `services/jvm-sidecar/build/libs/omni-sql-sidecar.jar`. Tauri runs
that JAR directly; do not use `gradlew run` for the app, because its Gradle
daemon can outlive the Tauri process and retain port `41921`.

## Testing and checks

Use `pnpm verify` for all TypeScript packages and frontend tests. Use:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

For sidecar changes, run `services/jvm-sidecar/gradlew test` (or
`gradlew.bat test` on Windows) and rebuild the JAR before testing Tauri.
