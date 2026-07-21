import { assert, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { backend } from "../lib/backend";

vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("./SidecarStatus", () => ({ SidecarStatus: () => null }));

const mockedCall = vi.mocked(backend.call);

beforeEach(() => {
  mockedCall.mockReset();
});

test("loads indexes when a table is expanded and shows the empty state", async () => {
  mockedCall.mockResolvedValue({ indexes: [] });

  render(
    <Sidebar
      connection={{ id: "conn-1", label: "Local", dialect: "postgres", endpoint: "localhost", user: "user" }}
      connectionId="conn-1"
      relations={[{ schema: "public", name: "users", kind: "table", columns: [] }]}
    />,
  );

  fireEvent.click(screen.getByText("public"));
  fireEvent.click(screen.getByText("Tabelas (1)"));
  fireEvent.click(screen.getByText("users"));

  await waitFor(() => assert.equal(mockedCall.mock.calls[0]?.[0], "metadata.listIndexes"));
  assert.ok(await screen.findByText("Nenhum índice."));
  assert.equal(screen.queryByText("Carregando..."), null);
});
