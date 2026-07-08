# AGENTS.md — omni-sql

One IDE for every database. Multi-database SQL IDE with intelligent
autocomplete (no LLM in v1). See `PROJECT_PLAN.md` for the full roadmap.

## Stack
- **Shell:** Tauri (Rust) — `apps/desktop/src-tauri`
- **Frontend:** TypeScript + Svelte 5 + Monaco Editor — `apps/desktop/src`
- **Backend:** Node (TypeScript) — HTTP JSON-RPC — `packages/backend`
- **Parser/Validator (Fase 3):** JVM sidecar (Kotlin) com Apache Calcite — colunas de CTE via `/scope/resolve` ✅; `CalciteSchemaAdapter` com schema/tipos reais TODO
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
services/jvm-sidecar             Kotlin/Gradle + Calcite: /health, /scope/resolve (colunas de CTE)
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
- ✅ UI de configuração de conexão: modal Svelte para host/porta/database/usuário/senha/SSL
  e botões adicionar/editar/remover na toolbar (`apps/desktop/src/lib/ConnectionDialog.svelte`).
- ✅ Keyring: backend Node usa `@napi-rs/keyring` (Windows/macOS/Linux) para senhas;
  fallback dev via arquivo quando `OMNI_SQL_DEV_KEYRING_FILE`/`OMNI_SQL_DEV_KEYRING=1`.
- ✅ Persistência de conexões: lista de conexões é restaurada do SQLite no boot do backend,
  com senhas recuperadas do keyring e adaptadores reidratados automaticamente.

## Fase 3 — Calcite (colunas de CTE)
- ✅ **Apache Calcite** adicionado a `services/jvm-sidecar/build.gradle.kts`
  (`org.apache.calcite:calcite-core:1.37.0`); fat-jar exclui `META-INF/*.SF|RSA|DSA|EC`
  (dependências assinadas do Calcite quebravam `java -jar` sem essa exclusão).
- ✅ **`dev.omnisql.sidecar.scope.ScopeResolver` + `/scope/resolve`:** resolve
  colunas de CTE sem tolerant-parse do statement inteiro — o corpo de cada CTE
  (`AS (...)`) é isolado via varredura textual balanceada (`CteTextScanner`) e
  parseado isoladamente pelo Calcite; a query externa (que costuma estar
  incompleta enquanto o usuário digita) nem entra no parser. Testes:
  `services/jvm-sidecar/src/test/kotlin/.../ScopeResolverTest.kt` (7 casos,
  incluindo a query real do bug reportado).
- ✅ **`packages/backend/src/sidecar-client.ts`:** chama `/scope/resolve` com
  timeout de 250ms; `completion.get` injeta as colunas resolvidas como
  `Relation`s sintéticas em `metaSourceOf` (CTEs sombreiam tabelas reais de
  mesmo nome), então o tier1 (`autocompleteTier1`) resolve `FROM cte` /
  `cte.<cursor>` sem mudança nenhuma no `engine.ts`. Falha do sidecar
  (indisponível/timeout/JSON inválido) sempre faz `completion.get` cair de
  volta pro tier1 puro — nunca quebra o autocomplete.
- ⏳ **Ainda TODO:** `CalciteSchemaAdapter` com schema/catálogo real (tipos de
  coluna, expansão de `SELECT *`, validação completa) — hoje `/scope/resolve`
  só infere NOMES de coluna via `SqlValidatorUtil.getAlias`, sintaticamente.
  Decisão Calcite vs ANTLR nem chegou a ser necessária: o parse tolerante do
  statement inteiro (`SqlParser.parseStatementFragment` + recovery custom)
  foi evitado inteiramente para este caso — só voltaria à mesa se precisarmos
  resolver escopo de subqueries correlacionadas (fora do que o bug pedia).

## Memory persistida
- Plano + decisões arquiteturais salvos no `mymem0ry` (project scope). Buscar
  por "Plano omni-sql" para recap se uma nova sessão começar do zero.