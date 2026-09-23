import { expect, test } from "vitest";
import type { DatasetRef } from "./analysis";
import { localAnalysisIdentifier, localAnalysisSuggestions } from "./analysis-autocomplete";
import type { RelationInfo } from "./backend";

const datasets: DatasetRef[] = [{
  id: "orders-id", workspaceId: "workspace", name: "Orders", relationName: "orders",
  columns: [
    { name: "id", originalName: "id", dataType: "BIGINT", sourceDataType: "int8", nullable: false },
    { name: "total", originalName: "total", dataType: "DECIMAL", sourceDataType: "numeric", nullable: true },
  ],
  rowCount: 2, approximateBytes: 20, createdAtMs: 1, coverage: "complete", selection: { mode: "full" }, scannedRows: 2,
}];

test("suggests context-aware SQL items and local datasets", () => {
  expect(localAnalysisSuggestions("SELECT ", 7, datasets)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "star", label: "*" }),
  ]));
  const fromSql = "SELECT * FROM ";
  expect(localAnalysisSuggestions(fromSql, fromSql.length, datasets)).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "table", label: "orders" }),
  ]));
});

test("limits qualified suggestions to columns from the matching dataset or alias", () => {
  expect(localAnalysisSuggestions("SELECT orders.", 14, datasets).map((item) => item.label)).toEqual(["id", "total"]);
  const aliased = "SELECT o. FROM orders AS o";
  expect(localAnalysisSuggestions(aliased, 9, datasets).map((item) => item.label)).toEqual(["id", "total"]);
});

test("suggests join predicates from source foreign keys", () => {
  const customers: DatasetRef = { ...datasets[0]!, id: "customers-id", name: "customers", relationName: "customers", sourceConnectionId: "connection-1", sourceSql: "SELECT * FROM public.customers" };
  const orders: DatasetRef = {
    ...datasets[0]!, id: "orders-id", name: "orders", relationName: "orders", sourceConnectionId: "connection-1", sourceSql: "SELECT * FROM public.orders",
    columns: [{ name: "customer_id", originalName: "customer_id", dataType: "BIGINT", sourceDataType: "int8", nullable: false }],
  };
  const metadata: RelationInfo[] = [
    { schema: "public", name: "customers", kind: "table", columns: [{ name: "id", dataType: "bigint", nullable: false, isPrimaryKey: true }] },
    { schema: "public", name: "orders", kind: "table", columns: [{ name: "customer_id", dataType: "bigint", nullable: false, isPrimaryKey: false, foreignKeyTo: { schema: "public", table: "customers", column: "id" } }] },
  ];
  const sql = "SELECT * FROM customers c JOIN orders o ON ";
  expect(localAnalysisSuggestions(sql, sql.length, [customers, orders], { "connection-1": metadata })).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "o.customer_id = c.id", kind: "keyword" }),
  ]));
});

test("omits quotes around ordinary uppercase DuckDB identifiers but keeps required quotes", () => {
  const source: DatasetRef = {
    ...datasets[0]!, relationName: "custo_marina",
    columns: [
      { name: "CARTEIRA", originalName: "CARTEIRA", dataType: "VARCHAR", sourceDataType: "text", nullable: true },
      { name: "IDADE_REALIZACAO", originalName: "IDADE_REALIZACAO", dataType: "INTEGER", sourceDataType: "int4", nullable: true },
      { name: "order", originalName: "order", dataType: "VARCHAR", sourceDataType: "text", nullable: true },
      { name: "cost label", originalName: "cost label", dataType: "VARCHAR", sourceDataType: "text", nullable: true },
    ],
  };
  const select = "SELECT  FROM custo_marina";
  const columns = localAnalysisSuggestions(select, "SELECT ".length, [source]);
  expect(columns.find((item) => item.label === "CARTEIRA")?.insertText ?? "CARTEIRA").toBe("CARTEIRA");
  expect(columns.find((item) => item.label === "IDADE_REALIZACAO")?.insertText ?? "IDADE_REALIZACAO").toBe("IDADE_REALIZACAO");
  expect(columns.find((item) => item.label === "order")?.insertText).toBe('"order"');
  expect(columns.find((item) => item.label === "cost label")?.insertText).toBe('"cost label"');
  const allColumns = columns.find((item) => item.kind === "all-columns");
  expect(allColumns?.insertText).toContain("CARTEIRA, IDADE_REALIZACAO");
  expect(localAnalysisIdentifier("custo_marina")).toBe("custo_marina");
  expect(localAnalysisIdentifier("cost label")).toBe('"cost label"');
});
