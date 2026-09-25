import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import type { DatasetRef } from "../lib/analysis";
import { cancelAnalysis, dropAnalysisDataset, exportAnalysis, importQuerySource, listAnalysisDatasets, listAnalysisS3, renameAnalysisDataset, runAnalysis, runAnalysisS3 } from "../lib/analysis";
import { backend } from "../lib/backend";
import { AnalysisWorkspace } from "./AnalysisWorkspace";

vi.mock("../lib/analysis", async (importOriginal) => ({
  ...await importOriginal(),
  cancelAnalysis: vi.fn(),
  dropAnalysisDataset: vi.fn(),
  exportAnalysis: vi.fn(),
  importAnalysisFile: vi.fn(),
  runAnalysisS3: vi.fn(),
  listAnalysisS3: vi.fn(),
  importQuerySource: vi.fn(),
  listAnalysisDatasets: vi.fn(),
  renameAnalysisDataset: vi.fn(),
  runAnalysis: vi.fn(),
}));
vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("../lib/file-io", () => ({ pickAnalysisExportPath: vi.fn(), pickAnalysisImportPath: vi.fn() }));
vi.mock("./Editor", () => ({ Editor: ({ value, onChange, onRun }: { value: string; onChange: (value: string) => void; onRun: () => void }) => (
  <><textarea aria-label="SQL editor" value={value} onChange={(event) => onChange(event.target.value)} /><button onClick={onRun}>Editor run</button></>
) }));
vi.mock("./ResultsGrid", () => ({ ResultsGrid: ({ result, error }: { result: { rows: unknown[] } | null; error: string | null }) => (
  <div>{error ?? (result ? `${result.rows.length} result rows` : "No results")}</div>
) }));

const customer: DatasetRef = {
  id: "dataset-1", workspaceId: "workspace-1", name: "Customers", relationName: "customers",
  columns: [], rowCount: 5, approximateBytes: 100, createdAtMs: 1,
  coverage: "complete", selection: { mode: "full" }, scannedRows: 5,
  sourceConnectionId: "connection-1",
};
const order: DatasetRef = { ...customer, id: "dataset-2", name: "Orders", relationName: "orders" };

function show(dataset: DatasetRef | null = customer, onDatasetSelected = vi.fn(), initialS3Connection?: { id: string; label: string; dialect: "s3"; endpoint: string; user: string; options: { region: string; endpoint: string } }, onConfigureS3Connection?: (id: string) => void) {
  return render(<FluentProvider theme={webDarkTheme}><LanguageProvider>
    <AnalysisWorkspace workspaceId="workspace-1" dataset={dataset} onDatasetSelected={onDatasetSelected}
      sourceConnections={[{ id: "connection-1", label: "Postgres", dialect: "postgres" }]} initialS3Connection={initialS3Connection} onConfigureS3Connection={onConfigureS3Connection} />
  </LanguageProvider></FluentProvider>);
}

describe("AnalysisWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(listAnalysisDatasets).mockReset().mockResolvedValue([customer, order]);
    vi.mocked(backend.call).mockReset().mockResolvedValue({ relations: [] });
    vi.mocked(runAnalysis).mockReset();
    vi.mocked(renameAnalysisDataset).mockReset();
    vi.mocked(dropAnalysisDataset).mockReset();
    vi.mocked(importQuerySource).mockReset();
    vi.mocked(runAnalysisS3).mockReset();
    vi.mocked(listAnalysisS3).mockReset();
    vi.mocked(exportAnalysis).mockReset();
    vi.mocked(cancelAnalysis).mockReset();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("opens with saved datasets and selects one when no query has run", async () => {
    const select = vi.fn();
    show(null, select);
    await waitFor(() => expect(select).toHaveBeenCalledWith(customer));
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("No results")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Run$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens a registered S3 connection for direct query without showing connection fields", async () => {
    vi.mocked(runAnalysisS3).mockResolvedValue({ columns: [], rows: [[1]], rowsMoreAvailable: false, elapsedMs: 0 });
    vi.mocked(backend.call).mockImplementation(async (method) => method === "connection.s3Credentials"
      ? { accessKeyId: "omni_test", secretAccessKey: "omni_test_secret" } : { relations: [] });
    const select = vi.fn();
    vi.mocked(listAnalysisS3).mockResolvedValue(["s3://bucket/delta/sales/_delta_log/00000000000000000000.json"]);
    show(customer, select, { id: "s3-1", label: "Sales", dialect: "s3", endpoint: "s3://bucket", user: "", options: { region: "us-east-1", endpoint: "" } });
    expect(screen.queryByRole("textbox", { name: "S3 URI" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Listar fontes S3" }));
    await screen.findByRole("button", { name: "Abrir sales" });
    fireEvent.click(screen.getByRole("button", { name: "Abrir sales" }));
    expect((screen.getByRole("textbox", { name: "SQL editor" }) as HTMLTextAreaElement).value).toBe("SELECT * FROM s3_source");
    fireEvent.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(runAnalysisS3).toHaveBeenCalledWith(expect.objectContaining({
      uri: "s3://bucket/delta/sales", format: "delta", region: "us-east-1", sql: "SELECT * FROM s3_source",
      accessKeyId: "omni_test", secretAccessKey: "omni_test_secret",
    })));
  });

  it("asks for a DuckLake catalog when S3 only shows DuckLake data files", async () => {
    vi.mocked(backend.call).mockImplementation(async (method) => method === "connection.s3Credentials"
      ? { accessKeyId: "", secretAccessKey: undefined } : { relations: [] });
    vi.mocked(listAnalysisS3).mockResolvedValue(["s3://bucket/main/orders/ducklake-abc.parquet"]);
    const configure = vi.fn();
    show(customer, vi.fn(), { id: "s3-1", label: "Lake", dialect: "s3", endpoint: "s3://bucket", user: "", options: { region: "us-east-1", endpoint: "" } }, configure);
    fireEvent.click(screen.getByRole("button", { name: "Listar fontes S3" }));
    const button = await screen.findByRole("button", { name: "Configurar catálogo" });
    fireEvent.click(button);
    expect(configure).toHaveBeenCalledWith("s3-1");
  });

  it("keeps the edited query when the dataset list changes and runs that query", async () => {
    const select = vi.fn();
    vi.mocked(runAnalysis).mockResolvedValue({ columns: [], rows: [[1]], rowsMoreAvailable: false, elapsedMs: 1 });
    const view = show(customer, select);
    await screen.findByText("Orders");
    const editor = screen.getByRole("textbox", { name: "SQL editor" }) as HTMLTextAreaElement;
    expect(editor.value).toBe("SELECT * FROM customers");
    fireEvent.change(editor, { target: { value: "SELECT count(*) FROM customers" } });
    view.rerender(<FluentProvider theme={webDarkTheme}><LanguageProvider>
      <AnalysisWorkspace workspaceId="workspace-1" dataset={customer} onDatasetSelected={select}
        sourceConnections={[{ id: "connection-1", label: "Postgres", dialect: "postgres" }]} />
    </LanguageProvider></FluentProvider>);
    expect(editor.value).toBe("SELECT count(*) FROM customers");
    fireEvent.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() => expect(runAnalysis).toHaveBeenCalledWith("workspace-1", "SELECT count(*) FROM customers", 1000, expect.stringMatching(/^query-/)));
    expect(await screen.findByText("1 result rows")).toBeTruthy();
  });

  it("renames a dataset and updates references in the current SQL", async () => {
    const select = vi.fn();
    vi.mocked(renameAnalysisDataset).mockResolvedValue({ ...customer, name: "Clients", relationName: "clients" });
    show(customer, select);
    await screen.findByText("Orders");
    fireEvent.click(screen.getAllByRole("button", { name: "Rename dataset" })[0]!);
    fireEvent.change(screen.getByRole("textbox", { name: "Dataset name" }), { target: { value: "Clients" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dataset name" }));
    await waitFor(() => expect(renameAnalysisDataset).toHaveBeenCalledWith("workspace-1", "dataset-1", "Clients"));
    expect((screen.getByRole("textbox", { name: "SQL editor" }) as HTMLTextAreaElement).value).toContain("FROM clients");
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ name: "Clients" }));
  });

  it("deletes the selected dataset and selects the next one", async () => {
    const select = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(dropAnalysisDataset).mockResolvedValue(true);
    show(customer, select);
    await screen.findByText("Orders");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete dataset" })[0]!);
    await waitFor(() => expect(dropAnalysisDataset).toHaveBeenCalledWith("workspace-1", "dataset-1"));
    expect(select).toHaveBeenCalledWith(order);
  });

  it("imports a database table with its readable relation name", async () => {
    const select = vi.fn();
    vi.mocked(importQuerySource).mockResolvedValue(order);
    show(customer, select);
    fireEvent.click(screen.getByText("Add another database source for joins"));
    fireEvent.change(screen.getByRole("combobox", { name: "Active connection" }), { target: { value: "connection-1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Table or SELECT/WITH query" }), { target: { value: "public.orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Import source" }));
    await waitFor(() => expect(importQuerySource).toHaveBeenCalledWith(expect.objectContaining({
      name: "orders", connectionId: "connection-1", sql: 'SELECT * FROM "public"."orders"', selection: { mode: "full" },
    })));
    expect(select).toHaveBeenCalledWith(order);
  });
});
