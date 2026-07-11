import type { QueryResult } from "@omni-sql/ts-types";

const SIDECAR_URL = process.env.OMNI_SQL_SIDECAR_URL ?? "http://127.0.0.1:41921";

export interface JdbcConnectParams {
  readonly connectionId: string;
  readonly jarPath: string;
  readonly driverClassName: string;
  readonly jdbcUrl: string;
  readonly user?: string;
  readonly password?: string;
}

interface JdbcQueryBody {
  readonly columns: readonly { name: string; dataType: string; nullable: boolean }[];
  readonly rows: readonly unknown[][];
  readonly rowsAffected: number | null;
  readonly rowsMoreAvailable: boolean;
  readonly elapsedMs: number;
}

export interface JdbcColumnBody {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly ordinalPosition: number;
  readonly isPrimaryKey: boolean;
}

export interface JdbcTableBody {
  readonly name: string;
  readonly kind: "table" | "view";
  readonly columns: readonly JdbcColumnBody[];
}

export interface JdbcSchemaBody {
  readonly name: string;
  readonly tables: readonly JdbcTableBody[];
}

/**
 * Client HTTP fino pros endpoints `/jdbc/*` do sidecar JVM (ver
 * `services/jvm-sidecar/.../jdbc/JdbcConnectionManager.kt`) — ao contrário de
 * `resolveCteRelations`/`analyzeQueryEditability` (backend, best-effort),
 * aqui um erro é uma falha real de conexão/query e deve subir pro chamador.
 */
async function callSidecar(path: string, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${SIDECAR_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `sidecar JVM indisponível em ${SIDECAR_URL} — build e rode o jar antes de usar jdbc-generic (ver README)`,
      { cause: e },
    );
  }
  const parsed = (await res.json()) as Record<string, unknown>;
  if (parsed.ok === false) {
    throw new Error(`[${parsed.causeTag}] ${parsed.message}`);
  }
  return parsed;
}

export async function jdbcConnect(params: JdbcConnectParams): Promise<void> {
  await callSidecar("/jdbc/connect", params);
}

export async function jdbcClose(connectionId: string): Promise<void> {
  await callSidecar("/jdbc/close", { connectionId });
}

export async function jdbcQuery(connectionId: string, sql: string, limit: number): Promise<QueryResult> {
  const body = (await callSidecar("/jdbc/query", { connectionId, sql, limit })) as unknown as JdbcQueryBody;
  return {
    columns: body.columns,
    rows: body.rows,
    rowsAffected: body.rowsAffected ?? undefined,
    rowsMoreAvailable: body.rowsMoreAvailable,
    elapsedMs: body.elapsedMs,
  };
}

export async function jdbcListSchemas(connectionId: string): Promise<readonly string[]> {
  const body = (await callSidecar("/jdbc/schemas", { connectionId })) as unknown as { schemas: readonly string[] };
  return body.schemas;
}

export async function jdbcIntrospect(
  connectionId: string,
  schemaFilter?: readonly string[],
): Promise<readonly JdbcSchemaBody[]> {
  const body = (await callSidecar("/jdbc/introspect", { connectionId, schemaFilter })) as unknown as {
    schemas: readonly JdbcSchemaBody[];
  };
  return body.schemas;
}
