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
