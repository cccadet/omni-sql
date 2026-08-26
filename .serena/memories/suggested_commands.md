# Commands
- Whole workspace: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`; comprehensive verification: `pnpm verify`.
- Target a package with `pnpm --filter <package> typecheck|lint|test`; frontend package is `desktop`, backend is `backend`, MCP is `mcp-server`.
- Development: `pnpm dev:frontend` (Vite :1420); `pnpm dev:backend` (backend :41920); `pnpm dev:tauri`. Tauri build: `pnpm build:tauri`.
- Tauri Rust validation: `cd apps/desktop/src-tauri && cargo check`.
- JVM sidecar: `cd services/jvm-sidecar && ./gradlew test`; use `./gradlew build` when a jar/build artifact is needed.
- Native build allowlist is in `pnpm-workspace.yaml` (esbuild, stale Svelte plugin entry, oracledb).