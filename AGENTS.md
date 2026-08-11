# AGENTS.md — omni-sql

One IDE for every database. Multi-database SQL IDE with contextual autocomplete
(no LLM in v1). See `PROJECT_PLAN.md` for roadmap.

## Stack
- **Shell:** Tauri (Rust) — `apps/desktop/src-tauri`
- **Frontend:** TypeScript + React 19 + Fluent UI React v9 + Monaco — `apps/desktop/src`
- **Backend:** Node/TypeScript HTTP JSON-RPC — `packages/backend`
- **MCP:** stdio and Streamable HTTP — `packages/mcp-server`; backend bridge also serves `/mcp`
- **Parser/scope:** Kotlin JVM sidecar with Apache Calcite; CTE scope via `/scope/resolve`
- **Cache:** SQLite builtin `node:sqlite` — `packages/metadata-cache`
- **Drivers:** PostgreSQL `pg`; MySQL/MariaDB `mysql2/promise`; SQL Server `mssql`/Tedious;
  Oracle `oracledb` thin mode; generic JDBC adapter also present
- PostgreSQL metadata uses `information_schema` and `pg_catalog`; query execution uses
  server-side cursors and `EXPLAIN (FORMAT JSON)`. SQL Server plans use `SET SHOWPLAN_XML`
  in a separate transaction.
- **MongoDB:** deferred to v2

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
packages/autocomplete-engine Lexer and contextual autocomplete provider
packages/metadata-cache      SQLite metadata cache and `last_synced_at`
packages/backend             Node HTTP JSON-RPC handlers and protocol
packages/mcp-server          MCP stdio/Streamable HTTP server
services/jvm-sidecar         Kotlin/Gradle + Calcite: `/health`, `/scope/resolve`
```

## Commands
- **Package manager:** pnpm 11.17.0 (`package.json#packageManager`)
- **Typecheck:** `pnpm -r typecheck`
- **Lint:** `pnpm -r lint` (ESLint 9 flat config in `eslint.config.js`)
- **Test:** `pnpm -r test` (Node `--test` for backend/packages; Vitest for `apps/desktop`)
- **Full verify:** `pnpm verify` (typecheck, lint, test)
- **Install:** `pnpm install`
- **Frontend dev:** `pnpm dev:frontend` (port 1420)
- **Backend dev:** `pnpm dev:backend` (port 41920)
- **Tauri dev:** `pnpm dev:tauri`
- **Rust check:** `cd apps/desktop/src-tauri && cargo check`

Native build approvals in `pnpm-workspace.yaml#allowBuilds`: `esbuild`,
`@sveltejs/vite-plugin-svelte`, and `oracledb`. Svelte plugin approval is
stale/legacy; current frontend uses React, not Svelte.

## Conventions
- **TypeScript:** strict, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `allowImportingTsExtensions`, target ES2022, ESNext modules, Bundler resolution;
  see `tsconfig.base.json`.
- **ESLint:** flat config with TypeScript-ESLint recommended rules.
- **React:** functional components and hooks; no experimental React 19 APIs.
- **Tests:** Node `--test --import ./path.test.ts`; frontend uses Vitest/jsdom.
- **Paths:** cross-package imports use `workspace:*` and `.ts` extensions.
- **Communication:** Tauri ↔ Node backend uses type-safe JSON-RPC over HTTP at
  `localhost:41920`; contracts live in `packages/backend/src/protocol.ts`.

## Current status
- Contextual autocomplete uses lexer context plus metadata. CTE names/columns are
  resolved through Calcite `/scope/resolve` and injected by backend `completion.get`;
  case 8 remains TODO.
- Backend exposes `query.cancel` and bounded `query.run` database row limits;
  adapters cancel active work where driver support exists.
- MCP Streamable HTTP is implemented in `packages/mcp-server`, with authenticated
  `/mcp` transport, bounded payloads, sessions, and UI bridge handlers.
- Frontend editor supports statement splitting, current/all execution, variables,
  backend completion, save, and SQL formatting via `sql-formatter` with configurable
  shortcuts. ResultsGrid supports
  sorting, global filtering, client pagination, CSV export, PK inline edits,
  Data/Messages/Plan tabs, and EXPLAIN.
- Keyring uses `@napi-rs/keyring`; development file fallback requires
  `OMNI_SQL_DEV_KEYRING_FILE` or `OMNI_SQL_DEV_KEYRING=1`.
- Connections restore from SQLite with keyring passwords and rehydrated adapters;
  frontend tabs, query history, and theme persist in `localStorage`.
- JVM sidecar isolates each CTE body with balanced `CteTextScanner` and parses it
  with Calcite, avoiding tolerant parsing of incomplete outer statements. Sidecar
  failure, timeout, or invalid JSON falls back to tier1 autocomplete.
- TODO: `CalciteSchemaAdapter` with real schema/catalog types, `SELECT *` expansion,
  and complete validation. Correlated subquery scope remains outside current scope.

## Memory persistida
- Plano + decisões arquiteturais salvos no `mymem0ry` (project scope). Buscar
  por "Plano omni-sql" para recap se uma nova sessão começar do zero.

<!-- headroom:memory-instructions -->
## Memory

Use the `headroom_memory` MCP server for persistent cross-session knowledge.

**Before** answering questions about prior decisions, conventions, project context,
architecture, user preferences, org info, codenames, debugging history, or anything
from past sessions — call `memory_search` first.

**After** making durable decisions, discovering conventions, or learning important
facts — call `memory_save` to persist them for future sessions.

Memory is your first source of truth for anything not visible in the current conversation.
