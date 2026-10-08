# AGENTS.md — omni-sql

Multi-database SQL IDE with contextual autocomplete (no LLM required) and local analysis.

## Layout and stack

```text
apps/desktop/src             React 19 + TypeScript + Fluent UI v9 + Monaco
apps/desktop/src-tauri       Tauri/Rust shell; spawns Node/JVM sidecars
  src/data_engine.rs         Embedded DuckDB: query/file/S3 imports, DuckLake, export
packages/ts-types            Shared models and contracts
packages/dialect-descriptors Dialect descriptors consumed by the lexer
packages/adapters-core       Adapter interface, registry and caching wrapper
packages/adapters-{pg,mysql,mssql,oracle,jdbc,odbc}
                             Database adapters
packages/autocomplete-engine Lexer and contextual completion
packages/metadata-cache      SQLite (node:sqlite), last_synced_at
packages/backend             Node HTTP JSON-RPC, MongoDB driver/SQL translation
packages/mcp-server          MCP stdio and authenticated Streamable HTTP
services/jvm-sidecar         Kotlin/JVM + Calcite: scope, editability, JDBC HTTP
```
Drivers: `pg`, `mysql2/promise` (MySQL/MariaDB), `mssql`/Tedious,
`oracledb` thin mode, generic JDBC, `odbc`, and `mongodb`.
PostgreSQL uses information_schema/pg_catalog, server-side cursors and
`EXPLAIN (FORMAT JSON)`; SQL Server plans use `SET SHOWPLAN_XML` in a separate transaction.
Tauri ↔ backend contracts live in `packages/backend/src/protocol.ts` (localhost:41920).
JVM endpoints include `/health`, `/scope/resolve`, `/query/editability` and `/jdbc/*`.

## Commands

Use pnpm 11.17.0 (`package.json#packageManager`) and Node 22.

- Install: `pnpm install`
- Typecheck/lint/tests: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`
- Full TypeScript verification: `pnpm verify`
- Fast feedback: `pnpm test:fast` (packages + desktop libraries; excludes components
  and monaco-config.test.ts; not a completion gate)
- Precommit: `pnpm precommit` (staged whitespace and TS/JS lint only)
- Before push: `pnpm verify:push` (TS/Rust/JVM coverage and new-code preflight)
- Before release: `pnpm verify:release` (coverage checkpoint + real database integration)
- Integration only: `bash scripts/integration-release.sh` (no coverage regeneration)
- Coverage only: `pnpm test:coverage` (TS), `pnpm coverage:native` (Rust/JVM/S3)
- Dev: `pnpm dev:frontend` (1420), `pnpm dev:backend` (41920),
  `CARGO_BUILD_JOBS=2 pnpm dev:tauri`
- Rust check: `CARGO_BUILD_JOBS=2 cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- Optional hooks: `git config core.hooksPath .githooks`

## Development and tests

- Implement a coherent change before checking; do not run checks after every edit.
  Before nontrivial implementation, identify relevant observable failures and
  choose the smallest test level that detects them. A short note is enough.
- Prefer integration/E2E for user workflows; retain isolated tests for parsing,
  boundary validation, cancellation, rollback and costly failure combinations.
  Small changes do not require new E2E tests; regressions may be written after code.
- Assert observable behavior or meaningful public contracts, not constants,
  object identity or mock calls without a concrete failure. Coverage does not
  justify low-signal tests. Remove tests only with demonstrated redundancy or
  lack of protection, never by category alone.
- At completion, run affected typecheck, lint and local tests once. Reproduce bugs
  before fixing when feasible. Repeat checks only after relevant edits, failures
  or unresolved concerns; do not repeat approved checks needlessly.
- Shared contracts require consumer checks; Rust/JVM changes require native checks.
  Driver, persistence and protocol changes require affected-path integration.
  Reserve all-database integration for release or changes affecting all adapters.
- Required integrations fail on missing fixtures/prerequisites and unexpected skips.
  Optional external tests may skip locally; report skips accurately.
- Generate integration/E2E evidence automatically: command, commit/working-tree
  state, tool/fixture versions, results/skips and logs. Exclude production secrets/data.
- Vitest/jsdom and backend HTTP tests with in-memory adapters are not complete
  UI → Tauri → sidecars → database E2E coverage; do not treat them as replacements.
- Limit local Rust builds to `CARGO_BUILD_JOBS=2`. Keep precommit lightweight;
  when hooks are enabled, let the hook run precommit rather than running it twice.

## Push and release gates

Read [docs/TESTING.md](docs/TESTING.md) before push/release validation or changing
coverage gates; it contains prerequisites, baseline handling and checkpoint details.

- `verify:push` is coverage preflight, not a substitute for affected typecheck/lint.
  Overall TS coverage >=80% does not establish Sonar new-code coverage or test quality.
- Reuse successful checkpoints when code/configuration, reports and baseline are
  unchanged. Never silently substitute HEAD/latest tag for a missing Sonar baseline;
  `--base` requires an established reference, and `--reports-only` is diagnostic only.
- Release requires successful CI/Sonar for the exact tagged commit on the default
  branch, then tagged verification, real database integration and builds. Integration
  runs independently of local hooks, without repeating native coverage; evidence in
  `artifacts/release-integration` is uploaded even on failure.
- Keep full integration and desktop lifecycle validation outside the per-edit/
  precommit loop unless the affected path requires them.
- After triggering a release, provide the workflow link; do not repeatedly poll
  in the same chat. Check again only when requested or in a later task. Releases
  historically take about 20 minutes; cold integration builds can add time.

## Conventions and constraints

- TypeScript is strict; see `tsconfig.base.json`. Cross-package dependencies use
  `workspace:*` and `.ts` imports. ESLint uses `eslint.config.js`; React uses
  functional components/hooks, no experimental React 19 APIs.
- Package scripts are authoritative: Node --test with TypeScript stripping for
  packages/backend, Vitest/jsdom for desktop. Build approvals are in
  `pnpm-workspace.yaml#allowBuilds`; its Svelte approval is legacy (frontend is React).
- Features increment minor/reset patch; fixes-only releases increment patch.
  Features plus fixes use minor. Never overwrite an already-pushed release tag.
- Credentials use `@napi-rs/keyring`; file fallback requires
  `OMNI_SQL_DEV_KEYRING_FILE` or `OMNI_SQL_DEV_KEYRING=1` and is disabled in production.
  Connections restore from SQLite/keyring; tabs/history/theme use localStorage.
- CTE completion isolates balanced bodies with CteTextScanner, parses via Calcite
  and injects columns in completion.get. Sidecar failure/timeout/invalid JSON falls
  back to tier1. Correlated subqueries are supported; real catalog types,
  SELECT * expansion and complete CalciteSchemaAdapter validation remain TODO.
- Query execution is bounded and cancellable where drivers support it. MCP
  transports enforce authentication, payload/session bounds and UI bridge handling.

<!-- headroom:memory-instructions -->
## Memory

Use `headroom_memory` when available: call memory_search before answering about
past decisions/preferences/context, and memory_save after durable decisions or discoveries.
Search "Plano omni-sql" for earlier architecture context. If tools are unavailable,
use checked-in code/docs, state the limitation and do not invent past decisions or
install a memory server. Memory is the first source for facts absent from this chat.
