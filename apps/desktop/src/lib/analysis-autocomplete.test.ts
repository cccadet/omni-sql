import { expect, test } from "vitest";
import type { DatasetRef } from "./analysis";
import { localAnalysisSuggestions } from "./analysis-autocomplete";

const datasets: DatasetRef[] = [{
  id: "orders-id", workspaceId: "workspace", name: "Orders", relationName: "orders",
  columns: [
    { name: "id", originalName: "id", dataType: "BIGINT", sourceDataType: "int8", nullable: false },
    { name: "total", originalName: "total", dataType: "DECIMAL", sourceDataType: "numeric", nullable: true },
  ],
  rowCount: 2, approximateBytes: 20, createdAtMs: 1, coverage: "complete", selection: { mode: "full" }, scannedRows: 2,
}];

test("suggests local datasets, columns, and keywords", () => {
  const suggestions = localAnalysisSuggestions("SELECT ", 7, datasets);
  expect(suggestions).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "table", label: "orders" }),
    expect.objectContaining({ kind: "column", label: "total" }),
    expect.objectContaining({ kind: "keyword", label: "FROM" }),
  ]));
});

test("limits qualified suggestions to columns from the matching dataset or alias", () => {
  expect(localAnalysisSuggestions("SELECT orders.", 14, datasets).map((item) => item.label)).toEqual(["id", "total"]);
  const aliased = "SELECT o. FROM orders AS o";
  expect(localAnalysisSuggestions(aliased, 9, datasets).map((item) => item.label)).toEqual(["id", "total"]);
});
