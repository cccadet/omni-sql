import { autocompleteTier1, type MetadataSource, type Suggestion } from "@omni-sql/autocomplete-engine";
import { formatIdentifier, identifierNeedsQuote, postgresDescriptor } from "@omni-sql/dialect-descriptors";
import type { Relation } from "@omni-sql/ts-types";
import type { DatasetRef } from "./analysis";
import type { RelationInfo } from "./backend";

const KEYWORDS = ["SELECT", "FROM", "WHERE", "JOIN", "LEFT JOIN", "INNER JOIN", "ON", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "WITH", "AS"] as const;

function unquoteIdentifier(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value;
}

/** DuckDB resolves ordinary identifiers without PostgreSQL's case folding. */
export function localAnalysisIdentifier(value: string): string {
  return formatIdentifier(postgresDescriptor, value, false);
}

function localInsertText(value: string): string {
  return value.replace(/"(?:[^"]|"")*"/g, (quoted) => {
    const identifier = unquoteIdentifier(quoted);
    return identifierNeedsQuote(postgresDescriptor, identifier, false) ? quoted : identifier;
  });
}

function datasetForQualifier(sql: string, sqlBeforeCursor: string, datasets: readonly DatasetRef[]): DatasetRef | undefined {
  const qualifierMatch = /("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)\.\s*[A-Za-z0-9_$]*$/.exec(sqlBeforeCursor);
  if (!qualifierMatch) return undefined;
  const qualifier = unquoteIdentifier(qualifierMatch[1]!);
  const direct = datasets.find((dataset) => dataset.relationName.toLocaleLowerCase() === qualifier.toLocaleLowerCase());
  if (direct) return direct;

  const aliasPattern = /\b(?:from|join)\s+("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_$]*)/gi;
  for (const match of sql.matchAll(aliasPattern)) {
    if (match[2]?.toLocaleLowerCase() !== qualifier.toLocaleLowerCase()) continue;
    const relation = unquoteIdentifier(match[1]!);
    return datasets.find((dataset) => dataset.relationName.toLocaleLowerCase() === relation.toLocaleLowerCase());
  }
  return undefined;
}

function sourceRelation(sql: string | undefined, relations: readonly RelationInfo[]): RelationInfo | undefined {
  if (!sql) return undefined;
  const identifier = '(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)';
  const match = new RegExp(`\\bfrom\\s+(${identifier})(?:\\s*\\.\\s*(${identifier}))?`, "i").exec(sql);
  if (!match?.[1]) return undefined;
  const schemaOrTable = unquoteIdentifier(match[1]);
  const table = match[2] ? unquoteIdentifier(match[2]) : schemaOrTable;
  const schema = match[2] ? schemaOrTable : undefined;
  return relations.find((relation) => relation.name.toLocaleLowerCase() === table.toLocaleLowerCase()
    && (!schema || relation.schema.toLocaleLowerCase() === schema.toLocaleLowerCase()));
}

export function localAnalysisSuggestions(
  sql: string,
  cursor: number,
  datasets: readonly DatasetRef[],
  metadataByConnection: Readonly<Record<string, readonly RelationInfo[]>> = {},
): Suggestion[] {
  const origins = new Map<string, RelationInfo>();
  for (const dataset of datasets) {
    if (!dataset.sourceConnectionId) continue;
    const origin = sourceRelation(dataset.sourceSql, metadataByConnection[dataset.sourceConnectionId] ?? []);
    if (origin) origins.set(dataset.id, origin);
  }
  const localRelations: Relation[] = datasets.map((dataset) => {
    const origin = origins.get(dataset.id);
    return {
      schema: "main",
      name: dataset.relationName,
      kind: "table",
      constraints: [],
      columns: dataset.columns.map((column, ordinalPosition) => {
        const sourceColumn = origin?.columns?.find((candidate) => candidate.name === column.originalName);
        const sourceTarget = sourceColumn?.foreignKeyTo;
        const targetDataset = sourceTarget && datasets.find((candidate) => {
          if (candidate.sourceConnectionId !== dataset.sourceConnectionId) return false;
          const candidateOrigin = origins.get(candidate.id);
          return candidateOrigin?.schema === sourceTarget.schema && candidateOrigin.name === sourceTarget.table;
        });
        const targetColumn = targetDataset && sourceTarget
          ? targetDataset.columns.find((candidate) => candidate.originalName === sourceTarget.column)
          : undefined;
        return {
          name: column.name,
          dataType: column.dataType,
          nullable: column.nullable,
          isPrimaryKey: sourceColumn?.isPrimaryKey ?? false,
          ordinalPosition,
          ...(targetDataset && targetColumn ? { foreignKeyTo: { schema: "main", table: targetDataset.relationName, column: targetColumn.name } } : {}),
        };
      }),
    };
  });
  const metadata: MetadataSource = {
    dialect: postgresDescriptor,
    listSchemas: () => ["main"],
    listRelations: () => localRelations,
    listFunctions: () => [],
    resolveRelation: (ref) => localRelations.find((relation) =>
      relation.name.toLocaleLowerCase() === ref.table.toLocaleLowerCase()
      && (!ref.schema || relation.schema.toLocaleLowerCase() === ref.schema.toLocaleLowerCase())) ?? null,
  };
  const suggestions = autocompleteTier1(sql, cursor, metadata);
  if (suggestions.length > 0) return suggestions.map((suggestion) => suggestion.insertText
    ? { ...suggestion, insertText: localInsertText(suggestion.insertText) }
    : suggestion);

  const sqlBeforeCursor = sql.slice(0, cursor);
  const qualifiedDataset = datasetForQualifier(sql, sqlBeforeCursor, datasets);
  if (qualifiedDataset) return qualifiedDataset.columns.map((column) => ({
    kind: "column", label: column.name, detail: `${qualifiedDataset.name} · ${column.dataType}`, relevance: 100,
    ...(localAnalysisIdentifier(column.name) !== column.name ? { insertText: localAnalysisIdentifier(column.name) } : {}),
  }));
  return KEYWORDS.map((keyword) => ({ kind: "keyword", label: keyword, relevance: 20 }));
}
