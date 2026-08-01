import { assert, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { backend } from "../lib/backend";
import { LanguageProvider } from "../i18n";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("./SidecarStatus", () => ({ SidecarStatus: () => null }));

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
