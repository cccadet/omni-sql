// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { backend } from "./backend";
import { runMongoSql } from "./analysis";
import { importAnalysisS3, runS3CatalogQuery, startStableAnalysis, readStableAnalysisPage, dropStableAnalysis, cancelAnalysis, getAnalysisOperationStatus, runAnalysisS3, clearAnalysis, dropAnalysisDataset, exportAnalysis, importAnalysisFile, importQueryResult, importQuerySource, importS3CatalogQuery, normalizeAnalysisSource, renameAnalysisDataset, runAnalysis, suggestAnalysisDatasetName } from "./analysis";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./backend", () => ({ backend: { call: vi.fn() } }));

beforeEach(() => vi.mocked(invoke).mockReset());

test("Mongo SQL executes the native plan with its preview limit and cancellation signal", async () => {
  const signal = new AbortController().signal;
  const query = JSON.stringify({ database: "db", collection: "items", operation: "find", filter: { id_guia: "52712827" } });
  vi.mocked(backend.call).mockReset().mockResolvedValueOnce({ query }).mockResolvedValueOnce({ columns: [], rows: [["found"]], rowsMoreAvailable: true, elapsedMs: 1 });
  const result = await runMongoSql("mongo", "SELECT * FROM db.items WHERE id_guia = '52712827'", 1, "op", false, signal);
  expect(result.rows).toEqual([["found"]]);
  expect(result.rowsMoreAvailable).toBe(true);
  expect(backend.call).toHaveBeenLastCalledWith("query.run", { connectionId: "mongo", sql: query, limit: 1 }, signal);
  expect(invoke).not.toHaveBeenCalled();
});

test("Mongo SQL falls back only when planning is unsupported, never after a database failure", async () => {
  vi.mocked(backend.call).mockReset().mockResolvedValueOnce({ query: null });
  vi.mocked(invoke).mockResolvedValueOnce({ columns: [], rows: [[1]], rowsMoreAvailable: false });
  expect((await runMongoSql("mongo", "SELECT 1", 100, "op")).rows).toEqual([[1]]);
  vi.mocked(invoke).mockClear();
  vi.mocked(backend.call).mockResolvedValueOnce({ query: "{}" }).mockRejectedValueOnce(new Error("database unavailable"));
  await expect(runMongoSql("mongo", "SELECT * FROM db.items", 100, "op")).rejects.toThrow("database unavailable");
  expect(invoke).not.toHaveBeenCalled();
});

test("Mongo SQL explains the same native plan used for execution", async () => {
  vi.mocked(backend.call).mockReset().mockResolvedValueOnce({ query: "{}" }).mockResolvedValueOnce({ textual: "IXSCAN" });
  expect((await runMongoSql("mongo", "SELECT * FROM db.items", 100, "op", true)).rows).toEqual([["IXSCAN"]]);
  expect(invoke).not.toHaveBeenCalled();
});

test("imports a full S3 catalog query instead of its preview", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ id: "dataset-1" });
  await importS3CatalogQuery({
    workspaceId: "tab-1", name: "Orders", sources: [{ schema: "bucket", name: "orders", uri: "s3://bucket/orders.parquet", format: "parquet" }],
    region: "us-east-1", sql: 'SELECT * FROM "bucket"."orders"', limit: 10, selection: { mode: "full" },
  });
  expect(invoke).toHaveBeenCalledWith("analysis_import_s3_catalog", { request: expect.objectContaining({
    sql: 'SELECT * FROM "bucket"."orders"', selection: { mode: "full" }, operationId: expect.any(String),
  }) });
});

test("turns a relation name into a safe source query", () => {
  expect(normalizeAnalysisSource("orders")).toEqual({ sql: 'SELECT * FROM "orders"', suggestedName: "orders" });
  expect(normalizeAnalysisSource('sales."Order Items"')).toEqual({ sql: 'SELECT * FROM "sales"."Order Items"', suggestedName: "Order Items" });
});

test("preserves source queries and rejects unsupported input", () => {
  expect(normalizeAnalysisSource("  WITH recent AS (SELECT 1) SELECT * FROM recent  ")).toEqual({ sql: "WITH recent AS (SELECT 1) SELECT * FROM recent" });
  expect(normalizeAnalysisSource("DELETE FROM orders")).toBeNull();
  expect(normalizeAnalysisSource("orders; SELECT 1")).toBeNull();
});

test("quotes catalog paths without splitting dots or escaped quotes inside identifiers", () => {
  expect(normalizeAnalysisSource(' warehouse . "sales.eu" . "Order ""Items""" ')).toEqual({
    sql: 'SELECT * FROM "warehouse"."sales.eu"."Order ""Items"""', suggestedName: 'Order "Items"',
  });
  for (const source of ['', 'a..b', '.orders', 'orders.', 'a.b.c.d', '"unfinished', '""', 'order items', 'orders --comment']) {
    expect(normalizeAnalysisSource(source)).toBeNull();
  }
});

test("serializes nested database values without losing bigint, binary or timestamp data", async () => {
  await importQueryResult({
    workspaceId: "tab-1", name: "Values",
    result: {
      columns: [{ name: "payload", dataType: "json", nullable: true }],
      rows: [[{ id: 9_007_199_254_740_993n, created: new Date("2026-01-02T03:04:05Z"), bytes: new Uint8Array([0, 128, 255]), values: [null, true, 1.5, "text", { count: 2n }] }]],
      rowsMoreAvailable: false, elapsedMs: 0,
    },
  });
  expect(invoke).toHaveBeenCalledWith("analysis_import_result", { request: expect.objectContaining({
    rows: [[{ id: "9007199254740993", created: "2026-01-02T03:04:05.000Z", bytes: [0, 128, 255], values: [null, true, 1.5, "text", { count: "2" }] }]],
  }) });
});

test("rejects unsupported values before invoking the native import", async () => {
  await expect(importQueryResult({
    workspaceId: "tab-1", name: "Invalid",
    result: { columns: [], rows: [[{ nested: Symbol("invalid") }]], rowsMoreAvailable: false, elapsedMs: 0 },
  })).rejects.toThrow("Unsupported analytical value: symbol");
  expect(invoke).not.toHaveBeenCalled();
});

test("suggests a readable dataset name from the source relation", () => {
  expect(suggestAnalysisDatasetName('SELECT * FROM public."Order Items"', "Query 7")).toBe("Order Items");
  expect(suggestAnalysisDatasetName("SELECT 1", "Query 7")).toBe("Local analysis");
  expect(suggestAnalysisDatasetName("SELECT 1", "Revenue report")).toBe("Revenue report");
});

test("imports a bounded query result with lossless transport values", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ id: "dataset-1" });
  await importQueryResult({
    workspaceId: "tab-1",
    name: "Orders",
    result: {
      columns: [{ name: "id", dataType: "bigint", nullable: false }],
      rows: [[9_007_199_254_740_993n]],
      rowsMoreAvailable: true,
      elapsedMs: 2,
    },
  });
  expect(invoke).toHaveBeenCalledWith("analysis_import_result", {
    request: expect.objectContaining({
      workspaceId: "tab-1",
      operationId: expect.any(String),
      rows: [["9007199254740993"]],
      rowsMoreAvailable: true,
    }),
  });
});

test("runs bounded analysis and clears its workspace", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce({ columns: [], rows: [], rowsMoreAvailable: false })
    .mockResolvedValueOnce(2);
  await expect(runAnalysis("tab-1", "SELECT 1", 50)).resolves.toMatchObject({ elapsedMs: 0 });
  await expect(clearAnalysis("tab-1")).resolves.toBe(2);
  expect(invoke).toHaveBeenNthCalledWith(1, "analysis_query", {
    request: { operationId: expect.any(String), workspaceId: "tab-1", sql: "SELECT 1", limit: 50 },
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "analysis_clear", { workspaceId: "tab-1" });
});

test("starts a full source import without sending grid rows through the UI", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ id: "dataset-2" });
  await importQuerySource({
    workspaceId: "tab-1",
    name: "All orders",
    connectionId: "connection-1",
    sql: "SELECT * FROM orders",
    operationId: "import-source-1",
    selection: { mode: "full" },
  });
  expect(invoke).toHaveBeenCalledWith("analysis_import_source", {
    request: {
      operationId: "import-source-1",
      workspaceId: "tab-1",
      name: "All orders",
      connectionId: "connection-1",
      sql: "SELECT * FROM orders",
      selection: { mode: "full" },
      batchSize: 1_000,
    },
  });
});

test("uses scoped file commands for full export and sampled import", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce({ path: "C:\\tmp\\orders.parquet", rows: 3, bytes: 99 })
    .mockResolvedValueOnce({ id: "dataset-file" });
  await exportAnalysis({ workspaceId: "tab-1", sql: "SELECT * FROM dataset_1", path: "C:\\tmp\\orders.parquet", format: "parquet", operationId: "export-1" });
  await importAnalysisFile({ workspaceId: "tab-1", name: "Orders", path: "C:\\tmp\\orders.parquet", format: "parquet", selection: { mode: "reservoir", rows: 25, seed: 42 }, operationId: "file-1" });
  expect(invoke).toHaveBeenNthCalledWith(1, "analysis_export_query", { request: expect.objectContaining({ operationId: "export-1", format: "parquet" }) });
  expect(invoke).toHaveBeenNthCalledWith(2, "analysis_import_file", { request: expect.objectContaining({ operationId: "file-1", selection: { mode: "reservoir", rows: 25, seed: 42 } }) });
});

test("renames an analytical dataset through the Tauri bridge", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ id: "dataset-1", name: "Orders 2026", relationName: "orders_2026" });
  await renameAnalysisDataset("tab-1", "dataset-1", "Orders 2026");
  expect(invoke).toHaveBeenCalledWith("analysis_rename_dataset", {
    workspaceId: "tab-1",
    datasetId: "dataset-1",
    name: "Orders 2026",
  });
});

test("drops an analytical dataset through the Tauri bridge", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(true);
  await expect(dropAnalysisDataset("tab-1", "dataset-1")).resolves.toBe(true);
  expect(invoke).toHaveBeenCalledWith("analysis_drop_dataset", {
    workspaceId: "tab-1",
    datasetId: "dataset-1",
  });
});


test("keeps stable result pages and cancellation tied to their workspace and operation", async () => {
  const handle = { id: "result-1", workspaceId: "tab-1", columns: [], rowCount: 2500, createdAtMs: 1 };
  const page = { columns: [], rows: [[2001]], rowsMoreAvailable: true };
  vi.mocked(invoke).mockResolvedValueOnce(handle).mockResolvedValueOnce(page)
    .mockResolvedValueOnce({ operationId: "page-1", state: "running" })
    .mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  await expect(startStableAnalysis("tab-1", "SELECT * FROM orders", "start-1")).resolves.toEqual(handle);
  await expect(readStableAnalysisPage("tab-1", handle.id, 2000, 500, "page-1")).resolves.toEqual({ ...page, elapsedMs: 0 });
  await expect(getAnalysisOperationStatus("page-1")).resolves.toEqual({ operationId: "page-1", state: "running" });
  await expect(cancelAnalysis("page-1")).resolves.toBe(true);
  await expect(dropStableAnalysis("tab-1", handle.id)).resolves.toBe(true);
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["analysis_query_start", { request: { operationId: "start-1", workspaceId: "tab-1", sql: "SELECT * FROM orders" } }],
    ["analysis_query_page", { request: { operationId: "page-1", workspaceId: "tab-1", handleId: "result-1", offset: 2000, limit: 500 } }],
    ["analysis_operation_status", { operationId: "page-1" }],
    ["analysis_cancel", { operationId: "page-1" }],
    ["analysis_query_drop", { workspaceId: "tab-1", handleId: "result-1" }],
  ]);
});

test("propagates page failures without returning a fabricated empty result", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("result handle expired"));
  await expect(readStableAnalysisPage("tab-1", "expired", 0)).rejects.toThrow("result handle expired");
  expect(invoke).toHaveBeenCalledWith("analysis_query_page", { request: expect.objectContaining({ handleId: "expired", offset: 0, limit: 1000 }) });
});

test("S3 preview preserves query options and applies a bounded default limit", async () => {
  const source = { workspaceId: "tab-1", uri: "s3://orders/data.parquet", format: "parquet" as const, region: "us-east-1", sql: "SELECT * FROM source", endpoint: "http://127.0.0.1:5000" };
  const result = { columns: [], rows: [[1]], rowsMoreAvailable: true };
  vi.mocked(invoke).mockResolvedValue(result);
  await expect(runAnalysisS3(source)).resolves.toEqual({ ...result, elapsedMs: 0 });
  await runAnalysisS3({ ...source, limit: 25, operationId: "preview-1" });
  expect(invoke).toHaveBeenNthCalledWith(1, "analysis_query_s3", { request: { ...source, limit: 1000, operationId: expect.any(String) } });
  expect(invoke).toHaveBeenNthCalledWith(2, "analysis_query_s3", { request: { ...source, limit: 25, operationId: "preview-1" } });
});


test("DuckLake imports retain the selected catalog, table and reservoir provenance", async () => {
  const input = {
    workspaceId: "tab-1", name: "Orders", uri: "s3://bucket/lake", format: "ducklake" as const,
    tableSchema: "sales", tableName: "orders", catalog: { kind: "sqlite" as const, path: "/tmp/catalog.ducklake" },
    region: "us-east-1", selection: { mode: "reservoir" as const, rows: 25, seed: 42 },
  };
  vi.mocked(invoke).mockResolvedValue({ id: "imported" });
  await expect(importAnalysisS3(input)).resolves.toEqual({ id: "imported" });
  await importAnalysisS3({ ...input, operationId: "import-lake-1" });
  expect(invoke).toHaveBeenNthCalledWith(1, "analysis_import_s3", { request: { ...input, operationId: expect.any(String) } });
  expect(invoke).toHaveBeenNthCalledWith(2, "analysis_import_s3", { request: { ...input, operationId: "import-lake-1" } });
});

test("catalog preview retains multiple sources and propagates native query errors", async () => {
  const input = {
    workspaceId: "tab-1", region: "us-east-1", sql: 'SELECT * FROM "bucket"."orders"', limit: 25,
    sources: [{ schema: "bucket", name: "orders", uri: "s3://bucket/orders.parquet", format: "parquet" as const }],
  };
  const result = { columns: [], rows: [[1]], rowsMoreAvailable: false };
  vi.mocked(invoke).mockResolvedValueOnce(result).mockRejectedValueOnce(new Error("catalog unavailable"));
  await expect(runS3CatalogQuery(input)).resolves.toEqual({ ...result, elapsedMs: 0 });
  await expect(runS3CatalogQuery({ ...input, operationId: "catalog-1" })).rejects.toThrow("catalog unavailable");
  expect(invoke).toHaveBeenNthCalledWith(1, "analysis_query_s3_catalog", { request: { ...input, operationId: expect.any(String) } });
  expect(invoke).toHaveBeenNthCalledWith(2, "analysis_query_s3_catalog", { request: { ...input, operationId: "catalog-1" } });
});
