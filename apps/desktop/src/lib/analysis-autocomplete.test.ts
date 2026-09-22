import { expect, test } from "vitest";
import type { DatasetRef } from "./analysis";
import { localAnalysisSuggestions } from "./analysis-autocomplete";
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
