import { assert, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { backend } from "../lib/backend";
import { LanguageProvider } from "../i18n";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("./SidecarStatus", () => ({ SidecarStatus: () => null }));
vi.mock("@fluentui/react-icons", () => {
  const Icon = () => null;
  return {
    AddRegular: Icon,
    ArrowEnterRegular: Icon,
    ArrowSortRegular: Icon,
    ArrowSyncRegular: Icon,
    BoxRegular: Icon,
    CheckmarkCircleRegular: Icon,
    ChevronDownRegular: Icon,
    ChevronRightRegular: Icon,
    CircleRegular: Icon,
    ClockRegular: Icon,
    CodeRegular: Icon,
    CopyRegular: Icon,
    DataBarVerticalRegular: Icon,
    DatabaseRegular: Icon,
    DeleteRegular: Icon,
    DismissRegular: Icon,
    EditRegular: Icon,
    EyeRegular: Icon,
    FingerprintRegular: Icon,
    FlashRegular: Icon,
    LinkRegular: Icon,
    ListRegular: Icon,
    MoreVerticalRegular: Icon,
    NumberSymbolRegular: Icon,
    PlayCircleRegular: Icon,
    QuestionRegular: Icon,
    SearchRegular: Icon,
    TableRegular: Icon,
    TextCaseTitleRegular: Icon,
    ToggleLeftRegular: Icon,
    WarningRegular: Icon,
  };
});

const mockedCall = vi.mocked(backend.call);

beforeEach(() => {
  mockedCall.mockReset();
});

test("loads indexes when a table is expanded and shows the empty state", async () => {
  mockedCall.mockResolvedValue({ indexes: [] });

  renderWithLanguage(
    <Sidebar
      connection={{ id: "conn-1", label: "Local", dialect: "postgres", endpoint: "localhost", user: "user" }}
      connectionId="conn-1"
      relations={[{ schema: "public", name: "users", kind: "table", columns: [] }]}
    />,
  );

  fireEvent.click(screen.getByText("public"));
  fireEvent.click(screen.getByText("Tables (1)"));
  fireEvent.click(screen.getByText("users"));

  await waitFor(() => assert.equal(mockedCall.mock.calls[0]?.[0], "metadata.listIndexes"));
  assert.ok(await screen.findByText("No indexes."));
  assert.equal(screen.queryByText("Loading…"), null);
});

test("expands tree nodes with Enter and Space", async () => {
  mockedCall.mockResolvedValue({ indexes: [] });

  renderWithLanguage(
    <Sidebar
      connectionId="conn-1"
      relations={[{ schema: "public", name: "users", kind: "table", columns: [] }]}
    />,
  );

  fireEvent.keyDown(screen.getByRole("button", { name: "public" }), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("button", { name: "Tables (1)" }), { key: " " });
  fireEvent.keyDown(screen.getByRole("button", { name: "users" }), { key: "Enter" });

  await waitFor(() => assert.equal(mockedCall.mock.calls[0]?.[0], "metadata.listIndexes"));
});

test("resizes sidebar with bounded separator keyboard controls", () => {
  renderWithLanguage(<Sidebar />);
  const separator = screen.getByRole("separator", { name: "Resize object panel" });

  assert.equal(separator.getAttribute("aria-valuenow"), "260");
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  assert.equal(separator.getAttribute("aria-valuenow"), "276");
  fireEvent.keyDown(separator, { key: "Home" });
  assert.equal(separator.getAttribute("aria-valuenow"), "160");
  fireEvent.keyDown(separator, { key: "End" });
  assert.equal(separator.getAttribute("aria-valuenow"), "640");
});

test("resizes connections panel with keyboard controls", () => {
  renderWithLanguage(<Sidebar />);
  const separator = screen.getByRole("separator", { name: "Resize connections panel" });

  assert.equal(separator.getAttribute("aria-valuenow"), "220");
  fireEvent.keyDown(separator, { key: "ArrowUp" });
  assert.equal(separator.getAttribute("aria-valuenow"), "204");
  fireEvent.keyDown(separator, { key: "Home" });
  assert.equal(separator.getAttribute("aria-valuenow"), "150");
});

test("renders configured connections", () => {
  renderWithLanguage(
    <Sidebar
      connections={[
        { id: "conn-1", label: "Local", dialect: "postgres", endpoint: "localhost", user: "user" },
        { id: "conn-2", label: "Reporting", dialect: "mysql", endpoint: "reports", user: "reader" },
      ]}
    />,
  );

  assert.ok(screen.getByRole("option", { name: "Local" }));
  assert.ok(screen.getByRole("option", { name: "Reporting" }));
});

test("selects a connection by ID", () => {
  const onSelectConnection = vi.fn();
  renderWithLanguage(
    <Sidebar
      connections={[
        { id: "conn-1", label: "Local", dialect: "postgres", endpoint: "localhost", user: "user" },
        { id: "conn-2", label: "Reporting", dialect: "mysql", endpoint: "reports", user: "reader" },
      ]}
      onSelectConnection={onSelectConnection}
    />,
  );

  fireEvent.click(screen.getByRole("option", { name: "Reporting" }));
  assert.equal(onSelectConnection.mock.calls.length, 0);
  fireEvent.click(screen.getByRole("button", { name: "Activate" }));

  assert.equal(onSelectConnection.mock.calls.length, 1);
  assert.equal(onSelectConnection.mock.calls[0]?.[0], "conn-2");
});

test("collapses connections independently from objects", () => {
  renderWithLanguage(
    <Sidebar
      connections={[{ id: "conn-1", label: "Local", dialect: "postgres", endpoint: "localhost", user: "user" }]}
      relations={[{ schema: "public", name: "users", kind: "table", columns: [] }]}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "public" }));
  fireEvent.click(screen.getByRole("button", { name: "Tables (1)" }));
  assert.ok(screen.getByText("users"));

  const connectionsToggle = screen.getByRole("button", { name: "Connections" });
  fireEvent.click(connectionsToggle);

  assert.equal(connectionsToggle.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("listbox", { name: "Connections" }), null);
  assert.equal(screen.queryByRole("separator", { name: "Resize connections panel" }), null);
  assert.ok(screen.getByText("users"));
});

test("moves dragged connection into folder drop target", () => {
  const onMoveConnection = vi.fn(async () => undefined);
  const view = renderWithLanguage(
    <Sidebar
      connections={[{ id: "conn-1", label: "Local", dialect: "postgres", endpoint: "localhost", user: "user" }]}
      connectionGroups={[{ id: "group-1", name: "Analytics" }]}
      onMoveConnection={onMoveConnection}
    />,
  );

  const dataTransfer = {
    effectAllowed: "none",
    dropEffect: "none",
    setData: vi.fn(),
    getData: vi.fn(() => "conn-1"),
  };
  const row = screen.getByRole("option", { name: "Local" }).parentElement;
  const folder = view.container.querySelector<HTMLButtonElement>(".omni-folder-toggle");
  if (!row || !folder) throw new Error("Connection drag targets not found");
  fireEvent.dragStart(row, { dataTransfer });
  fireEvent.dragOver(folder, { dataTransfer });
  fireEvent.drop(folder, { dataTransfer });

  assert.equal(dataTransfer.setData.mock.calls[0]?.[0], "text/plain");
  assert.deepEqual(onMoveConnection.mock.calls[0], ["conn-1", "group-1"]);
});
