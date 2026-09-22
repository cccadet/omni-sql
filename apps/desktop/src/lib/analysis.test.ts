import { beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearAnalysis, exportAnalysis, importAnalysisFile, importQueryResult, importQuerySource, renameAnalysisDataset, runAnalysis } from "./analysis";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => vi.mocked(invoke).mockReset());

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
