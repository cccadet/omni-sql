# omni-sql — One IDE for every database.

Multi-database SQL IDE with intelligent autocomplete (no LLM in v1).

## Stack
- **Shell:** Tauri (Rust) — `apps/desktop`
- **Frontend:** TypeScript + Svelte + Monaco Editor — `apps/desktop/src`
- **Backend:** Node.js (TypeScript) — adapters relacionais, cache, query exec
- **Parser/Validator:** JVM sidecar (Kotlin) com Apache Calcite — `services/jvm-sidecar`
  (colunas de CTE via `/scope/resolve` ✅; schema/tipos reais ainda TODO)
- **Cache:** SQLite embutido (`node:sqlite` builtin, Node 22+) — `packages/metadata-cache`
- **Credenciais:** `keyring` crate no Tauri (nunca em config/SQLite)
- **Oracle:** thin mode por default (sem instant client)
- **MongoDB:** deferido para v2

## Comunicação
- Tauri ↔ Node: JSON-RPC sobre stdin/IPC
- Node ↔ JVM sidecar: HTTP localhost

## Adapter interface (v1)
```
connect | test | introspect | listSchemas | listTables(schema)
       | listColumns(table) | listFunctions | runQuery(sql,limit)
       | explain(sql) | dialectDescriptor()
```
`dialectDescriptor`: keywords, statementSeparator, identifierQuoteChars,
nameLengthLimits.

## Monorepo (pnpm workspaces)
```
apps/desktop                    Tauri + Svelte + Monaco
apps/desktop/src-tauri          Rust shell (spawns Node backend sidecar)
packages/ts-types              Modelo unificado + contratos
packages/dialect-descriptors   Descritores por dialeto (consumidos pelo lexer)
packages/adapters-core         Interface Adapter + InMemoryAdapter
packages/adapters-pg           Adaptador PostgreSQL real (driver `pg`): information_schema + pg_catalog, pool, server-side cursor, EXPLAIN JSON
packages/metadata-cache        Cache SQLite (`node:sqlite` builtin) + last_synced_at por entidade
packages/autocomplete-engine   Lexer tier1 + provider de autocomplete
packages/backend               Node HTTP JSON-RPC (handlers + protocol + Adapter registry)
services/jvm-sidecar           Kotlin/Gradle + Calcite: /health, /scope/resolve (colunas de CTE) — porta 41921
# Fases subsequentes:
packages/adapters-mysql        (Fase 4)
packages/adapters-mariadb      (Fase 4)
packages/adapters-mssql        (Fase 4)
packages/adapters-oracle       (Fase 4)
```

## Fases
- **F0 Fundação ✅:** monorepo, Tauri shell mínimo, Monaco + results grid mínimo,
  Adapter interface, smoke test E2E via JSON-RPC (InMemoryAdapter), spike JVM
  sidecar Kotlin, CI GitHub Actions.
- **F1 Modelo + cache ✅:** `packages/ts-types` (modelo unificado) + `packages/metadata-cache`
  (SQLite via `node:sqlite`, `last_synced_at` por entidade, APIs em memória <2ms).
  Backend integrado: introspecção persiste no cache, lookups via índice em memória.
- **F2 PG + lexer tier1 ✅:** `packages/adapters-pg` real (driver `pg`, `information_schema`
  + `pg_catalog` para funções com overloads, pool 4 conns, server-side cursor,
  `EXPLAIN (FORMAT JSON)`). Registrado em `registerAdapter("postgres", pgAdapterFactory)`.
  Lexer TS em `packages/autocomplete-engine` cobre 6 dos 8 casos da suíte (1-6 ✅,
  7-8 ficam `it.todo` para Fase 3 via sidecar).
- **F3 Calcite (colunas de CTE) ✅:** `calcite-core` em `services/jvm-sidecar`,
  endpoint `/scope/resolve` (`ScopeResolver.kt`) extrai colunas de `WITH x AS
  (...)` parseando cada corpo isoladamente (sem tolerant-vs-fragment do
  statement inteiro — evitado deliberadamente, ver `AGENTS.md`). Tiering:
  `packages/backend/src/sidecar-client.ts` chama o sidecar com timeout de
  250ms antes do tier1 síncrono; falha cai de volta pro tier1 puro.
  Subqueries correlacionadas (caso 8) seguem fora de escopo.
- **F4 MySQL → MariaDB → SQL Server → Oracle.** Suíte 8/8 verde por banco.
- **F5 Funções com assinatura** (snippets Monaco, overloads separados) + `EXPLAIN` textual
  (`Adapter.explain` já retorna JSON; falta plugar Monaco e visual tree).
- **F6 JDBC genérico no sidecar** (best-effort, featureFlags, classloader isolado).
- **F7 ODBC** (tentar `node-odbc` direto antes da bridge JDBC-ODBC).
- **F9 Polimento:** P99<100ms com 10k tabelas, ordenação por relevância, ícones,
  tratamento de erro 4 categorias, history/recall, tabs multi-resultado, `EXPLAIN VISUAL`,
  suíte testcontainers (PG/MySQL/MariaDB/SQLServer/Oracle via `gvenzl/oracle-xe`).

## Suíte 8 casos — parser de escopo
1. `FROM`/`JOIN` → tabelas/views
2. `SELECT` sem FROM → funções + `*`
3. `SELECT ... FROM tabela` → colunas da tabela em escopo
4. Alias simples `FROM tabela t` → `t.` colunas
5. Múltiplos JOINs com aliases → colunas de todas em escopo
6. `WHERE`/`ON`/`GROUP BY`/`ORDER BY` → mesmas colunas
7. ✅ CTEs `WITH x AS (...)` → `x` disponível no main, colunas via `/scope/resolve` (Calcite)
8. ⏳ Subqueries correlacionadas — escopo aninhado

## Spikes de risco (Fase 0, 1-2 dias cada)
1. ✅ JVM sidecar cold-start + IPC (`/health` + `/scope/resolve` em `services/jvm-sidecar`;
   gradle-wrapper via `bootstrap.sh`; jar buildado e testado com `./gradlew jar`/`test`).
2. ✅ Calcite — tolerant-vs-fragment do statement inteiro acabou não sendo necessário: o
   caso 7 (colunas de CTE) é resolvido parseando só o corpo de cada CTE isoladamente
   (ver `AGENTS.md`). Escopo aninhado (caso 8) continuaria precisando do spike original.
3. ⏳ `oracledb` thin mode (validar em Fase 4).

## Verificação pós-edição
```
pnpm -r typecheck && pnpm -r lint && pnpm test
```

## Riscos técnicos (em ordem)
1. Parser de escopo tolerante (Fase 3) — onde se concentra o maior esforço de engenharia.
2. ODBC (Fase 7) — maior incerteza sobre estabilidade de biblioteca/ponte.
3. Cobertura inconsistente de `DatabaseMetaData` em drivers JDBC customizados.