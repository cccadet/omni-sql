# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

omni-sql: multi-database SQL IDE with contextual autocomplete (no LLM required) and local analysis. This is the single source of project guidance.

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

## Architecture (big picture)

Local desktop app; several processes cooperate over loopback:

- **Tauri/Rust shell** spawns and health-checks the Node backend (`:41920`) and optional JVM sidecar (`:41921`), hosts the React UI and exposes Tauri commands for local analysis.
- **React UI** talks to the **Node backend** via HTTP JSON-RPC. The backend owns connections, adapters (behind `adapters-core`'s registry/caching wrapper), metadata sync and autocomplete orchestration.
- **Autocomplete** is two-tier: tier 1 is the lexer/contextual engine driven by `dialect-descriptors`; tier 2 asks the JVM sidecar (Calcite) to resolve CTE columns. Sidecar failure/timeout falls back to tier 1; never fail the request.
- **JDBC** and user-supplied drivers run only through the JVM sidecar. MongoDB uses the native driver plus SQL translation in the backend.
- **Local analysis** runs in Rust/DuckDB (`local.duckdb`); the backend streams relational rows to Rust as bounded NDJSON.
- **MCP server** (stdio or authenticated HTTP `:41922`) bridges to the backend; SQL edits/execution require desktop approval and results are bounded.

Deeper detail: `docs/ARCHITECTURE.md`, `docs/MCP.md`, `docs/MONGODB.md`, `docs/RUST_DATA_ENGINE_PLAN.md`.

## Commands

Use pnpm 11.17.0 (`package.json#packageManager`) and Node 22.

- Install: `pnpm install`
- Typecheck/lint/tests: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`
- Full TypeScript verification: `pnpm verify`
- Fast feedback: `pnpm test:fast` (packages + desktop libraries; excludes components
  and monaco-config.test.ts; not a completion gate)
- Precommit: `pnpm precommit` (staged whitespace and TS/JS lint only)
- Before push: the pre-push hook runs typecheck/lint/`test:fast` on branches; PR CI
  runs coverage and SonarCloud. Run `pnpm verify:push` locally only to diagnose
  coverage (the hook runs it for direct pushes to `main`).
- Database integration (optional locally; CI runs it on `main`): `pnpm test:integration`
- Coverage only: `pnpm test:coverage` (TS), `pnpm coverage:native` (Rust/JVM/S3)
- Dev: `pnpm dev:frontend` (1420), `pnpm dev:backend` (41920),
  `CARGO_BUILD_JOBS=2 pnpm dev:tauri`
- Rust check: `CARGO_BUILD_JOBS=2 cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- Optional hooks: `git config core.hooksPath .githooks`

Single tests:

- Desktop (Vitest): `pnpm --filter desktop exec vitest run src/lib/foo.test.ts` (`-t "name"` for one case)
- Backend (`node --test`): `pnpm --filter backend exec node --test src/foo.test.ts`
- Other packages: `node --test`; check each package's `test` script.
- JVM sidecar: `./gradlew test` in `services/jvm-sidecar` (`gradlew.bat` on Windows); `./gradlew jar` builds the JAR.

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
  All-database integration runs in CI on `main`; run it locally only for changes
  affecting all adapters.
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
- CI on `main` runs typecheck, lint, coverage, SonarCloud and real database
  integration; evidence in `artifacts/release-integration` is uploaded even on
  failure. Release requires that CI run to succeed for the exact tagged commit,
  then only builds; its quality job waits for that run, so push the tag right
  after merging. Installer builds run only at release, plus on PRs that change
  packaging inputs (Windows/macOS preflight paths) or by manual dispatch.
- Avoid duplicate runs: put release notes in the PR so the merge commit is the
  tagged commit, do not re-run local checks the hook or CI already ran, and do
  not push follow-up commits to `main` just for notes.
- Keep full integration and desktop lifecycle validation outside the per-edit/
  precommit loop unless the affected path requires them.
- Before tagging, commit `docs/releases/vX.Y.Z.md` (user-facing notes ending with a
  Full Changelog compare link); the release workflow uses it as the GitHub Release
  body and fails without it.
- After triggering a release, provide the workflow link; do not repeatedly poll
  in the same chat. Check again only when requested or in a later task.

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

## Module notes

- **Stack:** Node >=22, ESM TypeScript 5.7 (`noUncheckedIndexedAccess`, `noImplicitOverride`), Tauri 2, JVM sidecar on Kotlin 2.1 / JDK 21 / Gradle / Calcite 1.37 (scope parsing is syntactic, not schema-backed). pnpm filter names: `desktop`, `@omni-sql/backend`, `@omni-sql/mcp-server`.
- **Backend** (`packages/backend`): entry `src/index.ts`, contract `src/protocol.ts`, handlers `src/handlers.ts`. `query.run` validates positive integer limits, defaults to 1,000 rows, caps at 10,000. CTE completion calls sidecar `/scope/resolve` with a 250ms timeout and merges relations into tier 1; failure, timeout, malformed response or unparseable CTE falls back to tier 1. The MCP bridge exposes bounded, validated UI tools, never credentials or automatic SQL edits.
- **Desktop UI:** `src/App.tsx` coordinates session, connections, execution, completion, formatting, results and MCP UI state. Tabs, history, theme, language and formatter settings persist in `localStorage`; connections restore from backend SQLite + keyring. Monaco setup is `src/lib/monaco-config.ts`.
- **SQL formatter:** `sql-formatter` only (no custom formatter), via `src/lib/format-sql.ts` (dialect → formatter language: PostgreSQL, MySQL/MariaDB, SQL Server `transactsql`, Oracle `plsql`, generic). Default shortcut `Ctrl+Alt+L`; settings in `localStorage` key `omni-sql:formatterSettings`.
- **JVM sidecar:** main `dev.omnisql.sidecar.MainKt`, fat JAR run via `java -jar`, JDK HttpServer, Calcite logging bound to slf4j-nop. `CteTextScanner` isolates each CTE body before parsing so incomplete outer SQL is never parsed. Out of scope for now in the sidecar: schema/catalog adapter, SELECT-star expansion, full validation, correlated-subquery scope (tier 1 handles correlated subqueries).
- **MCP server:** `createMcpServer` registers approved tools; default stdio. Streamable HTTP at fixed `/mcp` on `127.0.0.1:41922` requires `OMNI_SQL_MCP_HTTP_TOKEN` and Bearer auth; sessions have generated IDs, bounded capacity and idle expiry; bodies, tool text, responses and errors are size-bounded and schema-validated. `BackendMcpClient` forwards calls to backend `/mcp`, which filters sensitive fields, bounds queue/timeouts and routes approved UI actions.
- **Dialects:** PostgreSQL metadata uses information_schema/pg_catalog with cursors and JSON EXPLAIN; SQL Server plans use SHOWPLAN in a separate transaction.
- **Reporting:** report only commands with observed output; preserve unrelated dirty/untracked work (don't stage or revert it).
