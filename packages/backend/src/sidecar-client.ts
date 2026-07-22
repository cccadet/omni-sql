import type { QueryEditability, Relation } from "@omni-sql/ts-types";

const SIDECAR_URL = validatedSidecarUrl();
const AUTH_TOKEN = process.env.OMNI_SQL_AUTH_TOKEN;
const TIMEOUT_MS = 250;
// A análise de editabilidade pode disparar o carregamento inicial do Calcite.
// Diferentemente do autocomplete, ela acontece após a query e pode esperar um pouco mais.
const EDITABILITY_TIMEOUT_MS = 1_500;

interface CteInfo {
  readonly name: string;
  readonly columns: readonly string[];
}

/**
 * Resolve colunas de CTEs (`WITH nome AS (...)`) via o sidecar JVM (Apache
 * Calcite — ver `services/jvm-sidecar/.../scope/ScopeResolver.kt`).
 *
 * Best-effort: timeout curto e qualquer falha (sidecar fora do ar, jar não
 * buildado, SQL sem WITH, corpo do CTE não parseável) retorna lista vazia —
 * `completion.get` segue funcionando 100% tier1 (TS) sem essas colunas,
 * exatamente como antes desta função existir.
 */
export async function resolveCteRelations(sql: string): Promise<Relation[]> {
  if (!/\bwith\b/i.test(sql)) return [];
  let ctes: CteInfo[];
  try {
    const res = await fetch(`${SIDECAR_URL}/scope/resolve`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const parsed = (await res.json()) as { ctes?: CteInfo[] };
    ctes = parsed.ctes ?? [];
  } catch {
    return [];
  }
  return ctes.map((cte) => ({
    schema: "",
    name: cte.name,
    kind: "view" as const,
    columns: cte.columns.map((name, i) => ({
      name,
      dataType: "unknown",
      nullable: true,
      isPrimaryKey: false,
      ordinalPosition: i + 1,
    })),
    constraints: [],
  }));
}

const NOT_EDITABLE: QueryEditability = {
  editable: false,
  reason: "sidecar indisponível",
  table: null,
  selectStar: false,
  columns: [],
};

/**
 * Decide se `sql` é um `SELECT` simples de uma tabela só, via o sidecar
 * JVM (Apache Calcite — ver
 * `services/jvm-sidecar/.../editability/QueryEditabilityAnalyzer.kt`).
 * Alimenta a edição inline da grade de resultados: só habilita edição de
 * célula quando dá pra mapear cada coluna projetada de volta a uma coluna
 * real de uma tabela conhecida, sem ambiguidade de JOIN/subquery/set-op.
 *
 * Best-effort: timeout curto e qualquer falha (sidecar fora do ar, jar não
 * buildado, SQL não parseável) retorna `editable: false` — a grade cai de
 * volta a read-only, nunca falha a query em si.
 */
export async function analyzeQueryEditability(sql: string): Promise<QueryEditability> {
  try {
    const res = await fetch(`${SIDECAR_URL}/query/editability`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(EDITABILITY_TIMEOUT_MS),
    });
    if (!res.ok) return NOT_EDITABLE;
    return (await res.json()) as QueryEditability;
  } catch {
    return NOT_EDITABLE;
  }
}

function sidecarHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(AUTH_TOKEN ? { authorization: `Bearer ${AUTH_TOKEN}` } : {}),
  };
}

function validatedSidecarUrl(): string {
  const value = process.env.NODE_ENV === "production"
    ? "http://127.0.0.1:41921"
    : (process.env.OMNI_SQL_SIDECAR_URL ?? "http://127.0.0.1:41921");
  if (process.env.NODE_ENV !== "production") return value;
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("OMNI_SQL_SIDECAR_URL must point to a local HTTP JVM sidecar in production");
  }
  return url.origin;
}
