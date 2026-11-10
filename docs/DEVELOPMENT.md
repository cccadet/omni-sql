# Development

Install the host dependencies in [Building](BUILDING.md#host-dependencies), then
run `pnpm install` from the repository root. Package scripts are the command
reference; [CLAUDE.md](../CLAUDE.md) lists the common ones, including how to run
a single test.

## Workflows

| Command | Purpose |
| --- | --- |
| `pnpm dev:frontend` | React/Vite in a browser, port 1420 |
| `pnpm dev:backend` | Authenticated Node HTTP JSON-RPC, port 41920 |
| `pnpm dev:tauri` | Native desktop; starts the frontend and sidecars |

Run frontend and backend separately for browser development. Limit local Rust
builds to two jobs: `CARGO_BUILD_JOBS=2 pnpm dev:tauri` in Bash, or
`$env:CARGO_BUILD_JOBS='2'` before `pnpm dev:tauri` in PowerShell.

To get test databases and seed matching connections, see
[docker/test-dbs](../docker/test-dbs/README.md).

## JVM sidecar

Build the JAR when you need CTE column resolution or JDBC:

```bash
cd services/jvm-sidecar
./bootstrap.sh             # first time, if the Gradle wrapper is absent
./gradlew jar              # gradlew.bat jar on Windows
```

The output is `services/jvm-sidecar/build/libs/omni-sql-sidecar.jar`. Rebuild it
after JVM changes and restart Tauri, which runs the JAR directly. Avoid
`gradlew run`: its daemon can keep port 41921 busy. Without the JAR, basic
autocomplete still works, but CTE resolution and JDBC are unavailable.

## Checks

Run affected typecheck, lint and tests once after a coherent change;
`pnpm verify` checks all TypeScript packages. For Rust changes run
`CARGO_BUILD_JOBS=2 cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`;
for JVM changes run `./gradlew test`. [Testing](TESTING.md) covers hooks,
coverage, integration and CI.

## MCP clients during development

Desktop MCP clients may not inherit shell setup from Node version managers such
as fnm. Make Node reachable through the MCP server's `env.PATH` using a stable
installation directory, not a temporary `fnm_multishells` path, and restart the
client after changing it. See [MCP.md](MCP.md) for client setup.
