import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { ConnectionSwitcher, type ConnectionSwitcherProps } from "./ConnectionSwitcher";

const connections = [
  { id: "laudos", label: "Laudos HOMO", dialect: "mongodb" as const, endpoint: "mongo-homo:27017", user: "app", groupId: "homo", options: { environment: "staging" } },
  { id: "billing", label: "Billing HOMO", dialect: "sqlserver" as const, endpoint: "sqlhomo01:1433", user: "app", groupId: "homo" },
  { id: "orders", label: "Orders", dialect: "postgres" as const, endpoint: "pg-prod:5432/orders", user: "app", groupId: "prod", options: { environment: "production" } },
  { id: "local", label: "Local MySQL", dialect: "mysql" as const, endpoint: "localhost:3306", user: "root" },
];
const groups = [{ id: "homo", name: "HOMO" }, { id: "prod", name: "PROD" }];

function renderSwitcher(overrides: Partial<ConnectionSwitcherProps> = {}) {
  const props: ConnectionSwitcherProps = {
    connections,
    groups,
    activeConnectionId: "laudos",
    health: "online",
    usage: { orders: 2_000, laudos: 3_000 },
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onManage: vi.fn(),
    ...overrides,
  };
  render(
    <FluentProvider theme={webDarkTheme}>
      <LanguageProvider>
        <ConnectionSwitcher {...props} />
      </LanguageProvider>
    </FluentProvider>,
  );
  return props;
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: "Switch connection: Laudos HOMO" }));
  return screen.getByRole("dialog", { name: "Switch connection" });
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test("lists recent connections first, then folders and connections without a folder", () => {
  renderSwitcher();
  const panel = openPanel();
  const sections = within(panel).getAllByRole("region").map((section) => section.getAttribute("aria-label"));
  expect(sections).toEqual(["Recent", "HOMO", "PROD", "No folder"]);
  const recent = within(within(panel).getByRole("region", { name: "Recent" })).getAllByRole("button", { name: /HOMO|Orders/ })
    .filter((button) => !button.getAttribute("aria-label")?.startsWith("Actions"));
  expect(recent.map((button) => button.textContent)).toEqual([expect.stringContaining("Laudos HOMO"), expect.stringContaining("Orders")]);
  expect(within(panel).getAllByRole("button", { name: /^Laudos HOMO/ })[0]!.getAttribute("aria-current")).toBe("true");
});

test("searches by name, host, type, folder or environment and switches with the keyboard", () => {
  const props = renderSwitcher();
  const panel = openPanel();
  const search = within(panel).getByRole("textbox", { name: "Search connections" });

  fireEvent.change(search, { target: { value: "sqlhomo" } });
  expect(within(panel).queryByRole("button", { name: /^Orders/ })).toBeNull();
  expect(within(panel).getByRole("button", { name: /^Billing HOMO/ })).toBeTruthy();

  fireEvent.change(search, { target: { value: "production" } });
  expect(within(panel).getByRole("button", { name: /^Orders/ })).toBeTruthy();
  expect(within(panel).queryByRole("button", { name: /^Billing HOMO/ })).toBeNull();

  fireEvent.change(search, { target: { value: "homo" } });
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(props.onSelect).toHaveBeenCalledWith("billing");
  expect(screen.queryByRole("dialog", { name: "Switch connection" })).toBeNull();

  openPanel();
  fireEvent.change(screen.getByRole("textbox", { name: "Search connections" }), { target: { value: "nothing like this" } });
  expect(screen.getByText("No connections match the search.")).toBeTruthy();
});

test("collapses folders and remembers it", () => {
  renderSwitcher();
  const panel = openPanel();
  fireEvent.click(within(panel).getByRole("button", { name: /^PROD/ }));
  expect(within(within(panel).getByRole("region", { name: "PROD" })).queryByRole("button", { name: /^Orders/ })).toBeNull();
  expect(JSON.parse(localStorage.getItem("omni-sql:collapsedConnectionFolders")!)).toEqual(["prod"]);
});

test("routes row actions, moves between folders and opens management", async () => {
  const props = renderSwitcher();
  let panel = openPanel();
  fireEvent.click(within(panel).getAllByRole("button", { name: "Actions for Billing HOMO" })[0]!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit connection" }));
  expect(props.onEdit).toHaveBeenCalledWith("billing");

  panel = openPanel();
  fireEvent.click(within(panel).getAllByRole("button", { name: "Actions for Billing HOMO" })[0]!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Move to folder" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "PROD" }));
  await waitFor(() => expect(props.onMove).toHaveBeenCalledWith("billing", "prod"));

  fireEvent.click(within(screen.getByRole("dialog", { name: "Switch connection" })).getAllByRole("button", { name: "Actions for Local MySQL" })[0]!);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Remove…" }));
  expect(props.onRemove).toHaveBeenCalledWith("local");

  panel = openPanel();
  fireEvent.click(within(panel).getByRole("button", { name: "Manage connections…" }));
  expect(props.onManage).toHaveBeenCalledOnce();
});

test("offers the first connection when none exist", () => {
  const props = renderSwitcher({ connections: [], groups: [], activeConnectionId: null, usage: {} });
  fireEvent.click(screen.getByRole("button", { name: "Switch connection: No connection selected" }));
  const panel = screen.getByRole("dialog", { name: "Switch connection" });
  expect(within(panel).getByText("Connect a database or choose Demo in the connection form to explore without a server.")).toBeTruthy();
  fireEvent.click(within(panel).getByRole("button", { name: "New connection" }));
  expect(props.onAdd).toHaveBeenCalledOnce();
});
