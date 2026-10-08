# AGENTS.md — omni-sql

One IDE for every database. Multi-database SQL IDE with contextual autocomplete
and a local analytical workspace. Autocomplete does not require an LLM.

## Stack
- **Shell:** Tauri (Rust) — `apps/desktop/src-tauri`
- **Local analysis:** Rust data engine with embedded DuckDB —
  `apps/desktop/src-tauri/src/data_engine.rs`; imports query results, local files
  and S3 sources, including DuckLake catalogs.
- **Frontend:** TypeScript + React 19 + Fluent UI React v9 + Monaco — `apps/desktop/src`
- **Backend:** Node/TypeScript HTTP JSON-RPC — `packages/backend`
- **MCP:** stdio and Streamable HTTP — `packages/mcp-server`; backend bridge also serves `/mcp`
- **Parser/JDBC:** Kotlin JVM sidecar with Apache Calcite; CTE scope via
  `/scope/resolve`, editability via `/query/editability`, and JDBC via `/jdbc/*`.
- **Cache:** SQLite builtin `node:sqlite` — `packages/metadata-cache`
- **Drivers:** PostgreSQL `pg`; MySQL/MariaDB `mysql2/promise`; SQL Server `mssql`/Tedious;
  Oracle `oracledb` thin mode; generic JDBC and ODBC (`odbc`) adapters
- PostgreSQL metadata uses `information_schema` and `pg_catalog`; query execution uses
  server-side cursors and `EXPLAIN (FORMAT JSON)`. SQL Server plans use `SET SHOWPLAN_XML`
  in a separate transaction.
- **MongoDB:** native `mongodb` driver in `packages/backend`; command execution,
  SQL translation, metadata and completion are implemented.

## Monorepo (pnpm workspaces)
```
apps/desktop                 Tauri shell + React + Fluent UI + Monaco
apps/desktop/src-tauri       Rust shell; spawns Node backend sidecar
packages/ts-types            Unified model and contracts
packages/dialect-descriptors Dialect descriptors consumed by lexer
packages/adapters-core       Adapter interface and registry
packages/adapters-pg         PostgreSQL adapter (`pg`)
packages/adapters-mysql      MySQL/MariaDB adapter (`mysql2/promise`)
packages/adapters-mssql      SQL Server adapter (`mssql`/Tedious)
packages/adapters-oracle    Oracle adapter (`oracledb` thin mode)
packages/adapters-jdbc      Generic JDBC adapter
packages/adapters-odbc      Generic ODBC adapter
packages/autocomplete-engine Lexer and contextual autocomplete provider
packages/metadata-cache      SQLite metadata cache and `last_synced_at`
packages/backend             Node HTTP JSON-RPC handlers and protocol
packages/mcp-server          MCP stdio/Streamable HTTP server
services/jvm-sidecar         Kotlin/Gradle + Calcite: scope/editability + JDBC HTTP
```

## Commands
- **Package manager:** pnpm 11.17.0 (`package.json#packageManager`)
- **Typecheck:** `pnpm -r typecheck`
- **Lint:** `pnpm -r lint` (ESLint 9 flat config in `eslint.config.js`)
- **Test:** `pnpm -r test` (Node `--test` for backend/packages; Vitest for `apps/desktop`)
- **Fast tests:** `pnpm test:fast` (package tests + desktop library tests;
  excludes component tests and `monaco-config.test.ts`; not a completion gate).
- **Full verify:** `pnpm verify` (typecheck, lint, test)
- **Before commit:** `pnpm precommit` (staged diff check and lint of staged TypeScript/JavaScript files).
- **Before pushing completed code:** `pnpm verify:push` (TypeScript + Rust + JVM coverage and new-code coverage preflight).
- **Release validation:** `pnpm verify:release` (coverage checkpoint + real database/JDBC integration).
- **Release integration only:** `bash scripts/integration-release.sh` (real
  database/JDBC/MongoDB/ODBC integration with evidence; does not regenerate
  coverage). Run only for release or affected integration paths.
- **TypeScript coverage only:** `pnpm test:coverage` (overall line coverage >=80%; this alone does not predict the Sonar gate).
- **Native coverage only:** `pnpm coverage:native` (JaCoCo for Java/Kotlin, cargo-llvm-cov for Rust, including isolated S3 fixtures).
- **Optional hooks:** enable with `git config core.hooksPath .githooks`.
- **Install:** `pnpm install`
- **Frontend dev:** `pnpm dev:frontend` (port 1420)
- **Backend dev:** `pnpm dev:backend` (port 41920)
- **Tauri dev:** `CARGO_BUILD_JOBS=2 pnpm dev:tauri`
- **Rust check:** `CARGO_BUILD_JOBS=2 cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

## Development and validation cadence
- Implement a coherent change before checking it. Do not run checks after every
  file edit. For nontrivial behavior, identify the relevant observable failures
  before implementation and select the smallest test level that detects them;
  a short note in the change is enough, not a separate planning document.
- Prefer integration or E2E for user workflows. Keep isolated tests for parsing,
  boundary validation, cancellation, rollback, and failure combinations that
  are difficult or costly to reproduce through the whole application. Do not
  require a new E2E test for every small change or prohibit regressions written
  after implementation.
- Tests must assert an observable behavior or a meaningful public contract.
  Avoid tests that only restate constants, object identity or mocked calls
  without a failure they would catch. Coverage targets do not justify adding
  low-signal tests. Delete or consolidate tests only when redundancy or lack
  of meaningful protection is demonstrated; do not delete by test category.
- At completion, run typecheck, lint and local tests for the affected package or
  product path once. For a bug, prefer one regression that reproduces the bug
  before fixing it when feasible.
  Repeat only after relevant changes, a failure, or a specific unresolved concern.
- Changes to shared contracts require checking affected consumers. Changes to
  Rust/JVM require the corresponding native checks. Driver, persistence and
  protocol fixes require integration of the affected path; reserve all-database
  integration for release or changes that affect all adapters.
- Required integration scenarios must run: a missing fixture or prerequisite
  must fail the integration gate rather than silently skip. Optional external
  tests may skip in the ordinary local suite; report those skips accurately.
- Integration/E2E runs must retain repeatable evidence: command, commit and
  working-tree state, tool/fixture versions, scenario results and skips, and
  relevant logs. Generate this automatically; do not add manual artifact work
  to routine development. Never include production credentials or data.
- Desktop tests currently use Vitest/jsdom; backend HTTP tests may use an
  in-memory adapter. Real database/JDBC integration is a separate path. These
  are not a complete UI -> Tauri -> sidecars -> database E2E suite, and must
  not be cited as equivalent coverage when removing tests.
- Limit local Rust builds to `CARGO_BUILD_JOBS=2`. Use
  `CARGO_BUILD_JOBS=2 pnpm dev:tauri` when starting the desktop for local validation.
- Precommit is intentionally lightweight: staged whitespace checks and lint.
  It does not run tests, global typecheck, Docker, or coverage. If hooks are
  enabled, let the hook run it instead of running it manually too.
- Before pushing completed code, run `pnpm verify:push` once. It resolves the
  current SonarCloud main-branch new-code baseline, generates TypeScript LCOV,
  Rust LCOV and JVM JaCoCo XML, and checks combined new-code line/condition
  coverage against Sonar's configured threshold. Do not substitute overall
  TypeScript coverage for new-code coverage.
- `verify:push` is a coverage preflight, not a substitute for the affected
  typecheck/lint checks above. Keep full multi-database integration and desktop
  lifecycle validation at release or when the affected path requires them;
  do not add them to the per-edit or precommit loop.
- The checkpoint reuses a successful result while tracked/nonignored code and
  configuration plus the Sonar baseline remain unchanged. `--force` regenerates
  coverage. Missing reports or changed production files absent from reports fail.
  It is a local estimate; only SonarCloud confirms the exact metrics and full gate.
- Prerequisites for native coverage: Java 21, Python 3, Docker, cargo-llvm-cov
  (`cargo install cargo-llvm-cov --locked`) and llvm-tools-preview
  (`rustup component add llvm-tools-preview`). No Sonar token is stored locally.
- If Sonar's baseline API is unavailable, use `pnpm verify:push --base <commit>`
  only with an explicitly established reference. Never silently use HEAD or the
  latest tag. `--reports-only` inspects existing reports and does not record a
  successful checkpoint; it is for diagnosis, not final validation.
- The pre-push hook uses the same cached checkpoint. Before a `v*` release tag,
  it also runs `scripts/pre-release.sh`. Manual release validation and the hook
  share the same successful checkpoint; do not rerun approved checks needlessly.
- Release validation tests PostgreSQL/MySQL/MariaDB/SQL Server/Oracle and JDBC
  through adapters and HTTP JSON-RPC, MongoDB through HTTP/SQL translation,
  and ODBC in an isolated SQLite container. Security regressions run with the
  real database fixtures. S3 coverage runs in an isolated container using a
  random loopback port. CI uses the same JVM/Rust coverage generator.
- CI runs full TypeScript coverage once and reuses its reports for SonarCloud.
  Release publication requires successful CI (including SonarCloud) for the exact
  tagged commit on the default branch, followed by tagged verification, real
  database integration and builds. Release integration runs independently of
  optional local hooks and does not repeat native coverage. Evidence is saved
  under `artifacts/release-integration` and uploaded even on failure.

Native build approvals in `pnpm-workspace.yaml#allowBuilds`: `esbuild`,
`@sveltejs/vite-plugin-svelte`, `oracledb`, and `odbc`. Svelte plugin approval is
stale/legacy; current frontend uses React, not Svelte.

## Conventions
- **Release versioning:** new user-visible functionality increments the minor
  version and resets patch (for example, MongoDB support: `0.5.x` → `0.6.0`).
  Releases containing only fixes increment patch (`0.6.0` → `0.6.1`). When
  features and fixes ship together, use the minor increment. Preserve release
  tags already pushed; a failed release does not justify overwriting its tag.
- **TypeScript:** strict, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `allowImportingTsExtensions`, target ES2022, ESNext modules, Bundler resolution;
  see `tsconfig.base.json`.
- **ESLint:** flat config with TypeScript-ESLint recommended rules.
- **React:** functional components and hooks; no experimental React 19 APIs.
- **Tests:** Node `--test ./path.test.ts` on Node 22 with TypeScript stripping;
  frontend uses Vitest/jsdom. Use each package's scripts as the source of truth.
- **Paths:** cross-package imports use `workspace:*` and `.ts` extensions.
- **Communication:** Tauri ↔ Node backend uses type-safe JSON-RPC over HTTP at
  `localhost:41920`; contracts live in `packages/backend/src/protocol.ts`.

## Current status
- Contextual autocomplete uses lexer context plus metadata. CTE names/columns are
  resolved through Calcite `/scope/resolve` and injected by backend `completion.get`.
- Backend exposes `query.cancel` and bounded `query.run` database row limits;
  adapters cancel active work where driver support exists.
- MCP Streamable HTTP is implemented in `packages/mcp-server`, with authenticated
  `/mcp` transport, bounded payloads, sessions, and UI bridge handlers.
- Frontend editor supports statement splitting, current/all execution, variables,
  backend completion, save, and SQL formatting via `sql-formatter` with configurable
  shortcuts. ResultsGrid supports
  sorting, global filtering, client pagination, CSV export, PK inline edits,
  Data/Messages/Plan tabs, and EXPLAIN.
- Local analysis runs in the Rust/DuckDB engine with dataset imports, bounded
  result handles, cancellation and export. S3 connections support bucket
  discovery and DuckLake mappings; MongoDB and ODBC are implemented paths.
- Keyring uses `@napi-rs/keyring`; development file fallback requires
  `OMNI_SQL_DEV_KEYRING_FILE` or `OMNI_SQL_DEV_KEYRING=1`.
- Connections restore from SQLite with keyring passwords and rehydrated adapters;
  frontend tabs, query history, and theme persist in `localStorage`.
- JVM sidecar isolates each CTE body with balanced `CteTextScanner` and parses it
  with Calcite, avoiding tolerant parsing of incomplete outer statements. Sidecar
  failure, timeout, or invalid JSON falls back to tier1 autocomplete.
- TODO: `CalciteSchemaAdapter` with real schema/catalog types, `SELECT *` expansion,
  and complete validation. Correlated subquery completion is supported.

## Memory persistida
- Use the configured persistent memory server when available; search for
  "Plano omni-sql" for earlier architecture context. If no memory tools are
  available, use the checked-in code/docs and state that limitation rather
  than assuming past decisions or installing a server.
- Releases do omni-sql costumam levar cerca de 20 minutos para concluir no
  GitHub Actions. Depois de disparar uma release, informe o link do workflow
  e não fique consultando o status repetidamente na mesma conversa; confira
  o resultado apenas quando o usuário pedir ou em uma tarefa posterior.

<!-- headroom:memory-instructions -->
## Memory

Use the `headroom_memory` MCP server for persistent cross-session knowledge
when its tools are available in the session.

**Before** answering questions about prior decisions, conventions, project context,
architecture, user preferences, org info, codenames, debugging history, or anything
from past sessions — call `memory_search` first.

**After** making durable decisions, discovering conventions, or learning important
facts — call `memory_save` to persist them for future sessions.

Memory is your first source of truth for anything not visible in the current conversation.
