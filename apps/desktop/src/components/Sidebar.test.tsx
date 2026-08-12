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

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    call.mockReset();
    call.mockResolvedValue({ indexes: [{ name: "orders_pkey", columns: ["id"], unique: true, primary: true }] });
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
    fireEvent.click(screen.getByRole("button", { name: "Root" }));
    await waitFor(() => expect(onMoveConnection).toHaveBeenCalledWith("connection-1", null));
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

  it("routes context-menu connection actions and persists keyboard resizing", () => {
    const onEditConnection = vi.fn();
    const onDuplicateConnection = vi.fn();
    const onRemoveConnection = vi.fn();
    renderSidebar({ onEditConnection, onDuplicateConnection, onRemoveConnection });

    fireEvent.click(screen.getByLabelText("Local database actions"));
    fireEvent.click(within(document.querySelector(".context-menu")!).getByRole("button", { name: "Edit connection" }));
    expect(onEditConnection).toHaveBeenCalledWith("connection-1");
    fireEvent.click(screen.getByLabelText("Local database actions"));
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
