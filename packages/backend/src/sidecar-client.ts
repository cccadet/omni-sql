import type { Relation } from "@omni-sql/ts-types";

const SIDECAR_URL = process.env.OMNI_SQL_SIDECAR_URL ?? "http://127.0.0.1:41921";
const TIMEOUT_MS = 250;

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
      headers: { "content-type": "application/json" },
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
