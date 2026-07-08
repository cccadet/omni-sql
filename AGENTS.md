# AGENTS.md — omni-sql

One IDE for every database. Multi-database SQL IDE with intelligent
autocomplete (no LLM in v1). See `PROJECT_PLAN.md` for the full roadmap.

## Stack
- **Shell:** Tauri (Rust) — `apps/desktop/src-tauri`
- **Frontend:** TypeScript + Svelte 5 + Monaco Editor — `apps/desktop/src`
- **Backend:** Node (TypeScript) — HTTP JSON-RPC — `packages/backend`
- **Parser/Validator (Fase 3):** JVM sidecar (Kotlin) com Apache Calcite — TODO
- **Cache:** SQLite embutido (`better-sqlite3`) — TODO Fase 1
- **Credenciais:** `keyring` crate no Tauri — TODO Fase 1
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

## Estado atual (Fase 0)
- ✅ Toolchain local: Node 26, pnpm 11.10, rustup stable 1.96, tauri-cli 2.11.
- ✅ Monorepo com 5 pacotes TS + 1 Tauri shell que compila (`cargo check` ✅).
- ✅ Lexer tier1 do autocomplete cobre casos 1-6 da suíte (8 casos planejados).
- ✅ Smoke test E2E via JSON-RPC em `packages/backend/test/smoke.test.ts`.
- ✅ `pnpm verify` green (13 testes pass + 2 todo).
- ⏳ Fase 0 ainda: spike JVM sidecar / CI config.

## Próximas ações (quando continuar)
1. **CI config:** GitHub Actions workflow rodando `pnpm verify` + `cargo check` no `apps/desktop/src-tauri`. 
2. **Spike JVM sidecar (1-2 dias):** Kotlin/Gradle mínimo que expõe `/health`
   no HTTP para validar cold-start + manejo de pool antes de investir em Calcite.
3. **Fase 1:** SQLite cache com `last_synced_at` por entidade + API em memória
   (`getTablesBySchema`, etc.) — substitui o `relationsCache` em `handlers.ts`.
4. **Fase 2:** `packages/adapters-pg` real com `pg` driver + `information_schema`
   + `pg_catalog` para funções com overloads. Substitui `InMemoryAdapter` no
   `registerAdapter("postgres", ...)` de `packages/backend/src/handlers.ts`.

## Memory persistida
- Plano + decisões arquiteturais salvos no `mymem0ry` (project scope). Buscar
  por "Plano omni-sql" para recap se uma nova sessão começar do zero.