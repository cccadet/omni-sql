# omni-sql — One IDE for every database.

Multi-database SQL IDE with intelligent autocomplete (no LLM in v1).

## Stack
- **Shell:** Tauri (Rust) — `apps/desktop`
- **Frontend:** TypeScript + Svelte + Monaco Editor — `apps/desktop/src`
- **Backend:** Node.js (TypeScript) — adapters relacionais, cache, query exec
- **Parser/Validator:** JVM sidecar (Kotlin) com Apache Calcite — `services/jvm-sidecar`
- **Cache:** SQLite embutido (`better-sqlite3`)
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
packages/ts-types              Modelo unificado + contratos
packages/adapters-core         Interface Adapter + adaptador pg
packages/adapters-mysql        (Fase 4)
packages/adapters-mariadb      (Fase 4)
packages/adapters-mssql        (Fase 4)
packages/adapters-oracle       (Fase 4)
packages/autocomplete-engine   Lexer tier1 + provider + tier2 sidecar client
packages/dialect-descriptors   Descritores por dialeto (consumidos pelo lexer)
services/jvm-sidecar          Kotlin + Apache Calcite + JDBC genérico (Fase 6)
```

## Fases
- **F0 Fundação:** monorepo, Tauri shell mínimo, Monaco + results grid mínimo,
  Adapter interface, smoke test Postgres (testcontainers).
- **F1 Modelo + cache:** ts-types + SQLite + last_synced_at/etag por entidade.
- **F2 PG + lexer tier1:** adaptador pg completo (information_schema + pg_catalog),
  lexer TS cobrindo casos 1-4 da suíte de 8. Casos 5-8 ficam `it.todo`.
- **F3 Calcite spike (5 dias):** tolerant-vs-fragment + extrair aliases/CTE/subquery
  do `SqlSelect`. Decisão Calcite vs ANTLR. Endpoint `/scope/resolve` no sidecar.
  Tiering engine TS: tier1 <5ms, tier2 sidecar debounced ~80ms com LRU.
- **F4 MySQL → MariaDB → SQL Server → Oracle.** Suíte 8/8 verde por banco.
- **F5 Funções com assinatura** (snippets Monaco, overloads separados) + `EXPLAIN` textual.
- **F6 JDBC genérico no sidecar** (best-effort, featureFlags, classloader isolado).
- **F7 ODBC** (tentar `node-odbc` direto antes da bridge JDBC-ODBC).
- **F9 Polimento:** P99<100ms com 10k tabelas, ordenação por relevância, ícones,
  tratamento de erro 4 categorias, history/recall, tabs multi-resultado, `EXPLAIN VISUAL`,
  suíte testcontainers (PG/MySQL/MariaDB/SQLServer/Oracle via gvenzl/oracle-xe).

## Suíte 8 casos — parser de escopo
1. `FROM`/`JOIN` → tabelas/views
2. `SELECT` sem FROM → funções + `*`
3. `SELECT ... FROM tabela` → colunas da tabela em escopo
4. Alias simples `FROM tabela t` → `t.` colunas
5. Múltiplos JOINs com aliases → colunas de todas em escopo
6. `WHERE`/`ON`/`GROUP BY`/`ORDER BY` → mesmas colunas
7. CTEs `WITH x AS (...)` → `x` disponível no main
8. Subqueries correlacionadas — escopo aninhado

## Spikes de risco (Fase 0, 1-2 dias cada)
1. JVM sidecar cold-start + IPC (lazy spawn + pool).
2. Calcite tolerant-vs-fragment (expande na Fase 3).
3. `oracledb` thin mode.

## Verificação pós-edição
```
pnpm -r typecheck && pnpm -r lint && pnpm test
```

## Riscos técnicos (em ordem)
1. Parser de escopo tolerante (Fase 3) — onde集中 maior esforço de engenharia.
2. ODBC (Fase 7) — maior incerteza sobre estabilidade de biblioteca/ponte.
3. Cobertura inconsistente de `DatabaseMetaData` em drivers JDBC customizados.