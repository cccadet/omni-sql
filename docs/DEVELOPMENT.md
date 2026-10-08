# Development

Install the prerequisites in [Building](BUILDING.md), then run `pnpm install`
from the repository root. Package scripts are the command reference.

## Choose a workflow

| Command | Purpose |
| --- | --- |
| `pnpm dev:frontend` | React/Vite in a browser, port 1420 |
| `pnpm dev:backend` | Authenticated Node HTTP JSON-RPC, port 41920 |
| `pnpm dev:tauri` | Native desktop; starts frontend and sidecars |

Run frontend and backend separately for browser development. Limit local Rust
builds to two jobs: `CARGO_BUILD_JOBS=2 pnpm dev:tauri` in Bash, or set
`$env:CARGO_BUILD_JOBS='2'` before running `pnpm dev:tauri` in PowerShell.

## JVM sidecar

Build the JAR when CTE column resolution or JDBC is needed:

```bash
cd services/jvm-sidecar
./bootstrap.sh             # first time, if the wrapper is absent
./gradlew jar
```

On Windows, use `gradlew.bat jar` after bootstrap. The output is
`services/jvm-sidecar/build/libs/omni-sql-sidecar.jar`. Rebuild it after JVM
changes and restart Tauri. The shell runs the JAR directly; `gradlew run` can
leave a daemon holding port 41921. Without the JAR, basic autocomplete continues,
but CTE resolution and JDBC are unavailable. See the [sidecar guide](../services/jvm-sidecar/README.md)
and [Troubleshooting](TROUBLESHOOTING.md).

## Validation

Run affected package checks once after a coherent change, as described in
[Contributing](../CONTRIBUTING.md). `pnpm verify` checks all TypeScript packages.
For Rust changes, run `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
with `CARGO_BUILD_JOBS=2`; for JVM changes, run the wrapper's `test` task.
[Testing](TESTING.md) covers integration evidence, coverage and push/release gates.

## Optional Serena/LSP tooling

Serena is an agent tool, not an application dependency. Manage its isolated Python
environment with `uv tool install -p 3.13 serena-agent`. Initialize the LSP backend
with `serena init --language-backend LSP` and configure the Codex MCP connection as
described in the [Serena client guide](https://oraios.github.io/serena/02-usage/030_clients.html).
The current local setup enables TypeScript and Kotlin, with
`services/jvm-sidecar` as an additional LSP workspace folder. Rust navigation is
temporarily disabled: symbol listing worked, but known references returned empty
results. Continue running the normal Rust checks explicitly.
Keep Kotlin's index storage in the project cache and
use a current Kotlin LSP build if the bundled build has expired.
For concurrent agent sessions, share one loopback HTTP Serena instance as described
in the [Serena workflow guide](https://oraios.github.io/serena/02-usage/040_workflow.html#multiple-agents-accessing-a-single-serena-instance), using a version with the
[Kotlin index isolation fix](https://github.com/oraios/serena/pull/1982).
Validate symbols and known references in each enabled language; a health-check exit
code alone does not establish that navigation works. Local configuration,
downloads and indexes stay
ignored under `.serena`; its checked-in memories retain project knowledge.

Desktop MCP processes may not inherit shell initialization from Node version
managers such as fnm. Ensure both Node and npm are reachable through the MCP
server's `env.PATH`, using a stable installation directory rather than a temporary
`fnm_multishells` path. Restart the client after changing its MCP environment.
