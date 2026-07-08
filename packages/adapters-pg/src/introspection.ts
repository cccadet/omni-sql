import type { Pool, PoolClient, QueryResult as PgQueryResult } from "pg";
import type {
  Column,
  ConnectionConfig,
  Constraint,
  FunctionDef,
  FunctionOverload,
  FunctionParameter,
  QueryResult,
  QueryResultColumn,
  Relation,
  Schema,
} from "@omni-sql/ts-types";

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
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND p.prokind = 'f'
ORDER BY schema, name
`;

// ─────────────────────────── Introspection routines

export async function introspectSchemas(
  client: PoolClient,
): Promise<ReadonlyArray<readonly [number, string, readonly Relation[]]>> {
  const rels = (await client.query<RelationRow>(RELATIONS_SQL)).rows;
  const bySchema = new Map<string, RelationRow[]>();
  for (const r of rels) {
    if (!bySchema.has(r.table_schema)) bySchema.set(r.table_schema, []);
    bySchema.get(r.table_schema)!.push(r);
  }
  const cols = (await client.query<ColumnRow>(COLUMNS_SQL)).rows;
  const colsByTable = new Map<string, ColumnRow[]>();
  for (const c of cols) {
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
): Promise<QueryResult> {
  const t0 = Date.now();
  // Use a named cursor on a borrowed client for server-side pagination.
  const client = await pool.connect();
  try {
    const cursorName = `omni_q_${Math.random().toString(36).slice(2)}`;
    await client.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${sql}`);
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

// Re-export Schema helpers used by adapter.
export function emptySchemas(): Schema[] {
  return [];
}

export type { Pool, PoolClient, ConnectionConfig };