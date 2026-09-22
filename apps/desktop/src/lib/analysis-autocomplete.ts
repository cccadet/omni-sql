import type { Suggestion } from "@omni-sql/autocomplete-engine";
import type { DatasetRef } from "./analysis";

const KEYWORDS = ["SELECT", "FROM", "WHERE", "JOIN", "LEFT JOIN", "INNER JOIN", "ON", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "WITH", "AS"] as const;

function unquoteIdentifier(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value;
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

export function localAnalysisSuggestions(sql: string, cursor: number, datasets: readonly DatasetRef[]): Suggestion[] {
  const sqlBeforeCursor = sql.slice(0, cursor);
  const qualifiedDataset = datasetForQualifier(sql, sqlBeforeCursor, datasets);
  if (qualifiedDataset) {
    return qualifiedDataset.columns.map((column) => ({
      kind: "column",
      label: column.name,
      detail: `${qualifiedDataset.name} · ${column.dataType}`,
      relevance: 100,
    }));
  }

  return [
    ...datasets.map((dataset) => ({
      kind: "table" as const,
      label: dataset.relationName,
      detail: `${dataset.name} · ${dataset.rowCount} rows`,
      relevance: 90,
    })),
    ...datasets.flatMap((dataset) => dataset.columns.map((column) => ({
      kind: "column" as const,
      label: column.name,
      detail: `${dataset.relationName} · ${column.dataType}`,
      relevance: 60,
    }))),
    ...KEYWORDS.map((keyword) => ({ kind: "keyword" as const, label: keyword, relevance: 20 })),
  ];
}
