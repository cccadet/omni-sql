import type { Pool, PoolClient, QueryResult as PgQueryResult } from "pg";
import type {
  Column,
  ConnectionConfig,
  Constraint,
  FunctionDef,
  FunctionOverload,
  FunctionParameter,
  IndexInfo,
  QueryResult,
  QueryResultColumn,
  Relation,
} from "@omni-sql/ts-types";
import type { RowUpdateSpec } from "@omni-sql/adapters-core";
import { postgresDescriptor, quoteIdentifier } from "@omni-sql/dialect-descriptors";

// ─────────────────────────── Types

export interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  ordinal_position: number;
  is_pk: boolean;
  fk_schema: string | null;
  fk_table: string | null;
  fk_column: string | null;
}

export interface RelationRow {
  table_schema: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW";
}

export interface FunctionRow {
  schema: string;
  name: string;
  arg_names: string[] | null;
  arg_types: string[];
  arg_modes: ("i" | "o" | "b" | "v" | "t")[];
  ret_type: string;
}

// ─────────────────────────── Introspection SQL

const RELATIONS_SQL = `
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND table_type IN ('BASE TABLE', 'VIEW')
ORDER BY table_schema, table_name
`;

const SCHEMA_NAMES_SQL = `
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY schema_name
`;

/** Lista os nomes de schema disponíveis sem introspectar tabelas/colunas — usado pela UI para deixar o usuário escolher o que indexar. */
export async function listSchemaNames(client: PoolClient): Promise<readonly string[]> {
  const { rows } = await client.query<{ schema_name: string }>(SCHEMA_NAMES_SQL);
  return rows.map((r) => r.schema_name);
}

const COLUMNS_SQL = `
SELECT
  c.table_schema, c.table_name, c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default,
  c.ordinal_position,
  (pk.column_name IS NOT NULL) AS is_pk,
  fk.ud_schema   AS fk_schema,
  fk.ud_table    AS fk_table,
  fk.ud_column   AS fk_column
FROM information_schema.columns c
LEFT JOIN (
  SELECT kcu.table_schema, kcu.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
) pk ON pk.table_schema = c.table_schema
    AND pk.table_name   = c.table_name
    AND pk.column_name  = c.column_name
LEFT JOIN (
  SELECT kcu.table_schema, kcu.table_name, kcu.column_name,
         ccu.table_schema AS ud_schema,
         ccu.table_name   AS ud_table,
         ccu.column_name  AS ud_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema   = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
) fk ON fk.table_schema = c.table_schema
    AND fk.table_name   = c.table_name
    AND fk.column_name  = c.column_name
WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY c.table_schema, c.table_name, c.ordinal_position
`;

const FUNCTIONS_SQL = `
SELECT
  n.nspname          AS schema,
  p.proname          AS name,
  pg_get_function_arguments(p.oid)         AS arg_summary,
  COALESCE(p.proallargtypes, p.proargtypes::oidvector::oid[]) AS arg_oids,
  COALESCE(p.proallargtypes, p.proargtypes::oidvector::oid[]),
  proargmodes,
  proargnames,
  pg_get_function_result(p.oid)           AS ret_summary,
  t.typname           AS ret_typname
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_type t      ON p.prorettype   = t.oid
WHERE n.nspname = $1
  AND p.prokind = 'f'
ORDER BY schema, name
`;

const INDEXES_SQL = `
SELECT
  ic.relname AS index_name,
  ix.indisunique AS is_unique,
  ix.indisprimary AS is_primary,
  a.attname AS column_name,
  k.ord AS ordinal
FROM pg_index ix
JOIN pg_class ic ON ic.oid = ix.indexrelid
JOIN pg_class tc ON tc.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = tc.relnamespace
JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = k.attnum
WHERE n.nspname = $1 AND tc.relname = $2
ORDER BY ic.relname, k.ord
`;

export interface IndexRow {
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  column_name: string;
  ordinal: number;
}

/** Índices de uma tabela — consulta ao vivo (não faz parte da introspecção em lote). */
export async function listIndexesViaPool(pool: Pool, schema: string, table: string): Promise<IndexInfo[]> {
  const { rows } = await pool.query<IndexRow>(INDEXES_SQL, [schema, table]);
  const byName = new Map<string, IndexRow[]>();
  for (const r of rows) {
    if (!byName.has(r.index_name)) byName.set(r.index_name, []);
    byName.get(r.index_name)!.push(r);
  }
  return [...byName.entries()].map(([name, cols]) => ({
    name,
    unique: cols[0]!.is_unique,
    primary: cols[0]!.is_primary,
    columns: cols.slice().sort((a, b) => a.ordinal - b.ordinal).map((c) => c.column_name),
  }));
}

/** Texto de definição (`CREATE VIEW`/`CREATE FUNCTION`) — consulta ao vivo via catálogo. */
export async function getDefinitionViaPool(
  pool: Pool,
  kind: "view" | "function",
  schema: string,
  name: string,
): Promise<string> {
  if (kind === "view") {
    const { rows } = await pool.query<{ definition: string }>(
      `SELECT view_definition AS definition FROM information_schema.views WHERE table_schema = $1 AND table_name = $2`,
      [schema, name],
    );
    if (rows.length === 0) throw new Error(`view não encontrada: ${schema}.${name}`);
    return `CREATE OR REPLACE VIEW ${quoteIdentifier(postgresDescriptor, schema)}.${quoteIdentifier(postgresDescriptor, name)} AS\n${rows[0]!.definition}`;
  }
  const { rows } = await pool.query<{ def: string }>(
    `SELECT pg_get_functiondef(p.oid) AS def
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = $1 AND p.proname = $2
     ORDER BY p.oid`,
    [schema, name],
  );
  if (rows.length === 0) throw new Error(`função não encontrada: ${schema}.${name}`);
  return rows.map((r) => r.def).join("\n\n");
}

// ─────────────────────────── Introspection routines

export async function introspectSchemas(
  client: PoolClient,
  schemaFilter?: readonly string[],
): Promise<ReadonlyArray<readonly [number, string, readonly Relation[]]>> {
  // Filtro em memória (em vez de parametrizar RELATIONS_SQL/COLUMNS_SQL) —
  // mantém as queries multi-linha existentes intactas; o ganho real é pular
  // `listFunctionsPerSchema` (uma query por schema) para os excluídos.
  const allow = schemaFilter && schemaFilter.length > 0 ? new Set(schemaFilter) : null;
  const rels = (await client.query<RelationRow>(RELATIONS_SQL)).rows;
  const bySchema = new Map<string, RelationRow[]>();
  for (const r of rels) {
    if (allow && !allow.has(r.table_schema)) continue;
    if (!bySchema.has(r.table_schema)) bySchema.set(r.table_schema, []);
    bySchema.get(r.table_schema)!.push(r);
  }
  const cols = (await client.query<ColumnRow>(COLUMNS_SQL)).rows;
  const colsByTable = new Map<string, ColumnRow[]>();
  for (const c of cols) {
    if (allow && !allow.has(c.table_schema)) continue;
    const key = `${c.table_schema}.${c.table_name}`;
    if (!colsByTable.has(key)) colsByTable.set(key, []);
    colsByTable.get(key)!.push(c);
  }
  const out: Array<readonly [number, string, readonly Relation[]]> = [];
  let i = 0;
  for (const [schemaName, schemaRels] of bySchema) {
    const relations: Relation[] = schemaRels.map((r) => {
      const rcols = colsByTable.get(`${schemaName}.${r.table_name}`) ?? [];
      const columns: Column[] = rcols.map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        nullable: c.is_nullable === "YES",
        isPrimaryKey: c.is_pk,
        ordinalPosition: c.ordinal_position,
        ...(c.column_default !== null ? { defaultValue: c.column_default } : {}),
        ...(c.fk_schema
          ? {
              foreignKeyTo: {
                schema: c.fk_schema,
                table: c.fk_table!,
                column: c.fk_column!,
              },
            }
          : {}),
      }));
      const constraints: Constraint[] = [];
      // PK
      const pkCols = rcols.filter((c) => c.is_pk).map((c) => c.column_name);
      if (pkCols.length) {
        constraints.push({ name: "pk", kind: "primary", columns: pkCols });
      }
      // FK (um por coluna — simplificação F2; Fase 4 pode agrupar)
      for (const c of rcols) {
        if (c.fk_schema) {
          constraints.push({
            name: `fk_${c.column_name}`,
            kind: "foreign",
            columns: [c.column_name],
            references: {
              schema: c.fk_schema,
              table: c.fk_table!,
              column: c.fk_column!,
            },
          });
        }
      }
      return {
        schema: schemaName,
        name: r.table_name,
        kind: r.table_type === "VIEW" ? "view" : "table",
        columns,
        constraints,
      };
    });
    out.push([i++, schemaName, relations] as const);
  }
  return out;
}

export async function listFunctionsPerSchema(
  client: PoolClient,
  schema: string,
): Promise<FunctionDef[]> {
  const rows = (
    await client.query<{
      schema: string;
      name: string;
      arg_names: string[] | null;
      arg_types: string[];
      arg_modes: ("i" | "o" | "b" | "v" | "t")[];
      ret_type: string;
    }>(FUNCTIONS_SQL, [schema])
  ).rows;

  const byName = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name)!.push(r);
  }
  const out: FunctionDef[] = [];
  for (const [name, overloads] of byName) {
    const overloadsBuilt: FunctionOverload[] = overloads.map((row) => {
      const params: FunctionParameter[] = (row.arg_names ?? []).map((n, i) => ({
        name: n,
        dataType: row.arg_types[i] ?? "unknown",
        mode: row.arg_modes[i] === "o" ? "out" : row.arg_modes[i] === "b" ? "inout" : "in",
        ordinalPosition: i,
      }));
      return { parameters: params, returnType: row.ret_type };
    });
    out.push({ schema, name, overloads: overloadsBuilt });
  }
  return out;
}

// ─────────────────────────── Query execution

export async function runQueryViaPool(
  pool: Pool,
  sql: string,
  limit: number,
  onPid?: (pid: number) => void,
): Promise<QueryResult> {
  const t0 = Date.now();
  // Use a named cursor on a borrowed client for server-side pagination.
  const client = await pool.connect();
  // `processID` é o PID do backend Postgres desta conexão (setado pelo driver
  // no handshake, não documentado no tipo `PoolClient` mas estável em runtime)
  // — é a única forma de cancelar a query via `pg_cancel_backend` de outra conexão.
  onPid?.((client as unknown as { processID: number }).processID);
  try {
    const cursorName = `omni_q_${Math.random().toString(36).slice(2)}`;
    try {
      await client.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${sql}`);
    } catch {
      // Not every statement can back a cursor (SHOW, SET, DDL, plain DML
      // without RETURNING, etc.) — fall back to running it directly.
      const res = await client.query(sql);
      const cols: QueryResultColumn[] = (res.fields ?? []).map((f) => ({
        name: f.name,
        dataType: mapPgOidToDataType(f.dataTypeID),
        nullable: true,
      }));
      const rows = res.rows.map((r) =>
        cols.map((c) => (r as Record<string, unknown>)[c.name] ?? null),
      );
      return {
        columns: cols,
        rows: rows.slice(0, limit),
        rowsAffected: cols.length === 0 ? res.rowCount ?? undefined : undefined,
        rowsMoreAvailable: rows.length > limit,
        elapsedMs: Date.now() - t0,
      };
    }
    const rowsFetched: unknown[][] = [];
    let cols: QueryResultColumn[] = [];
    let moreAvailable = false;
    const batchSize = Math.min(limit, 1000);
    let res: PgQueryResult;
    while (true) {
      res = await client.query(`FETCH ${batchSize} FROM ${cursorName}`);
      if (res.rows.length === 0) break;
      if (cols.length === 0 && res.fields.length > 0) {
        cols = res.fields.map((f) => ({
          name: f.name,
          dataType: mapPgOidToDataType(f.dataTypeID),
          nullable: true,
        }));
      }
      for (const r of res.rows) {
        rowsFetched.push(cols.map((c) => (r as Record<string, unknown>)[c.name] ?? null));
      }
      if (rowsFetched.length >= limit) {
        // Check if more remain.
        const peek = await client.query(`FETCH 1 FROM ${cursorName}`);
        if (peek.rows.length > 0) moreAvailable = true;
        break;
      }
    }
    await client.query(`CLOSE ${cursorName}`);
    return {
      columns: cols,
      rows: rowsFetched.slice(0, limit),
      rowsMoreAvailable: moreAvailable,
      elapsedMs: Date.now() - t0,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * `UPDATE` de uma linha via PK, parametrizado (`$1, $2, ...`) — nunca
 * interpola valores diretamente no SQL. `spec.where`/`spec.set` já vêm
 * validados pela camada de backend (colunas reais, `where` cobrindo
 * exatamente a PK); aqui só quotamos identificadores e montamos os binds.
 */
export async function updateRowViaPool(pool: Pool, spec: RowUpdateSpec): Promise<number> {
  const setEntries = Object.entries(spec.set);
  const whereEntries = Object.entries(spec.where);
  if (setEntries.length === 0) throw new Error("updateRow: nada para atualizar (set vazio)");
  if (whereEntries.length === 0) throw new Error("updateRow: where vazio (sem PK para localizar a linha)");

  const values: unknown[] = [];
  const setClause = setEntries
    .map(([col, val]) => {
      values.push(val);
      return `${quoteIdentifier(postgresDescriptor, col)} = $${values.length}`;
    })
    .join(", ");
  const whereClause = whereEntries
    .map(([col, val]) => {
      values.push(val);
      return `${quoteIdentifier(postgresDescriptor, col)} = $${values.length}`;
    })
    .join(" AND ");
  const tableRef = spec.schema
    ? `${quoteIdentifier(postgresDescriptor, spec.schema)}.${quoteIdentifier(postgresDescriptor, spec.table)}`
    : quoteIdentifier(postgresDescriptor, spec.table);

  const client = await pool.connect();
  try {
    const res = await client.query(`UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`, values);
    return res.rowCount ?? 0;
  } finally {
    client.release();
  }
}

function mapPgOidToDataType(oid: number): string {
  // libpg returns numeric OIDs; text fallback for unknown. Keep numeric types
  // surface-friendly for fast scanning by UI later.
  const map: Record<number, string> = {
    16: "boolean",
    17: "bytea",
    20: "bigint",
    21: "smallint",
    23: "integer",
    25: "text",
    700: "real",
    701: "double",
    1043: "varchar",
    1082: "date",
    1114: "timestamp",
    1184: "timestamptz",
    1700: "numeric",
    2950: "uuid",
    3802: "jsonb",
    114: "json",
  };
  return map[oid] ?? `oid:${oid}`;
}

export type { Pool, PoolClient, ConnectionConfig };
