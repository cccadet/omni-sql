import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { Sidebar } from "./Sidebar";
import { backend } from "../lib/backend";

vi.mock("./SidecarStatus", () => ({ SidecarStatus: () => <span>Sidecar ready</span> }));
vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));

const call = vi.mocked(backend.call);
const connection = {
  id: "connection-1",
  label: "Local database",
  dialect: "postgres" as const,
  endpoint: "localhost",
  user: "postgres",
  groupId: "group-1",
  lastSyncedAt: Date.now(),
};
const relations = [
  {
    schema: "public",
    name: "orders",
    description: "Customer orders",
    kind: "table" as const,
    columns: [
      { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true },
      { name: "customer_id", description: "Owning customer", dataType: "integer", nullable: false, isPrimaryKey: false, foreignKeyTo: { schema: "public", table: "customers", column: "id" } },
    ],
  },
  {
    schema: "public",
    name: "recent_orders",
    kind: "view" as const,
    columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: false }],
  },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <FluentProvider theme={webDarkTheme}>
      <LanguageProvider>
        <Sidebar
          connections={[connection]}
          connection={connection}
          connectionId={connection.id}
          relations={relations}
          functions={[{ schema: "public", name: "refresh_orders", overloads: [{ parameters: [], returnType: "void" }] }]}
          {...overrides}
        />
      </LanguageProvider>
    </FluentProvider>,
  );
}

describe("Sidebar", () => {
  it("describes metadata freshness on the refresh control", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "Refresh metadata" }).getAttribute("aria-description")).toContain("Metadata updated today");
  });

  it("shows failure even with a previous successful synchronization", () => {
    renderSidebar({ metadataRefreshFailed: true });
    const refresh = screen.getByRole("button", { name: "Refresh metadata" });
    expect(refresh.getAttribute("aria-description")).toContain("Error: Refresh metadata");
    expect(refresh.getAttribute("aria-description")).not.toContain("Metadata updated today");
    expect((refresh as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks refresh while metadata is updating", () => {
    renderSidebar({ metadataRefreshing: true, metadataRefreshFailed: true });
    const refresh = screen.getByRole("button", { name: "Refresh metadata" });
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    expect(refresh.getAttribute("aria-description")).toBe("Refresh metadata");
  });

  it("offers connection setup and names the object search in the empty state", () => {
    const onAddConnection = vi.fn();
    renderSidebar({ connections: [], connection: null, connectionId: null, relations: [], functions: [], onAddConnection });
    expect(screen.getByText("Connect a database or choose Demo in the connection form to explore without a server.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "New connection" }).at(-1)!);
    expect(onAddConnection).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "Search tables, columns…" })).toBeTruthy();
  });

  it("opens a table from its focusable action without executing SQL", () => {
    const onOpenInNewTab = vi.fn();
    renderSidebar({ onOpenInNewTab });
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    const open = screen.getByRole("button", { name: "Open public.orders in a new tab" });
    open.focus();
    expect(document.activeElement).toBe(open);
    fireEvent.click(open);
    expect(onOpenInNewTab).toHaveBeenCalledWith("orders", "SELECT * FROM public.orders LIMIT 1000");
    expect(call.mock.calls.some(([method]) => method === "query.execute")).toBe(false);
  });

  it("localizes S3 prefix controls and creates a quoted S3 query", () => {
    localStorage.setItem("omni-sql:language", "pt-BR");
    const s3 = { ...connection, dialect: "s3" as const };
    const onOpenInNewTab = vi.fn();
    const onS3PrefixChange = vi.fn();
    renderSidebar({ connection: s3, connections: [s3], relations: [{ schema: "bucket", name: "sales", kind: "table" }], functions: [], onOpenInNewTab, onS3PrefixChange });
    fireEvent.change(screen.getByRole("textbox", { name: "Prefixo S3" }), { target: { value: "data/" } });
    fireEvent.click(screen.getByRole("button", { name: "Listar" }));
    expect(onS3PrefixChange).toHaveBeenCalledWith("data/");
    fireEvent.click(screen.getByRole("button", { name: "bucket" }));
    fireEvent.click(screen.getByRole("button", { name: "Tabelas (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir bucket.sales em nova aba" }));
    expect(onOpenInNewTab).toHaveBeenCalledWith("sales", 'SELECT * FROM "bucket"."sales" LIMIT 1000');
  });
  it("summarizes DuckLake candidates and lists them grouped by bucket in a dialog", async () => {
    const s3 = { ...connection, dialect: "s3" as const };
    const onEditConnection = vi.fn();
    renderSidebar({ connection: s3, connections: [s3], relations: [], functions: [], onEditConnection, duckLakeCandidates: [
      "s3://base/ducklake/gold/orders", "s3://base/ducklake/gold/customers", "s3://other/business/visits",
    ] });
    expect(screen.queryByText("s3://base/ducklake/gold/orders")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog", { name: "Possible DuckLake prefixes" });
    expect(within(dialog).getByText("s3://base (2)")).toBeTruthy();
    expect(within(dialog).getByText("Common prefix: s3://base/ducklake/gold")).toBeTruthy();
    expect(within(dialog).getByText("s3://other/business/visits")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Configure catalog" }));
    expect(onEditConnection).toHaveBeenCalledWith(s3.id);
  });
  it("shows S3 formats and filters tables from the icon menu", async () => {
    const s3 = { ...connection, dialect: "s3" as const };
    renderSidebar({ connection: s3, connections: [s3], relations: [
      { schema: "bucket", name: "sales", kind: "table", format: "delta" },
      { schema: "bucket", name: "customers", kind: "table", format: "parquet" },
    ], schemas: ["bucket"], functions: [] });
    fireEvent.click(screen.getByRole("button", { name: "bucket" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (2)" }));
    expect(screen.getByText("delta")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Format: All formats" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "PARQUET" }));
    expect(screen.queryByText("sales")).toBeNull();
    expect(screen.getByText("customers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Format: PARQUET" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "All formats" }));
    expect(screen.getByText("sales")).toBeTruthy();
  });
  it("offers deletion for local DuckDB datasets", () => {
    const onDeleteLocalDataset = vi.fn();
    const local = { ...connection, dialect: "duckdb" as const };
    renderSidebar({ connection: local, connections: [local], relations: [relations[0]!], onDeleteLocalDataset });
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "orders" }));
    expect(screen.queryByText("Indexes")).toBeNull();
    expect(call).not.toHaveBeenCalledWith("metadata.listIndexes", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Delete dataset: orders" }));
    expect(onDeleteLocalDataset).toHaveBeenCalledWith("orders");
  });
  beforeEach(() => {
    localStorage.clear();
    call.mockReset();
    call.mockImplementation(async (method) => {
      if (method === "metadata.listRelations") return { relations };
      return { indexes: [{ name: "orders_pkey", columns: ["id"], unique: true, primary: true }] };
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens local analysis before a query result or dataset exists", () => {
    const onOpenAnalysis = vi.fn();
    renderSidebar({ onOpenAnalysis });

    fireEvent.click(screen.getByRole("button", { name: "Local analysis" }));
    fireEvent.click(screen.getByRole("button", { name: "DuckDB" }));

    expect(onOpenAnalysis).toHaveBeenCalledOnce();
  });

  it("keeps local datasets available alongside a remote connection", () => {
    const onOpenLocalDataset = vi.fn();
    const dataset = { id: "targets", workspaceId: "local-duckdb", name: "targets.csv", relationName: 'targets"2026', columns: [], rowCount: 5, approximateBytes: 100, createdAtMs: 1, coverage: "complete" as const, selection: { mode: "full" as const }, scannedRows: 5 };
    const view = renderSidebar({ localDatasets: [dataset], onOpenLocalDataset });
    const section = () => screen.getByRole("button", { name: "Local analysis" });
    expect(section().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "targets.csv" })).toBeNull();

    fireEvent.click(section());
    fireEvent.click(screen.getByRole("button", { name: "targets.csv" }));
    expect(onOpenLocalDataset).toHaveBeenCalledWith(dataset);
    expect(screen.getByRole("textbox", { name: "Search tables, columns…" })).toBeTruthy();

    view.unmount();
    renderSidebar({ localDatasets: [dataset], onOpenLocalDataset });
    expect(section().getAttribute("aria-expanded")).toBe("true");
  });

  it("searches objects, inserts qualified names, and loads indexes on expansion", async () => {
    const onInsert = vi.fn();
    renderSidebar({ onInsert });

    fireEvent.change(screen.getByPlaceholderText("Search tables, columns…"), { target: { value: "orders" } });
    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.getByText("recent_orders")).toBeTruthy();
    expect(screen.getByText("refresh_orders")).toBeTruthy();
    expect(screen.getByText("orders").getAttribute("title")).toBe("Customer orders");

    fireEvent.click(screen.getByLabelText("Insert public.orders"));
    expect(onInsert).toHaveBeenCalledWith("public.orders");

    fireEvent.click(screen.getAllByRole("button", { name: "Expand/collapse" })[0]!);
    expect((await screen.findByText("customer_id")).closest("div")?.getAttribute("title")).toContain("Owning customer");
    expect(await screen.findByText("orders_pkey")).toBeTruthy();
    expect(call).toHaveBeenCalledWith("metadata.listIndexes", { connectionId: "connection-1", schema: "public", table: "orders" });
  });

  it("loads columns from metadata cache only when a relation is expanded", async () => {
    call.mockImplementation(async (method) => {
      if (method === "metadata.listColumns") {
        return { columns: [{ name: "id", dataType: "integer", nullable: false, isPrimaryKey: true }] };
      }
      return { indexes: [] };
    });
    renderSidebar({ relations: relations.map(({ columns: _columns, ...relation }) => relation) });

    expect(screen.queryByText("id")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Expand/collapse" })[0]!);

    expect(await screen.findByText("id")).toBeTruthy();
    expect(call).toHaveBeenCalledWith("metadata.listColumns", {
      connectionId: "connection-1",
      schema: "public",
      table: "orders",
    });
  });

  it("opens definitions and keeps failures in a visible new tab", async () => {
    const onOpenInNewTab = vi.fn();
    renderSidebar({ onOpenInNewTab });

    fireEvent.change(screen.getByPlaceholderText("Search tables, columns…"), { target: { value: "orders" } });
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Generate DDL in new tab" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("metadata.getDefinition", {
      connectionId: "connection-1", kind: "table", schema: "public", name: "orders",
    }));
    await waitFor(() => expect(onOpenInNewTab).toHaveBeenCalledWith("DDL: orders", undefined));

    call.mockRejectedValueOnce(new Error("permission denied"));
    fireEvent.contextMenu(screen.getByText("recent_orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "View definition in new tab" }));
    await waitFor(() => expect(onOpenInNewTab).toHaveBeenCalledWith(
      "Def: recent_orders",
      "-- Falha ao obter definição de public.recent_orders\n-- permission denied",
    ));
  });

  it("creates the first table from an empty schema as reviewable SQL", async () => {
    const onOpenInNewTab = vi.fn();
    renderSidebar({ schemas: ["empty_schema"], relations: [], functions: [], onOpenInNewTab });

    fireEvent.click(screen.getByRole("button", { name: "empty_schema" }));
    fireEvent.contextMenu(screen.getByText("Tables (0)").closest("div")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Create table…" }));
    fireEvent.change(await screen.findByLabelText("Table name"), { target: { value: "customers" } });
    fireEvent.click(screen.getByRole("button", { name: "Open SQL" }));

    expect(onOpenInNewTab).toHaveBeenCalledWith("Create table customers", expect.stringContaining("CREATE TABLE empty_schema.customers"));
  });

  it("opens table structure with columns, indexes, and DDL", async () => {
    call.mockImplementation(async (method) => {
      if (method === "metadata.listColumns") return { columns: relations[0]!.columns };
      if (method === "metadata.listIndexes") return { indexes: [{ name: "orders_pkey", columns: ["id"], unique: true, primary: true }] };
      if (method === "metadata.getDefinition") return { sql: "CREATE TABLE public.orders (id integer);" };
      if (method === "query.run") return { columns: [{ name: "id", dataType: "integer", nullable: false }, { name: "customer_id", dataType: "integer", nullable: false }], rows: [[7, null]], rowsMoreAvailable: true, elapsedMs: 1 };
      return { relations };
    });
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    const contextMenu = within(document.querySelector(".context-menu")!);
    expect(contextMenu.getByRole("button", { name: "Insert into editor" })).toBeTruthy();
    expect(contextMenu.queryByRole("button", { name: "Edit table…" })).toBeNull();
    expect(contextMenu.getByRole("button", { name: "Generate DDL in new tab" })).toBeTruthy();
    fireEvent.click(contextMenu.getByRole("button", { name: "View structure…" }));

    expect(await screen.findByText("Structure: public.orders")).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "Columns (2)" })).toBeTruthy();
    expect(await screen.findByRole("columnheader", { name: "Sample value" })).toBeTruthy();
    expect(await screen.findByText("7")).toBeTruthy();
    expect(await screen.findByText("NULL")).toBeTruthy();
    expect(call).toHaveBeenCalledWith("query.run", {
      connectionId: "connection-1",
      sql: "SELECT * FROM public.orders",
      limit: 1,
    });
    fireEvent.click(screen.getByRole("tab", { name: "DDL" }));
    const ddl = screen.getByDisplayValue("CREATE TABLE public.orders (id integer);");
    expect(ddl.closest(".table-structure-ddl")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("opens existing table changes as reviewable ALTER TABLE SQL", async () => {
    call.mockImplementation(async (method) => method === "metadata.listColumns" ? { columns: relations[0]!.columns, constraints: [{ name: "orders_pkey", kind: "primary", columns: ["id"] }] } : { indexes: [] });
    const onOpenInNewTab = vi.fn();
    renderSidebar({ onOpenInNewTab });
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "View structure…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit structure" }));

    const typeInput = await screen.findByLabelText("Column type: customer_id");
    fireEvent.change(typeInput, { target: { value: "bigint" } });
    fireEvent.click(screen.getByRole("button", { name: "Open SQL" }));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alter orders", expect.stringContaining("ALTER COLUMN customer_id TYPE bigint"));
  });

  it("allows renaming a column and changing the primary key", async () => {
    call.mockImplementation(async (method) => method === "metadata.listColumns" ? { columns: relations[0]!.columns, constraints: [{ name: "orders_pkey", kind: "primary", columns: ["id"] }] } : { indexes: [] });
    const onOpenInNewTab = vi.fn();
    renderSidebar({ onOpenInNewTab });
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "View structure…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit structure" }));

    const nameInput = await screen.findByLabelText("Column name: id");
    nameInput.focus();
    expect(document.activeElement).toBe(nameInput);
    fireEvent.change(nameInput, { target: { value: "order_id" } });
    expect(document.activeElement).toBe(nameInput);
    fireEvent.click(screen.getByLabelText("Primary key: order_id"));
    fireEvent.click(screen.getByLabelText("Primary key: customer_id"));
    fireEvent.click(screen.getByRole("button", { name: "Open SQL" }));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alter orders", expect.stringContaining("RENAME COLUMN id TO order_id"));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alter orders", expect.stringContaining("ADD CONSTRAINT orders_pkey PRIMARY KEY (customer_id)"));
  });

  it("focuses and selects the suggested name of a newly added column", async () => {
    call.mockImplementation(async (method) => method === "metadata.listColumns" ? { columns: relations[0]!.columns } : { indexes: [] });
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "View structure…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit structure" }));
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));

    const nameInput = screen.getByLabelText("Column name: new column") as HTMLInputElement;
    expect(document.activeElement).toBe(nameInput);
    expect(nameInput.selectionStart).toBe(0);
    expect(nameInput.selectionEnd).toBe("new_column".length);
    fireEvent.change(nameInput, { target: { value: "status" } });
    expect(nameInput.value).toBe("status");
  });

  it("edits indexes from the indexes tab instead of opening the column editor", async () => {
    call.mockImplementation(async (method) => {
      if (method === "metadata.listColumns") return { columns: relations[0]!.columns };
      if (method === "metadata.listIndexes") return { indexes: [
        { name: "orders_pkey", columns: ["id"], unique: true, primary: true },
        { name: "idx_orders_customer", columns: ["customer_id"], unique: false, primary: false },
      ] };
      return { sql: "CREATE TABLE public.orders (id integer);" };
    });
    const onOpenInNewTab = vi.fn();
    renderSidebar({ onOpenInNewTab });
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "View structure…" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Indexes (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit indexes" }));

    expect(screen.queryByLabelText("Column type: customer_id")).toBeNull();
    const primaryNameInput = screen.getByLabelText("Index name: orders_pkey") as HTMLInputElement;
    expect(primaryNameInput.disabled).toBe(false);
    fireEvent.pointerDown(primaryNameInput);
    expect(document.activeElement).toBe(primaryNameInput);
    fireEvent.change(primaryNameInput, { target: { value: "orders_primary" } });
    const primaryColumnInput = screen.getByLabelText("Add column to index: orders_primary");
    fireEvent.pointerDown(primaryColumnInput);
    expect(document.activeElement).toBe(primaryColumnInput);
    fireEvent.click(primaryColumnInput);
    fireEvent.change(primaryColumnInput, { target: { value: "customer_id" } });
    fireEvent.click(await screen.findByRole("option", { name: "customer_id" }));
    const addColumnInput = screen.getByLabelText("Add column to index: idx_orders_customer");
    fireEvent.click(addColumnInput);
    fireEvent.change(addColumnInput, { target: { value: "id" } });
    fireEvent.click(await screen.findByRole("option", { name: "id" }));
    fireEvent.click(screen.getByRole("button", { name: "Open SQL" }));

    expect(onOpenInNewTab).toHaveBeenCalledWith("Alter indexes orders", expect.stringContaining("DROP INDEX public.idx_orders_customer;"));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alter indexes orders", expect.stringContaining("CREATE INDEX idx_orders_customer ON public.orders (customer_id, id);"));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alter indexes orders", expect.stringContaining("ALTER TABLE public.orders DROP CONSTRAINT orders_pkey;"));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alter indexes orders", expect.stringContaining("ADD CONSTRAINT orders_primary PRIMARY KEY (id, customer_id);"));
  });

  it("persists keyboard resizing of the object panel", () => {
    renderSidebar();
    fireEvent.keyDown(screen.getByLabelText("Resize object panel"), { key: "ArrowRight" });
    expect(localStorage.getItem("omni-sql:sidebarWidth")).toBeTruthy();
  });
});

it("opens MongoDB collections with a native filter or SQL according to the active mode", () => {
  const onOpenInNewTab = vi.fn();
  const mongo = { ...connection, dialect: "mongodb" as const };
  const view = renderSidebar({ connection: mongo, onOpenInNewTab });
  fireEvent.click(screen.getByRole("button", { name: "public" }));
  fireEvent.click(screen.getByRole("button", { name: "Collections (1)" }));
  fireEvent.doubleClick(screen.getByText("orders"));
  expect(JSON.parse(onOpenInNewTab.mock.calls[0]![1])).toEqual({ database: "public", collection: "orders", operation: "find", filter: {} });
  view.unmount();
  renderSidebar({ connection: mongo, onOpenInNewTab, mongoSqlMode: true });
  fireEvent.click(screen.getByRole("button", { name: "public" }));
  fireEvent.click(screen.getByRole("button", { name: "Collections (1)" }));
  fireEvent.doubleClick(screen.getByText("orders"));
  expect(onOpenInNewTab).toHaveBeenLastCalledWith("orders", 'SELECT * FROM "public"."orders" LIMIT 1000');
});
