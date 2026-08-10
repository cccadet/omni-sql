import type { FunctionDef, Relation } from "@omni-sql/ts-types";
import { quoteIdentifier, type DialectDescriptor } from "@omni-sql/dialect-descriptors";
import { resolveContext, type ResolvedContext, type ScopeRef } from "./context.ts";
import type { Token } from "./lexer.ts";

/** Origem de metadados (somente leitura) consumida pelo motor. */
export interface MetadataSource {
  readonly dialect: DialectDescriptor;
  listSchemas(): readonly string[];
  listRelations(): readonly Relation[];
  listFunctions(): readonly FunctionDef[];
  resolveRelation(ref: ScopeRef): Relation | null;
}

export type SuggestionKind =
  | "schema"
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

function qualifierBeforeCursor(ctx: ResolvedContext): string | null {
  if (ctx.qualifier) return ctx.qualifier;
  const tokens = ctx.prelude;
  const last = tokens[tokens.length - 1];
  const dot = tokens[tokens.length - 2];
  const qualifier = tokens[tokens.length - 3];
  if (
    last?.type === "identifier" &&
    dot?.type === "punct" &&
    dot.value === "." &&
    (qualifier?.type === "identifier" || qualifier?.type === "keyword")
  ) return qualifier.value;
  return null;
}

function isNameToken(token: Token | undefined): boolean {
  return token?.type === "identifier" || token?.type === "keyword";
}

function identifierNeedsQuote(name: string, dialect: DialectDescriptor, metadataIdentifier = true): boolean {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || dialect.keywords.has(name.toUpperCase())) return true;
  if (!metadataIdentifier) return false;
  if (dialect.dialect === "postgres") return name !== name.toLowerCase();
  if (dialect.dialect === "oracle") return /[A-Z]/.test(name) && /[a-z]/.test(name);
  return false;
}

function identifierText(name: string, dialect: DialectDescriptor, forceQuote = false, metadataIdentifier = true): string {
  return forceQuote || identifierNeedsQuote(name, dialect, metadataIdentifier) ? quoteIdentifier(dialect, name) : name;
}

function currentPrefix(ctx: ResolvedContext, cursor: number): string | null {
  if (ctx.cursorToken) return ctx.cursorToken.value;
  const localCursor = cursor - ctx.statementStart;
  const last = ctx.prelude[ctx.prelude.length - 1];
  return last?.type === "keyword" && last.end === localCursor ? last.value : null;
}

function currentSourceSegment(ctx: ResolvedContext): readonly Token[] {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < ctx.prelude.length; i++) {
    const token = ctx.prelude[i]!;
    if (token.type === "punct" && token.value === "(") {
      depth++;
      continue;
    }
    if (token.type === "punct" && token.value === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || token.type !== "keyword") continue;
    const upper = token.upper ?? token.value.toUpperCase();
    if (upper === "FROM" || upper === "JOIN" || upper === "STRAIGHT_JOIN") start = i + 1;
    else if (upper === "ON" || upper === "USING" || upper === "WHERE" || upper === "GROUP" || upper === "HAVING" || upper === "ORDER") start = i + 1;
  }
  depth = 0;
  for (let i = start; i < ctx.prelude.length; i++) {
    const token = ctx.prelude[i]!;
    if (token.type === "punct" && token.value === "(") depth++;
    else if (token.type === "punct" && token.value === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && token.type === "punct" && token.value === ",") start = i + 1;
  }
  return ctx.prelude.slice(start);
}

function isRelationSlot(ctx: ResolvedContext): boolean {
  const segment = currentSourceSegment(ctx);
  if (segment.length === 0) return true;
  const last = segment[segment.length - 1];
  if (last?.type === "punct" && last.value === ".") return true;

  const active = ctx.cursorToken;
  if (!active || !last || active.start !== last.start || active.end !== last.end) return false;
  const names = segment.filter(isNameToken);
  return (
    (names.length === 1 && segment.length === 1) ||
    (names.length === 2 && segment.length === 3 && segment[1]?.type === "punct" && segment[1]?.value === ".")
  );
}

function isPendingJoinModifier(ctx: ResolvedContext): boolean {
  const segment = currentSourceSegment(ctx);
  const last = segment[segment.length - 1];
  return last?.type === "keyword" && (last.upper === "LEFT" || last.upper === "INNER");
}

function currentSourceKind(ctx: ResolvedContext): "from" | "join" | null {
  let depth = 0;
  let kind: "from" | "join" | null = null;
  for (const token of ctx.prelude) {
    if (token.type === "punct" && token.value === "(") {
      depth++;
      continue;
    }
    if (token.type === "punct" && token.value === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || token.type !== "keyword") continue;
    const upper = token.upper ?? token.value.toUpperCase();
    if (upper === "FROM") kind = "from";
    else if (upper === "JOIN" || upper === "STRAIGHT_JOIN") kind = "join";
    else if (["WHERE", "GROUP", "HAVING", "ORDER", "ON", "USING", "UNION", "EXCEPT", "INTERSECT", "MINUS"].includes(upper)) kind = null;
  }
  return kind;
}

function isAfterJoinRelation(ctx: ResolvedContext): boolean {
  return currentSourceKind(ctx) === "join" && !isRelationSlot(ctx) && currentSourceSegment(ctx).length > 0;
}

function isUsingContext(ctx: ResolvedContext): boolean {
  if (ctx.clause !== "on") return false;
  let depth = 0;
  let condition: "on" | "using" | null = null;
  for (const token of ctx.prelude) {
    if (token.type === "punct" && token.value === "(") {
      depth++;
      continue;
    }
    if (token.type === "punct" && token.value === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && token.type === "keyword") {
      const upper = token.upper ?? token.value.toUpperCase();
      if (upper === "ON") condition = "on";
      else if (upper === "USING") condition = "using";
      else if (["FROM", "JOIN", "WHERE", "GROUP", "HAVING", "ORDER", "UNION", "EXCEPT", "INTERSECT", "MINUS"].includes(upper)) {
        condition = null;
      }
    }
  }
  return condition === "using";
}

function functionSuggestions(ctx: ResolvedContext, meta: MetadataSource, relevance: number): Suggestion[] {
  const prefix = ctx.cursorToken?.value;
  if (!prefix) return [];
  const lowerPrefix = prefix.toLowerCase();
  return meta.listFunctions()
    .filter((fn) => fn.name.toLowerCase().startsWith(lowerPrefix))
    .map((fn) => ({
      kind: "function" as const,
      label: fn.name,
      detail: fn.overloads[0]?.returnType,
      ...(identifierNeedsQuote(fn.name, meta.dialect) ? { insertText: identifierText(fn.name, meta.dialect) } : {}),
      relevance,
    }));
}

interface KeywordSnippet {
  readonly trigger: string;
  readonly suggestion: Suggestion;
}

function keywordSnippet(trigger: string, label: string, insertText: string, relevance: number): KeywordSnippet {
  return { trigger, suggestion: { kind: "keyword", label, insertText, relevance } };
}

const SELECT_SNIPPET = keywordSnippet("SELECT", "SELECT * FROM", "SELECT * FROM $1", 100);
const ORDER_SNIPPET = keywordSnippet("ORDER", "ORDER BY", "ORDER BY $1", 80);
const GROUP_SNIPPET = keywordSnippet("GROUP", "GROUP BY", "GROUP BY $1", 80);
const LEFT_JOIN_SNIPPET = keywordSnippet("LEFT", "LEFT JOIN", "LEFT JOIN $1 ON $2", 75);
const INNER_JOIN_SNIPPET = keywordSnippet("INNER", "INNER JOIN", "INNER JOIN $1 ON $2", 75);

function contextualPrefixSuggestions(ctx: ResolvedContext, cursor: number): Suggestion[] {
  const prefix = currentPrefix(ctx, cursor);
  if (!prefix) return [];
  const lower = prefix.toLowerCase();
  const relationSlot = isRelationSlot(ctx);
  const afterRelation = (ctx.clause === "from" || ctx.clause === "join") && !relationSlot;
  const candidates = [SELECT_SNIPPET, ORDER_SNIPPET, GROUP_SNIPPET, LEFT_JOIN_SNIPPET, INNER_JOIN_SNIPPET];
  return candidates
    .filter((candidate) => candidate.trigger.toLowerCase().startsWith(lower))
    .filter((candidate) => {
      if (candidate === SELECT_SNIPPET) return ctx.clause === "unknown" || (ctx.clause === "select-list" && ctx.scope.length === 0);
      if (candidate === ORDER_SNIPPET) return ctx.clause === "unknown" || ctx.clause === "order-by" || afterRelation;
      if (candidate === GROUP_SNIPPET) return ctx.clause === "unknown" || ctx.clause === "group-by" || afterRelation;
      return ctx.clause === "unknown" || afterRelation || (ctx.clause === "join" && !relationSlot);
    })
    .map((candidate) => candidate.suggestion);
}

function transitionSuggestions(ctx: ResolvedContext, cursor: number): Suggestion[] {
  const transitions: readonly KeywordSnippet[] = [
    keywordSnippet("WHERE", "WHERE", "WHERE ", 90),
    keywordSnippet("JOIN", "JOIN", "JOIN ", 85),
    GROUP_SNIPPET,
    keywordSnippet("HAVING", "HAVING", "HAVING ", 70),
    ORDER_SNIPPET,
  ];
  const prefix = currentPrefix(ctx, cursor)?.toLowerCase();
  return transitions
    .filter((transition) => !prefix || transition.trigger.toLowerCase().startsWith(prefix))
    .map((transition) => transition.suggestion);
}

function joinConditionSuggestions(): Suggestion[] {
  return [
    { kind: "keyword", label: "ON", insertText: "ON ", relevance: 1000 },
    { kind: "keyword", label: "USING", insertText: "USING (", relevance: 990 },
  ];
}

function usingColumnSuggestions(ctx: ResolvedContext, meta: MetadataSource): Suggestion[] {
  const relations = ctx.scope
    .map((scopeRef) => meta.resolveRelation(scopeRef))
    .filter((relation): relation is Relation => relation !== null);
  if (relations.length < 2) return [];
  const right = relations[relations.length - 1]!;
  const left = new Set<string>();
  for (const relation of relations.slice(0, -1)) {
    for (const column of relation.columns) left.add(column.name.toLowerCase());
  }
  const common = new Map<string, { readonly name: string; readonly dataType: string }>();
  for (const column of right.columns) {
    const key = column.name.toLowerCase();
    if (left.has(key) && !common.has(key)) common.set(key, { name: column.name, dataType: column.dataType });
  }
  const prefix = ctx.cursorToken?.value.toLowerCase();
  return [...common.values()]
    .filter((column) => !prefix || column.name.toLowerCase().startsWith(prefix))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((column) => ({
      kind: "column" as const,
      label: column.name,
      detail: column.dataType,
      ...(identifierNeedsQuote(column.name, meta.dialect) ? { insertText: identifierText(column.name, meta.dialect) } : {}),
      relevance: 100,
    }));
}

/** Autocomplete tier1: lexer context plus in-memory metadata. */
export function autocompleteTier1(input: string, cursor: number, meta: MetadataSource): Suggestion[] {
  const ctx = resolveContext(input, cursor, meta.dialect);
  if (ctx.prelude.length === 0) return [SELECT_SNIPPET.suggestion];
  const prefixSuggestions = contextualPrefixSuggestions(ctx, cursor);
  if (prefixSuggestions.length > 0) return prefixSuggestions;

  if (isAfterJoinRelation(ctx)) return joinConditionSuggestions();

  if ((ctx.clause === "from" || ctx.clause === "join") && isPendingJoinModifier(ctx)) {
    const prefix = currentPrefix(ctx, cursor)?.toLowerCase();
    if (!prefix || "join".startsWith(prefix)) {
      return [{ kind: "keyword", label: "JOIN", insertText: "JOIN ", relevance: 90 }];
    }
    return [];
  }

  const relationSlot = isRelationSlot(ctx);
  if ((ctx.clause === "from" || ctx.clause === "join") && relationSlot) {
    const qualifier = qualifierBeforeCursor(ctx);
    const qualifierLower = qualifier?.toLowerCase();
    const partial = ctx.cursorToken?.value ?? "";
    const relations = qualifierLower
      ? meta.listRelations().filter((relation) => relation.schema.toLowerCase() === qualifierLower)
      : meta.listRelations();
    const schemas = qualifierLower
      ? []
      : meta.listSchemas()
        .filter((schema) => !partial || schema.toLowerCase().startsWith(partial.toLowerCase()))
        .map((schema) => ({
          kind: "schema" as const,
          label: schema,
          detail: "schema",
          ...(identifierNeedsQuote(schema, meta.dialect) ? { insertText: identifierText(schema, meta.dialect) } : {}),
          relevance: 95,
        }));
    const relationNameCounts = new Map<string, number>();
    for (const relation of relations) {
      const key = relation.name.toLowerCase();
      relationNameCounts.set(key, (relationNameCounts.get(key) ?? 0) + 1);
    }
    const relationSuggestions = relations
      .map((relation) => {
        const tableText = identifierText(relation.name, meta.dialect);
        const insertText = qualifier
          ? tableText
          : (relationNameCounts.get(relation.name.toLowerCase()) ?? 0) > 1 && relation.schema !== ""
            ? `${identifierText(relation.schema, meta.dialect)}.${tableText}`
            : identifierNeedsQuote(relation.name, meta.dialect) ? tableText : undefined;
        return {
          kind: relation.kind === "view" ? ("view" as const) : ("table" as const),
          label: relation.name,
          detail: relation.schema,
          ...(insertText === undefined ? {} : { insertText }),
          relevance: 90,
        };
      })
      .filter((suggestion) => !partial || suggestion.label.toLowerCase().startsWith(partial.toLowerCase()));
    return [...schemas, ...relationSuggestions];
  }

  if (isUsingContext(ctx)) return usingColumnSuggestions(ctx, meta);

  if (ctx.qualifier) {
    const qualifier = ctx.qualifier.toLowerCase();
    const ref = ctx.scope.find((scopeRef) => scopeRef.alias.toLowerCase() === qualifier);
    if (!ref) return [];
    const relation = meta.resolveRelation(ref);
    if (!relation) return [];
    return [...relation.columns]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((column) => ({
        kind: "column" as const,
        label: column.name,
        detail: column.dataType,
        ...(identifierNeedsQuote(column.name, meta.dialect) ? { insertText: identifierText(column.name, meta.dialect) } : {}),
        relevance: 100,
      }));
  }

  if ((ctx.clause === "from" || ctx.clause === "join") && !relationSlot) {
    return transitionSuggestions(ctx, cursor);
  }

  if (ctx.clause === "select-list" && ctx.scope.length === 0) {
    return [{ kind: "star", label: "*", relevance: 90 }, ...functionSuggestions(ctx, meta, 70)];
  }

  if (!["select-list", "where", "group-by", "having", "order-by", "on"].includes(ctx.clause)) return [];

  const isSelectList = ctx.clause === "select-list";
  const alreadySelected = new Set(ctx.selectedColumns);
  const columns: Suggestion[] = [];
  const allColumnNames: string[] = [];
  const columnCounts = new Map<string, number>();
  const relations = ctx.scope.map((scopeRef) => ({ scopeRef, relation: meta.resolveRelation(scopeRef) }));
  for (const { relation } of relations) {
    if (!relation) continue;
    for (const column of relation.columns) {
      const key = column.name.toLowerCase();
      columnCounts.set(key, (columnCounts.get(key) ?? 0) + 1);
    }
  }
  for (const { scopeRef, relation } of relations) {
    if (!relation) continue;
    for (const column of relation.columns) {
      const columnKey = column.name.toLowerCase();
      const qualifiedKey = `${scopeRef.alias.toLowerCase()}.${columnKey}`;
      if (
        isSelectList &&
        (alreadySelected.has(qualifiedKey) ||
          ((columnCounts.get(columnKey) ?? 0) === 1 && alreadySelected.has(columnKey)))
      ) continue;
      const columnText = identifierText(column.name, meta.dialect);
      const qualifiedText = `${identifierText(scopeRef.alias, meta.dialect, scopeRef.aliasQuoted, false)}.${columnText}`;
      const insertText = (columnCounts.get(column.name.toLowerCase()) ?? 0) > 1
        ? qualifiedText
        : identifierNeedsQuote(column.name, meta.dialect) ? columnText : undefined;
      columns.push({
        kind: "column",
        label: column.name,
        detail: `${scopeRef.alias}.${column.name} (${column.dataType})`,
        ...(insertText === undefined ? {} : { insertText }),
        relevance: scopeRef.alias === scopeRef.table ? 80 : 85,
      });
      if (isSelectList) allColumnNames.push(
        (columnCounts.get(column.name.toLowerCase()) ?? 0) > 1 ? qualifiedText : columnText,
      );
    }
  }
  columns.sort((a, b) => a.label.localeCompare(b.label));
  const result: Suggestion[] = [...columns, ...functionSuggestions(ctx, meta, 50)];
  if (isSelectList && allColumnNames.length > 0) {
    result.push({
      kind: "all-columns",
      label: "Todas as colunas",
      detail: allColumnNames.join(", "),
      insertText: allColumnNames.join(", "),
      relevance: 40,
    });
  }
  return result;
}
