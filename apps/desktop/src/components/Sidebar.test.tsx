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
    kind: "table" as const,
    columns: [
      { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true },
      { name: "customer_id", dataType: "integer", nullable: false, isPrimaryKey: false, foreignKeyTo: { schema: "public", table: "customers", column: "id" } },
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
          connectionGroups={[{ id: "group-1", name: "Production" }]}
          connection={connection}
          connectionId={connection.id}
          relations={relations}
          functions={[{ schema: "public", name: "refresh_orders", overloads: [{ parameters: [], returnType: "void" }] }]}
          health="online"
          {...overrides}
        />
      </LanguageProvider>
    </FluentProvider>,
  );
}

function createDataTransfer(): DataTransfer {
  const entries = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    getData: (format: string) => entries.get(format) ?? "",
    setData: (format: string, data: string) => { entries.set(format, data); },
  } as unknown as DataTransfer;
}

describe("Sidebar", () => {
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

  it("searches objects, inserts qualified names, and loads indexes on expansion", async () => {
    const onInsert = vi.fn();
    renderSidebar({ onInsert });

    fireEvent.change(screen.getByPlaceholderText("Search tables, columns…"), { target: { value: "orders" } });
    expect(screen.getByText("orders")).toBeTruthy();
    expect(screen.getByText("recent_orders")).toBeTruthy();
    expect(screen.getByText("refresh_orders")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Inserir public.orders"));
    expect(onInsert).toHaveBeenCalledWith("public.orders");

    fireEvent.click(screen.getAllByRole("button", { name: "Expand/collapse" })[0]!);
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

  it("manages folders and moves connections through user-visible controls", async () => {
    const onCreateConnectionGroup = vi.fn().mockResolvedValue(undefined);
    const onRenameConnectionGroup = vi.fn().mockResolvedValue(undefined);
    const onDeleteConnectionGroup = vi.fn().mockResolvedValue(undefined);
    const onMoveConnection = vi.fn().mockResolvedValue(undefined);
    renderSidebar({ onCreateConnectionGroup, onRenameConnectionGroup, onDeleteConnectionGroup, onMoveConnection });

    fireEvent.click(screen.getByLabelText("New folder"));
    fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "Analytics" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreateConnectionGroup).toHaveBeenCalledWith("Analytics");

    fireEvent.click(screen.getByLabelText("Production Edit connection"));
    const editor = screen.getByDisplayValue("Production");
    fireEvent.change(editor, { target: { value: "Primary" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onRenameConnectionGroup).toHaveBeenCalledWith("group-1", "Primary");

    fireEvent.click(screen.getByLabelText("Production Remove connection"));
    expect(onDeleteConnectionGroup).toHaveBeenCalledWith("group-1");

    fireEvent.click(screen.getByLabelText("Local database actions"));
    expect(screen.queryByRole("button", { name: "Root" })).toBeNull();
    fireEvent.mouseEnter(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Move to…" }));
    fireEvent.click(screen.getByRole("button", { name: "Root" }));
    await waitFor(() => expect(onMoveConnection).toHaveBeenCalledWith("connection-1", null));
  });

  it("aligns the Move to submenu to its item and closes it on leave", () => {
    renderSidebar();

    fireEvent.click(screen.getByLabelText("Local database actions"));
    const contextMenu = document.querySelector<HTMLUListElement>(".context-menu")!;
    const moveItem = within(contextMenu).getByRole("button", { name: "Move to…" }) as HTMLButtonElement;
    vi.spyOn(moveItem, "getBoundingClientRect").mockReturnValue({
      right: 480,
      top: 140,
    } as DOMRect);

    fireEvent.mouseEnter(moveItem);
    const submenu = document.querySelector<HTMLUListElement>(".context-submenu")!;
    expect(submenu.style.left).toBe("480px");
    expect(submenu.style.top).toBe("140px");

    fireEvent.mouseEnter(within(contextMenu).getByRole("button", { name: "Edit connection" }).closest("li") as HTMLLIElement);
    expect(document.querySelector(".context-submenu")).toBeNull();

    fireEvent.mouseEnter(moveItem);
    fireEvent.mouseLeave(document.querySelector<HTMLDivElement>(".context-menu-container")!);
    expect(document.querySelector(".context-submenu")).toBeNull();
  });


  it("moves connections by dragging them to folders and Root connections", async () => {
    const onMoveConnection = vi.fn().mockResolvedValue(undefined);
    renderSidebar({
      connectionGroups: [
        { id: "group-1", name: "Production" },
        { id: "group-2", name: "Staging" },
      ],
      onMoveConnection,
    });

    const connectionItem = document.querySelector<HTMLButtonElement>(".omni-connection-item")!;
    const stagingFolder = screen.getByText("Staging").closest(".omni-connection-folder")!;
    const folderTransfer = createDataTransfer();
    fireEvent.dragStart(connectionItem, { dataTransfer: folderTransfer });
    fireEvent.dragOver(stagingFolder, { dataTransfer: folderTransfer });
    fireEvent.drop(stagingFolder, { dataTransfer: folderTransfer });
    await waitFor(() => expect(onMoveConnection).toHaveBeenCalledWith("connection-1", "group-2"));

    const rootConnections = screen.getByText("Root connections").closest(".omni-root-connections")!;
    const rootTransfer = createDataTransfer();
    fireEvent.dragStart(connectionItem, { dataTransfer: rootTransfer });
    fireEvent.dragOver(rootConnections, { dataTransfer: rootTransfer });
    fireEvent.drop(rootConnections, { dataTransfer: rootTransfer });
    await waitFor(() => expect(onMoveConnection).toHaveBeenLastCalledWith("connection-1", null));
  });
  it("opens definitions and keeps failures in a visible new tab", async () => {
    const onOpenInNewTab = vi.fn();
    renderSidebar({ onOpenInNewTab });

    fireEvent.change(screen.getByPlaceholderText("Search tables, columns…"), { target: { value: "orders" } });
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Gerar DDL em nova aba" }));
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
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Criar tabela…" }));
    fireEvent.change(await screen.findByLabelText("Nome da tabela"), { target: { value: "customers" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir SQL" }));

    expect(onOpenInNewTab).toHaveBeenCalledWith("Criar customers", expect.stringContaining('CREATE TABLE "empty_schema"."customers"'));
  });

  it("opens table structure with columns, indexes, and DDL", async () => {
    call.mockImplementation(async (method) => {
      if (method === "metadata.listColumns") return { columns: relations[0]!.columns };
      if (method === "metadata.listIndexes") return { indexes: [{ name: "orders_pkey", columns: ["id"], unique: true, primary: true }] };
      if (method === "metadata.getDefinition") return { sql: "CREATE TABLE public.orders (id integer);" };
      return { relations };
    });
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Visualizar estrutura…" }));

    expect(await screen.findByText("Estrutura: public.orders")).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "Colunas (2)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "DDL" }));
    expect(screen.getByDisplayValue("CREATE TABLE public.orders (id integer);")).toBeTruthy();
  });

  it("opens existing table changes as reviewable ALTER TABLE SQL", async () => {
    call.mockImplementation(async (method) => method === "metadata.listColumns" ? { columns: relations[0]!.columns, constraints: [{ name: "orders_pkey", kind: "primary", columns: ["id"] }] } : { indexes: [] });
    const onOpenInNewTab = vi.fn();
    renderSidebar({ onOpenInNewTab });
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Editar tabela…" }));

    const typeInput = await screen.findByLabelText("Tipo de customer_id");
    fireEvent.change(typeInput, { target: { value: "bigint" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir SQL" }));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alterar orders", expect.stringContaining('ALTER COLUMN "customer_id" TYPE bigint'));
  });

  it("allows renaming a column and changing the primary key", async () => {
    call.mockImplementation(async (method) => method === "metadata.listColumns" ? { columns: relations[0]!.columns, constraints: [{ name: "orders_pkey", kind: "primary", columns: ["id"] }] } : { indexes: [] });
    const onOpenInNewTab = vi.fn();
    renderSidebar({ onOpenInNewTab });
    fireEvent.click(screen.getByRole("button", { name: "public" }));
    fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
    fireEvent.contextMenu(screen.getByText("orders").closest(".obj-row")!);
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Editar tabela…" }));

    fireEvent.change(await screen.findByLabelText("Nome da coluna id"), { target: { value: "order_id" } });
    fireEvent.click(screen.getByLabelText("Chave primária order_id"));
    fireEvent.click(screen.getByLabelText("Chave primária customer_id"));
    fireEvent.click(screen.getByRole("button", { name: "Abrir SQL" }));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alterar orders", expect.stringContaining('RENAME COLUMN "id" TO "order_id"'));
    expect(onOpenInNewTab).toHaveBeenCalledWith("Alterar orders", expect.stringContaining('ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("customer_id")'));
  });

  it("routes context-menu connection actions and persists keyboard resizing", () => {
    const onEditConnection = vi.fn();
    const onDuplicateConnection = vi.fn();
    const onRemoveConnection = vi.fn();
    renderSidebar({ onEditConnection, onDuplicateConnection, onRemoveConnection });

    fireEvent.click(screen.getByLabelText("Local database actions"));
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Edit connection" }));
    expect(onEditConnection).toHaveBeenCalledWith("connection-1");
    fireEvent.click(screen.getByLabelText("Local database actions"));
    expect(screen.queryByLabelText("Edit connection")).toBeNull();
    expect(screen.queryByLabelText("Duplicate connection")).toBeNull();
    expect(screen.queryByLabelText("Remove connection")).toBeNull();
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Duplicate connection" }));
    expect(onDuplicateConnection).toHaveBeenCalledWith("connection-1");
    fireEvent.click(screen.getByLabelText("Local database actions"));
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Remove connection" }));
    expect(onRemoveConnection).toHaveBeenCalledWith("connection-1");

    fireEvent.keyDown(screen.getByLabelText("Resize object panel"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByLabelText("Resize connections panel"), { key: "ArrowDown" });
    expect(localStorage.getItem("omni-sql:sidebarWidth")).toBeTruthy();
    expect(localStorage.getItem("omni-sql:connectionsHeight")).toBeTruthy();
  });
});
