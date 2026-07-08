# AGENTS.md — omni-sql

One IDE for every database. Multi-database SQL IDE with intelligent
autocomplete (no LLM in v1). See `PROJECT_PLAN.md` for the full roadmap.

## Stack
- **Shell:** Tauri (Rust) — `apps/desktop/src-tauri`
- **Frontend:** TypeScript + Svelte 5 + Monaco Editor — `apps/desktop/src`
- **Backend:** Node (TypeScript) — HTTP JSON-RPC — `packages/backend`
- **Parser/Validator (Fase 3):** JVM sidecar (Kotlin) com Apache Calcite — TODO
- **Cache:** SQLite embutido (`node:sqlite` builtin, Node 22+) — `packages/metadata-cache`
- **Oracle:** thin mode por default (sem instant client) — TODO Fase 4
- **MongoDB:** deferido para v2

## Monorepo (pnpm workspaces)
```
apps/desktop                Tauri shell + Svelte + Monaco
apps/desktop/src-tauri      Rust shell (spawns Node backend sidecar)
packages/ts-types                Modelo unificado + contratos
packages/dialect-descriptors     Descritores por dialeto (lexer consome)
packages/adapters-core           Interface Adapter + InMemoryAdapter
packages/adapters-pg             Adaptador PostgreSQL real (driver `pg`)
packages/autocomplete-engine     Lexer tier1 + provider de autocomplete
packages/metadata-cache          Cache SQLite (`node:sqlite` builtin) + last_synced_at
packages/backend                 Node HTTP JSON-RPC (handlers + protocol)
services/jvm-sidecar             Spike Kotlin/Gradle mínimo (Fase 0) — Calcite em Fase 3
```

## Comandos
- **Typecheck:** `pnpm -r typecheck`
- **Lint:** `pnpm -r lint` (ESLint 9 flat config em `eslint.config.js`)
- **Test:** `pnpm -r test` (Node `--test`, sem jest/vitest)
- **Full verify:** `pnpm verify`  →  typecheck && lint && test
- **Install:** `pnpm install`  (esbuild é aprovado em `pnpm-workspace.yaml#onlyBuiltDependencies`)
- **Frontend dev (Vite standalone):** `pnpm dev:frontend`  (\>porta 1420)
- **Backend dev (HTTP JSON-RPC):** `pnpm dev:backend`  (\>porta 41920)
- **Tauri dev (full desktop):** `pnpm dev:tauri`  (spawns backend + Vite together)
- **Rust check:** `cd apps/desktop/src-tauri && cargo check`

## Convenções
- **TypeScript:** strict, noUncheckedIndexedAccess, noImplicitOverride,
  allowImportingTsExtensions, target ES2022, module ESNext, moduleResolution
  Bundler. Ver `tsconfig.base.json`.
- **ESLint:** flat config (`eslint.config.js`), TypeScript-ESLint recommended.
- **Svelte:** runes mode (5.x). Tudo o que é reativo declara com `$state`/`$props`/`$bindable`/`$effect`.
- **Node tests:** `node --test --import ./path.test.ts` — sem runner externo.
- **Paths:** imports entre pacotes usam sempre `workspace:*` e a extensão `.ts`.
- **Comunicação:** Tauri ↔ Node backend = JSON-RPC sobre HTTP localhost:41920.
  Contratos em `packages/backend/src/protocol.ts` (RpcRouter type-safe).

## Estado atual (F0 ✅ + F1 ✅ + F2 ✅ + CI ✅ + Spike JVM ✅)
- ✅ Toolchain local: Node 26, pnpm 11.10, rustup stable 1.96, tauri-cli 2.11.4.
- ✅ Monorepo com 8 pacotes TS + 1 Tauri shell Rust + 1 spike Kotlin sidecar.
- ✅ Lexer tier1 do autocomplete cobre casos 1-6 da suíte (8 casos planejados).
- ✅ Smoke test E2E via JSON-RPC em `packages/backend/test/smoke.test.ts`.
- ✅ `packages/metadata-cache` via `node:sqlite` builtin (não `better-sqlite3` —
  este último quebra em Node 26 por mudanças no V8).
- ✅ `packages/adapters-pg` real: driver `pg`, `information_schema` + `pg_catalog`,
  pool de 4 conns, server-side cursor para runQuery, `EXPLAIN (FORMAT JSON)`.
- ✅ `services/jvm-sidecar` spike Kotlin/Gradle mínimo com `/health` HTTP na
  porta 41921 — bootstrap via `bootstrap.sh` (baixa gradle-wrapper).
- ✅ CI GitHub Actions: `pnpm verify` + `cargo check` com cache de crates.
- ✅ `pnpm verify` green (0 erros, ~25 testes pass + 2 todo + 1 skip condicional).
- ⏳ Pendente: `keyring` crate no Tauri para credenciais (TODO Fase 1顺手).

## Próximas ações (quando continuar — Fase 3)
1. **Destravar Gradle local:** `pacman -S gradle` e validar
   `services/jvm-sidecar/bootstrap.sh` + `./gradlew run`.
2. **Adicionar Apache Calcite** ao `services/jvm-sidecar/build.gradle.kts`
   (dependência `org.apache.calcite:calcite-core` 1.37+).
3. **Spike de 5 dias: tolerant-vs-fragment usando `SqlParser.parseStatementFragment`
   + error recovery custom para extrair aliases/CTE/subquery do `SqlSelect`.**
4. **Decisão final: Calcite vs ANTLR** (ANTLR vira fallback se tolerância falhar).
5. **Endpoint HTTP `/scope/resolve`** no sidecar se Calcite vencer:
   recebe `(query, cursorOffset, schemaId)` → `{clause, availableAliases, availableColumns}`.
6. **Tiering engine TS:** tier1 já em `packages/autocomplete-engine`;
   adicionar tier2 debounced ~80ms chama sidecar via HTTP para casos 7-8.

## Memory persistida
- Plano + decisões arquiteturais salvos no `mymem0ry` (project scope). Buscar
  por "Plano omni-sql" para recap se uma nova sessão começar do zero.