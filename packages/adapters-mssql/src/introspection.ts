import type { ConnectionPool, Request } from "mssql";
import type {
  Column,
  Constraint,
  FunctionDef,
  FunctionOverload,
  FunctionParameter,
  IndexInfo,
  QueryResult,
  QueryResultColumn,
  Relation,
} from "@omni-sql/ts-types";
import type { RowInsertSpec, RowUpdateSpec } from "@omni-sql/adapters-core";
import { quoteIdentifier, sqlserverDescriptor } from "@omni-sql/dialect-descriptors";

// ─────────────────────────── Types

export interface RelationRow {
  table_schema: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW";
}

export interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  ordinal_position: number;
  is_pk: number;
  fk_schema: string | null;
  fk_table: string | null;
  fk_column: string | null;
}

export interface FunctionRow {
  schema: string;
  name: string;
  ret_type: string | null;
}

export interface ParameterRow {
  specific_name: string;
  parameter_name: string | null;
  data_type: string | null;
  parameter_mode: "IN" | "OUT" | "INOUT" | null;
  ordinal_position: number;
}

// Schemas de sistema/embutidos — nunca interessam ao usuário final.
const SYSTEM_SCHEMAS_SQL = [
  "sys", "INFORMATION_SCHEMA", "guest", "db_owner", "db_accessadmin",
  "db_securityadmin", "db_ddladmin", "db_backupoperator", "db_datareader",
  "db_datawriter", "db_denydatareader", "db_denydatawriter",
].map((s) => `'${s}'`).join(", ");

const SCHEMA_NAMES_SQL = `
SELECT s.name AS schema_name
FROM sys.schemas s
WHERE s.name NOT IN (${SYSTEM_SCHEMAS_SQL})
ORDER BY s.name
`;

/** Lista os nomes de schema disponíveis sem introspectar tabelas/colunas — usado pela UI para escolher o que indexar. */
export async function listSchemaNames(pool: ConnectionPool): Promise<readonly string[]> {
  const rows = await execRows<{ schema_name: string }>(pool, SCHEMA_NAMES_SQL);
  return rows.map((r) => r.schema_name);
}

const RELATIONS_SQL = `
SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, TABLE_TYPE AS table_type
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
ORDER BY TABLE_SCHEMA, TABLE_NAME
`;

// SQL Server expõe as mesmas views ANSI que o Postgres (INFORMATION_SCHEMA.*),
// mas sem o atalho de MySQL (KEY_COLUMN_USAGE.referenced_*): a FK precisa
// passar por REFERENTIAL_CONSTRAINTS até achar a UNIQUE_CONSTRAINT_NAME
// referenciada, daí então CONSTRAINT_COLUMN_USAGE para o nome da coluna alvo.
const COLUMNS_SQL = `
SELECT
  c.TABLE_SCHEMA AS table_schema, c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name,
  c.DATA_TYPE AS data_type,
  c.IS_NULLABLE AS is_nullable,
  c.COLUMN_DEFAULT AS column_default,
  c.ORDINAL_POSITION AS ordinal_position,
  CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk,
  fk.ud_schema AS fk_schema,
  fk.ud_table  AS fk_table,
  fk.ud_column AS fk_column
FROM INFORMATION_SCHEMA.COLUMNS c
LEFT JOIN (
  SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
  JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
   AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
  WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA
    AND pk.TABLE_NAME   = c.TABLE_NAME
    AND pk.COLUMN_NAME  = c.COLUMN_NAME
LEFT JOIN (
  SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME,
         ccu.TABLE_SCHEMA AS ud_schema, ccu.TABLE_NAME AS ud_table, ccu.COLUMN_NAME AS ud_column
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
  JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
    ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
  JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND rc.CONSTRAINT_SCHEMA = tc.TABLE_SCHEMA
  JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu
    ON ccu.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME
  WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
) fk ON fk.TABLE_SCHEMA = c.TABLE_SCHEMA
    AND fk.TABLE_NAME   = c.TABLE_NAME
    AND fk.COLUMN_NAME  = c.COLUMN_NAME
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
`;

// SQL Server não tem overload de função (uma assinatura por nome).
const FUNCTIONS_SQL = `
SELECT ROUTINE_SCHEMA AS [schema], ROUTINE_NAME AS name, DATA_TYPE AS ret_type
FROM INFORMATION_SCHEMA.ROUTINES
WHERE ROUTINE_SCHEMA = @schema AND ROUTINE_TYPE = 'FUNCTION'
ORDER BY ROUTINE_NAME
`;

const PARAMETERS_SQL = `
SELECT p.SPECIFIC_NAME AS specific_name, p.PARAMETER_NAME AS parameter_name,
       p.DATA_TYPE AS data_type, p.PARAMETER_MODE AS parameter_mode, p.ORDINAL_POSITION AS ordinal_position
FROM INFORMATION_SCHEMA.PARAMETERS p
WHERE p.SPECIFIC_SCHEMA = @schema
  AND p.SPECIFIC_NAME IN (
    SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_SCHEMA = @schema AND ROUTINE_TYPE = 'FUNCTION'
  )
ORDER BY p.SPECIFIC_NAME, p.ORDINAL_POSITION
`;

// INFORMATION_SCHEMA não expõe índices — usa o catálogo `sys.*` (equivalente
// ao `pg_catalog`/`all_indexes` que Postgres/Oracle já usam).
const INDEXES_SQL = `
SELECT i.name AS index_name, i.is_unique AS is_unique, i.is_primary_key AS is_primary,
       c.name AS column_name, ic.key_ordinal AS ordinal
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
JOIN sys.tables t ON t.object_id = i.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = @schema AND t.name = @table AND i.name IS NOT NULL
ORDER BY i.name, ic.key_ordinal
`;

export interface IndexRow {
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  column_name: string;
  ordinal: number;
}

/** Índices de uma tabela — consulta ao vivo (não faz parte da introspecção em lote). */
export async function listIndexesViaPool(pool: ConnectionPool, schema: string, table: string): Promise<IndexInfo[]> {
  const rows = await execRows<IndexRow>(pool, INDEXES_SQL, { schema, table });
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

/**
 * Texto de definição (`CREATE VIEW`/`CREATE FUNCTION`) — `OBJECT_DEFINITION`
 * devolve o texto original do objeto no catálogo, unificado para os dois
 * `kind`s (diferente de Postgres/Oracle, que precisam reconstruir o texto).
 */
export async function getDefinitionViaPool(
  pool: ConnectionPool,
  kind: "view" | "function",
  schema: string,
  name: string,
): Promise<string> {
  const ref = `${quoteIdentifier(sqlserverDescriptor, schema)}.${quoteIdentifier(sqlserverDescriptor, name)}`;
  const rows = await execRows<{ definition: string | null }>(
    pool,
    `SELECT OBJECT_DEFINITION(OBJECT_ID(N'${ref.replace(/'/g, "''")}')) AS definition`,
  );
  const def = rows[0]?.definition;
  if (!def) throw new Error(`${kind === "view" ? "view" : "função"} não encontrada: ${schema}.${name}`);
  return def;
}

// ─────────────────────────── Introspection routines

export async function introspectSchemas(
  pool: ConnectionPool,
  schemaFilter?: readonly string[],
): Promise<ReadonlyArray<readonly [number, string, readonly Relation[]]>> {
  const allow = schemaFilter && schemaFilter.length > 0 ? new Set(schemaFilter) : null;
  const rels = await execRows<RelationRow>(pool, RELATIONS_SQL);
  const bySchema = new Map<string, RelationRow[]>();
  for (const r of rels) {
    if (allow && !allow.has(r.table_schema)) continue;
    if (!bySchema.has(r.table_schema)) bySchema.set(r.table_schema, []);
    bySchema.get(r.table_schema)!.push(r);
  }
  const cols = await execRows<ColumnRow>(pool, COLUMNS_SQL);
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
        isPrimaryKey: c.is_pk === 1,
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
      const pkCols = rcols.filter((c) => c.is_pk === 1).map((c) => c.column_name);
      if (pkCols.length) {
        constraints.push({ name: "pk", kind: "primary", columns: pkCols });
      }
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
      } satisfies Relation;
    });
    out.push([i++, schemaName, relations] as const);
  }
  return out;
}

export async function listFunctionsPerSchema(pool: ConnectionPool, schema: string): Promise<FunctionDef[]> {
  const fnRows = await execRows<FunctionRow>(pool, FUNCTIONS_SQL, { schema });
  if (fnRows.length === 0) return [];
  const paramRows = await execRows<ParameterRow>(pool, PARAMETERS_SQL, { schema });
  const paramsBySpecificName = new Map<string, ParameterRow[]>();
  for (const p of paramRows) {
    if (!paramsBySpecificName.has(p.specific_name)) paramsBySpecificName.set(p.specific_name, []);
    paramsBySpecificName.get(p.specific_name)!.push(p);
  }

  return fnRows.map((fn) => {
    const args = paramsBySpecificName.get(fn.name) ?? [];
    const params: FunctionParameter[] = args
      .filter((a) => a.parameter_name !== null)
      .map((a, idx) => ({
        name: a.parameter_name!,
        dataType: a.data_type ?? "unknown",
        mode: a.parameter_mode === "OUT" ? "out" : a.parameter_mode === "INOUT" ? "inout" : "in",
        ordinalPosition: idx,
      }));
    const overload: FunctionOverload = { parameters: params, returnType: fn.ret_type ?? "void" };
    return { schema: fn.schema, name: fn.name, overloads: [overload] };
  });
}

// ─────────────────────────── Query execution

/**
 * `arrayRowMode` faz o driver `mssql` devolver linhas como arrays posicionais
 * (em vez de objetos) e expõe metadados de coluna ordenados via `.index` —
 * mesmo contrato de linha usado pelos outros adaptadores.
 */
export async function runQueryViaPool(
  pool: ConnectionPool,
  sqlText: string,
  limit: number,
  onRequest?: (request: Request) => void,
): Promise<QueryResult> {
  const t0 = Date.now();
  const request = pool.request();
  request.arrayRowMode = true;
  onRequest?.(request);
  const cappedQuery = rewriteSimpleSelectForRowCap(sqlText, limit);
  if (cappedQuery) request.input("omni_limit", cappedQuery.cap);
  const result = await request.query<unknown[]>(cappedQuery?.sqlText ?? sqlText);
  const elapsedMs = Date.now() - t0;

  const recordset = result.recordset as (unknown[][] & { columns?: Record<string, { index: number; type: unknown }> }) | undefined;
  if (!recordset || recordset.columns === undefined) {
    const rowsAffected = (result.rowsAffected ?? []).reduce((a, b) => a + b, 0);
    return { columns: [], rows: [], rowsAffected, rowsMoreAvailable: false, elapsedMs };
  }

  const colsMeta = Object.entries(recordset.columns)
    .map(([name, meta]) => ({ name, index: meta.index, dataType: mapMssqlTypeToDataType(meta.type) }))
    .sort((a, b) => a.index - b.index);
  const columns: QueryResultColumn[] = colsMeta.map((c) => ({ name: c.name, dataType: c.dataType, nullable: true }));
  const rows = recordset as unknown as unknown[][];
  return {
    columns,
    rows: rows.slice(0, limit),
    rowsMoreAvailable: rows.length > limit,
    elapsedMs,
  };
}

interface CappedQuery {
  sqlText: string;
  cap: number;
}

/**
 * TOP is safe only for a small, single SELECT batch. Anything we cannot prove
 * to fit that shape keeps existing client-side behavior.
 */
function rewriteSimpleSelectForRowCap(sqlText: string, limit: number): CappedQuery | null {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit >= Number.MAX_SAFE_INTEGER) return null;

  const tokens = tokenizeSql(sqlText);
  const first = tokens?.[0];
  if (!tokens || !first || first.depth !== 0 || first.value !== "SELECT") return null;

  const unsafeTopLevel = new Set([
    "ALTER", "BEGIN", "COMMIT", "CREATE", "DECLARE", "DELETE", "DROP", "EXEC", "EXECUTE",
    "GO", "GRANT", "IF", "INSERT", "INTO", "MERGE", "REVOKE", "ROLLBACK", "SET", "TRUNCATE",
  ]);
  const unsafeAnywhere = new Set(["EXCEPT", "FETCH", "INTERSECT", "OFFSET", "TOP", "UNION", "WITH"]);
  if (tokens.some((token, index) => unsafeAnywhere.has(token.value)
    || (index > 0 && token.depth === 0 && unsafeTopLevel.has(token.value))
    || (index > 0 && token.depth === 0 && token.value === "SELECT"))) return null;

  const modifier = tokens[1];
  const insertAt = modifier?.depth === 0 && (modifier.value === "DISTINCT" || modifier.value === "ALL")
    ? modifier.end
    : first.end;
  return {
    sqlText: `${sqlText.slice(0, insertAt)} TOP (@omni_limit)${sqlText.slice(insertAt)}`,
    cap: limit + 1,
  };
}

interface SqlToken {
  value: string;
  end: number;
  depth: number;
}

function tokenizeSql(sqlText: string): SqlToken[] | null {
  const tokens: SqlToken[] = [];
  let depth = 0;
  let i = 0;

  while (i < sqlText.length) {
    const char = sqlText[i];
    const next = sqlText[i + 1];
    if (char === undefined) break;
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      i += 2;
      while (i < sqlText.length && sqlText[i] !== "\n" && sqlText[i] !== "\r") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      let commentDepth = 1;
      while (i < sqlText.length && commentDepth > 0) {
        if (sqlText[i] === "/" && sqlText[i + 1] === "*") {
          commentDepth += 1;
          i += 2;
        } else if (sqlText[i] === "*" && sqlText[i + 1] === "/") {
          commentDepth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (commentDepth !== 0) return null;
      continue;
    }
    if (char === "'") {
      i += 1;
      let closed = false;
      while (i < sqlText.length) {
        if (sqlText[i] !== "'") {
          i += 1;
        } else if (sqlText[i + 1] === "'") {
          i += 2;
        } else {
          i += 1;
          closed = true;
          break;
        }
      }
      if (!closed) return null;
      continue;
    }
    if (char === '"') {
      i += 1;
      let closed = false;
      while (i < sqlText.length) {
        if (sqlText[i] !== '"') {
          i += 1;
        } else if (sqlText[i + 1] === '"') {
          i += 2;
        } else {
          i += 1;
          closed = true;
          break;
        }
      }
      if (!closed) return null;
      continue;
    }
    if (char === "[") {
      i += 1;
      let closed = false;
      while (i < sqlText.length) {
        if (sqlText[i] !== "]") {
          i += 1;
        } else if (sqlText[i + 1] === "]") {
          i += 2;
        } else {
          i += 1;
          closed = true;
          break;
        }
      }
      if (!closed) return null;
      continue;
    }
    if (char === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth < 0) return null;
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = i;
      i += 1;
      while (i < sqlText.length && /[A-Za-z0-9_$#]/.test(sqlText[i] ?? "")) i += 1;
      tokens.push({ value: sqlText.slice(start, i).toUpperCase(), end: i, depth });
      continue;
    }
    if (char === ";") return null;
    i += 1;
  }

  return depth === 0 ? tokens : null;
}

/**
 * `UPDATE` de uma linha via PK, com parâmetros nomeados (`@s0, @s1, ...` /
 * `@w0, @w1, ...`) — nunca interpola valores no SQL. `spec.where`/`spec.set`
 * já vêm validados pela camada de backend; aqui só quotamos identificadores e
 * montamos os binds.
 */
export async function insertRowViaPool(pool: ConnectionPool, spec: RowInsertSpec): Promise<number> {
  const entries = Object.entries(spec.values);
  if (entries.length === 0) throw new Error("insertRow: values vazio");
  const request = pool.request();
  const tableRef = spec.schema
    ? `${quoteIdentifier(sqlserverDescriptor, spec.schema)}.${quoteIdentifier(sqlserverDescriptor, spec.table)}`
    : quoteIdentifier(sqlserverDescriptor, spec.table);
  const columns = entries.map(([column]) => quoteIdentifier(sqlserverDescriptor, column)).join(", ");
  const params = entries.map(([, value], index) => { request.input(`v${index}`, value); return `@v${index}`; }).join(", ");
  const result = await request.query(`INSERT INTO ${tableRef} (${columns}) VALUES (${params})`);
  return result.rowsAffected?.[0] ?? 0;
}

export async function updateRowViaPool(pool: ConnectionPool, spec: RowUpdateSpec): Promise<number> {
  const setEntries = Object.entries(spec.set);
  const whereEntries = Object.entries(spec.where);
  if (setEntries.length === 0) throw new Error("updateRow: nada para atualizar (set vazio)");
  if (whereEntries.length === 0) throw new Error("updateRow: where vazio (sem PK para localizar a linha)");

  const request = pool.request();
  const setClause = setEntries
    .map(([col, val], i) => {
      const p = `s${i}`;
      request.input(p, val);
      return `${quoteIdentifier(sqlserverDescriptor, col)} = @${p}`;
    })
    .join(", ");
  const whereClause = whereEntries
    .map(([col, val], i) => {
      const p = `w${i}`;
      request.input(p, val);
      return `${quoteIdentifier(sqlserverDescriptor, col)} = @${p}`;
    })
    .join(" AND ");
  const tableRef = spec.schema
    ? `${quoteIdentifier(sqlserverDescriptor, spec.schema)}.${quoteIdentifier(sqlserverDescriptor, spec.table)}`
    : quoteIdentifier(sqlserverDescriptor, spec.table);

  const result = await request.query(`UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`);
  return result.rowsAffected?.[0] ?? 0;
}

function mapMssqlTypeToDataType(type: unknown): string {
  // Metadados de coluna do `mssql` referenciam a classe de tipo (ex.: `sql.VarChar`)
  // em vez de um código numérico — o nome da classe já é amigável o suficiente.
  if (typeof type === "function" && "name" in type && typeof type.name === "string" && type.name.length > 0) {
    return type.name.toLowerCase();
  }
  return "unknown";
}

async function execRows<T>(
  pool: ConnectionPool,
  sqlText: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) {
    request.input(name, value);
  }
  const result = await request.query<T>(sqlText);
  return result.recordset ?? [];
}
