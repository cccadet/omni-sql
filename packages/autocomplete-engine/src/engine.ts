import type { FunctionDef, Relation } from "@omni-sql/ts-types";
import type { DialectDescriptor } from "@omni-sql/dialect-descriptors";
import { resolveContext, type ResolvedContext, type ScopeRef } from "./context.ts";

/** Origem de metadados (somente leitura) consumida pelo motor. */
export interface MetadataSource {
  readonly dialect: DialectDescriptor;
  /** Lista todas as relações (tabelas + views) dos schemas disponíveis. */
  listRelations(): readonly Relation[];
  /** Lista funções dos schemas disponíveis. */
  listFunctions(): readonly FunctionDef[];
  /** Resolve um alias escopo para uma Relation (lookup por schema/table). */
  resolveRelation(ref: ScopeRef): Relation | null;
}

export type SuggestionKind =
  | "table"
  | "view"
  | "column"
  | "function"
  | "keyword"
  | "star"
  | "all-columns";

export interface Suggestion {
  readonly kind: SuggestionKind;
  readonly label: string;
  readonly detail?: string;
  readonly insertText?: string;
  readonly relevance: number;
}

/**
 * Motor de autocomplete — tier1. Resolve contexto apenas com lexer e lookup
 * no cache (em memória). Casos que exigem Calcite (subqueries correlacionadas,
 * inferência de colunas em CTEs, escopo aninhado com leakage) ficam em tier2
 * (Fase 3, sidecar JVM).
 *
 * Casos cobertos por tier1:
 *   1. FROM/JOIN → tabelas/views
 *   2. SELECT sem FROM → funções + `*`
 *   3. SELECT ... FROM t [alias] → colunas (concat em escopo)
 *   4. alias. → colunas do alias
 *   5. Múltiplos JOINs com aliases → colunas de todas em escopo
 *   6. WHERE/ON/GROUP BY/ORDER BY → mesmas colunas
 *   7. CTE name em FROM (nome resolvido; colunas internas: best-effort vazio)
 *   8. TODO — subqueries correlacionadas (scope leak) — tier2.
 */
export function autocompleteTier1(
  input: string,
  cursor: number,
  meta: MetadataSource,
): Suggestion[] {
  const dialect = meta.dialect;
  const ctx: ResolvedContext = resolveContext(input, cursor, dialect);

  // Caso 1: cursor imediatamente após FROM/JOIN → tabelas/views. Um
  // qualificador aqui é um schema (`ai.<cursor>`), não um alias.
  if (ctx.clause === "from" || ctx.clause === "join") {
    // Case-insensitive: identificadores não-citados são digitados em
    // qualquer case pelo usuário, mas o schema cacheado reflete o folding
    // do dialeto (Postgres → minúsculas, Oracle → MAIÚSCULAS).
    const qualifierLower = ctx.qualifier?.toLowerCase();
    const rels = qualifierLower
      ? meta.listRelations().filter((r) => r.schema.toLowerCase() === qualifierLower)
      : meta.listRelations();
    const partial = ctx.cursorToken?.value ?? "";
    return rels
      .map((r) => ({
        kind: r.kind === "view" ? ("view" as const) : ("table" as const),
        label: r.name,
        detail: r.schema,
        // Schema já digitado pelo usuário (`ctx.qualifier`) não deve ser
        // repetido; do contrário, qualifica para produzir SQL executável
        // em schemas fora do search_path padrão.
        insertText: ctx.qualifier || r.schema === "public" ? undefined : `${r.schema}.${r.name}`,
        relevance: 90,
      }))
      .filter((s) => !partial || s.label.toLowerCase().startsWith(partial.toLowerCase()));
  }

  // Caso 4: `alias.` → colunas do alias.
  if (ctx.qualifier) {
    const ref = ctx.scope.find((s) => s.alias === ctx.qualifier);
    if (!ref) return [];
    const rel = meta.resolveRelation(ref);
    if (!rel) return [];
    return [...rel.columns]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        kind: "column" as const,
        label: c.name,
        detail: c.dataType,
        relevance: 100,
      }));
  }

  // Caso 2: SELECT sem FROM ainda → `*` + funções.
  if (ctx.clause === "select-list" && ctx.scope.length === 0) {
    const fns = meta.listFunctions().map((f) => ({
      kind: "function" as const,
      label: f.name,
      detail: f.overloads[0]?.returnType,
      relevance: 70,
    }));
    return [{ kind: "star", label: "*", relevance: 90 }, ...fns];
  }

  // Casos 3, 5, 6: colunas das tabelas em escopo.
  if (
    ctx.clause === "select-list" ||
    ctx.clause === "where" ||
    ctx.clause === "group-by" ||
    ctx.clause === "having" ||
    ctx.clause === "order-by" ||
    ctx.clause === "on"
  ) {
    const isSelectList = ctx.clause === "select-list";
    const alreadySelected = new Set(ctx.selectedColumns);
    const cols: Suggestion[] = [];
    const allColumnNames: string[] = [];
    for (const ref of ctx.scope) {
      const rel = meta.resolveRelation(ref);
      if (!rel) continue;
      for (const c of rel.columns) {
        allColumnNames.push(c.name);
        if (isSelectList && alreadySelected.has(c.name.toLowerCase())) continue;
        cols.push({
          kind: "column",
          label: c.name,
          detail: `${ref.alias}.${c.name} (${c.dataType})`,
          relevance: ref.alias === ref.table ? 80 : 85,
        });
      }
    }
    // Ordem alfabética como base — quando nada foi digitado ainda, a lista
    // fica previsível; com prefixo digitado, o consumidor (Monaco) reordena
    // por fuzzy-match e essa ordenação de base não atrapalha.
    cols.sort((a, b) => a.label.localeCompare(b.label));
    // Funções também aplicáveis em listas.
    const fns = meta.listFunctions().map((f) => ({
      kind: "function" as const,
      label: f.name,
      detail: f.overloads[0]?.returnType,
      relevance: 50,
    }));
    const result: Suggestion[] = [...cols, ...fns];
    // "Todas as colunas de uma vez" — só no select-list, e sempre com a
    // lista completa (mesmo as já digitadas), já que o objetivo é inserir
    // tudo de uma vez, não complementar o que já está lá.
    if (isSelectList && allColumnNames.length > 0) {
      result.unshift({
        kind: "all-columns",
        label: "Todas as colunas",
        detail: allColumnNames.join(", "),
        insertText: allColumnNames.join(", "),
        relevance: 999,
      });
    }
    return result;
  }

  return [];
}