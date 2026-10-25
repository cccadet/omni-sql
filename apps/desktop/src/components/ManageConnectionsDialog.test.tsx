import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";
import { afterEach, expect, test, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { connectionMoveFromDrag, ManageConnectionsDialog, type ManageConnectionsDialogProps } from "./ManageConnectionsDialog";

const connections = [
  { id: "laudos", label: "Laudos HOMO", dialect: "mongodb" as const, endpoint: "mongo-homo:27017", user: "app", groupId: "homo" },
  { id: "billing", label: "Billing HOMO", dialect: "sqlserver" as const, endpoint: "sqlhomo01:1433", user: "app", groupId: "homo" },
  { id: "orders", label: "Orders", dialect: "postgres" as const, endpoint: "pg-prod:5432/orders", user: "app", groupId: "prod" },
  { id: "local", label: "Local MySQL", dialect: "mysql" as const, endpoint: "localhost:3306", user: "root", groupId: null },
];
const groups = [{ id: "homo", name: "HOMO" }, { id: "prod", name: "PROD" }];

function renderDialog(overrides: Partial<ManageConnectionsDialogProps> = {}) {
  const props: ManageConnectionsDialogProps = {
    open: true,
    onClose: vi.fn(),
    connections,
    groups,
    usage: { laudos: Date.now() - 2 * 3_600_000 },
    onAdd: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn().mockResolvedValue(null),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn().mockResolvedValue(undefined),
    onCreateGroup: vi.fn().mockResolvedValue(undefined),
    onRenameGroup: vi.fn().mockResolvedValue(undefined),
    onDeleteGroup: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <FluentProvider theme={webDarkTheme}>
      <LanguageProvider>
        <ManageConnectionsDialog {...props} />
      </LanguageProvider>
    </FluentProvider>,
  );
  return { props, dialog: screen.getByRole("dialog", { name: "Manage connections" }) };
}

afterEach(cleanup);

test("shows folders with counts and filters the table by folder and text", () => {
  const { dialog } = renderDialog();
  const folders = within(dialog).getByRole("navigation", { name: "Folders" });
  expect(within(folders).getByRole("button", { name: /All connections\s*4/ })).toBeTruthy();
  expect(within(folders).getByRole("button", { name: /^HOMO\s*2/ })).toBeTruthy();
  expect(within(folders).getByRole("button", { name: /No folder\s*1/ })).toBeTruthy();
  expect(within(dialog).getByText("2h ago")).toBeTruthy();

  fireEvent.click(within(folders).getByRole("button", { name: /^HOMO/ }));
  const rowLabels = () => within(dialog).getAllByRole("checkbox", { name: /^Select (?!all)/ }).map((box) => box.getAttribute("aria-label"));
  expect(rowLabels()).toEqual(["Select Laudos HOMO", "Select Billing HOMO"]);

  fireEvent.change(within(dialog).getByRole("textbox", { name: "Filter connections" }), { target: { value: "sqlhomo" } });
  expect(rowLabels()).toEqual(["Select Billing HOMO"]);
});

test("moves and removes the selected connections together", async () => {
  const { props, dialog } = renderDialog();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Select Laudos HOMO" }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Select Billing HOMO" }));
  expect(within(dialog).getByText("2 selected")).toBeTruthy();

  fireEvent.click(within(dialog).getByRole("button", { name: "Move to…" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "PROD" }));
  await waitFor(() => expect(props.onMove).toHaveBeenCalledTimes(2));
  expect(props.onMove).toHaveBeenNthCalledWith(1, "laudos", "prod");
  expect(props.onMove).toHaveBeenNthCalledWith(2, "billing", "prod");

  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith(["laudos", "billing"]));
});

test("exports the selected connections and reports where the file was saved", async () => {
  const onExport = vi.fn().mockResolvedValueOnce("C:/backup/omni-sql-connections.json").mockResolvedValueOnce(null);
  const { dialog } = renderDialog({ onExport });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Select Orders" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));
  await within(dialog).findByText("Exported 1 connections to C:/backup/omni-sql-connections.json (without passwords).");
  expect(onExport).toHaveBeenCalledWith(["orders"]);

  // Cancelling the save dialog clears the previous notice without reporting anything.
  fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));
  await waitFor(() => expect(onExport).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(dialog).queryByText(/^Exported/)).toBeNull());
});

test("creates, renames and deletes folders", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const { props, dialog } = renderDialog();

  fireEvent.click(within(dialog).getByRole("button", { name: "New folder" }));
  const name = within(dialog).getByRole("textbox", { name: "Folder name" });
  fireEvent.change(name, { target: { value: "Clientes" } });
  fireEvent.keyDown(name, { key: "Enter" });
  await waitFor(() => expect(props.onCreateGroup).toHaveBeenCalledWith("Clientes"));

  fireEvent.click(within(dialog).getByRole("button", { name: "Rename folder PROD" }));
  const rename = within(dialog).getByDisplayValue("PROD");
  fireEvent.change(rename, { target: { value: "Production" } });
  fireEvent.keyDown(rename, { key: "Enter" });
  await waitFor(() => expect(props.onRenameGroup).toHaveBeenCalledWith("prod", "Production"));

  fireEvent.click(within(dialog).getByRole("button", { name: "Delete folder HOMO" }));
  expect(confirm).toHaveBeenCalledWith("Delete folder “HOMO”? Its connections move to No folder.");
  await waitFor(() => expect(props.onDeleteGroup).toHaveBeenCalledWith("homo"));
  confirm.mockRestore();
});

test("shows a failed action without closing the dialog", async () => {
  const { dialog } = renderDialog({ onCreateGroup: vi.fn().mockRejectedValue(new Error("folder exists")) });
  fireEvent.click(within(dialog).getByRole("button", { name: "New folder" }));
  const name = within(dialog).getByRole("textbox", { name: "Folder name" });
  fireEvent.change(name, { target: { value: "HOMO" } });
  fireEvent.keyDown(name, { key: "Enter" });
  expect((await within(dialog).findByRole("alert")).textContent).toBe("folder exists");
});

test("drops a selected row with the rest of the selection, other rows alone", () => {
  const selected = new Set(["laudos", "billing"]);
  expect(connectionMoveFromDrag("billing", "connection-group:prod", selected)).toEqual({ connectionIds: ["laudos", "billing"], groupId: "prod" });
  expect(connectionMoveFromDrag("orders", "connection-group:root", selected)).toEqual({ connectionIds: ["orders"], groupId: null });
  expect(connectionMoveFromDrag("orders", null, selected)).toBeNull();
  expect(connectionMoveFromDrag("orders", "unrelated", selected)).toBeNull();
});
