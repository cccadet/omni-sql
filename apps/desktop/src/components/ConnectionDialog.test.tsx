import { assert, beforeEach, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConnectionDialog } from "./ConnectionDialog";
import { LanguageProvider } from "../i18n";
import { backend } from "../lib/backend";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("../lib/file-io", () => ({ pickJarPath: vi.fn() }));

const close = vi.fn();
const saved = vi.fn();

beforeEach(() => {
  vi.mocked(backend.call).mockReset();
  close.mockReset();
  saved.mockReset();
});

test("does not expose an existing connection internal ID", () => {
  renderWithLanguage(
    <ConnectionDialog
      open
      editing={{ id: "conn-saved", label: "Saved", dialect: "postgres", endpoint: "db:5432/app", user: "user" }}
      onClose={close}
      onSaved={saved}
    />,
  );

  assert.equal(screen.queryByDisplayValue("conn-saved"), null);
  assert.equal(screen.queryByText("ID interno"), null);
  assert.ok(screen.getByRole("button", { name: "Save connection" }));
});

test("duplicates editable fields with a new ID and empty password", async () => {
  const call = vi.mocked(backend.call);
  call.mockResolvedValue({ ok: true });
  renderWithLanguage(
    <ConnectionDialog
      open
      editing={{ id: "conn-saved", label: "Saved", dialect: "postgres", endpoint: "db:5432/app", user: "user" }}
      duplicating
      onClose={close}
      onSaved={saved}
    />,
  );

  assert.ok(screen.getByRole("heading", { name: "Duplicate connection" }));
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => assert.ok(call.mock.calls.length > 0));
  const [, params] = call.mock.calls.at(-1)!;
  assert.equal((params as { password?: string }).password, "");
  assert.notEqual((params as { config: { id: string } }).config.id, "conn-saved");
});

test("does not show the internal ID for a new connection", () => {
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);

  assert.equal(screen.queryByText("ID interno"), null);
});

test("tests and saves a new connection", async () => {
  const call = vi.mocked(backend.call);
  call.mockResolvedValue({ ok: true, latencyMs: 12 });
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);

  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "postgres" } });
  fireEvent.change(screen.getByPlaceholderText("My connection"), { target: { value: "Warehouse" } });
  fireEvent.change(screen.getByPlaceholderText("127.0.0.1"), { target: { value: "db.example" } });
  fireEvent.change(within(dialog).getAllByPlaceholderText("postgres")[1]!, { target: { value: "reporter" } });
  fireEvent.change(screen.getByPlaceholderText("••••••"), { target: { value: "secret" } });

  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  assert.ok(await screen.findByText("Connected in 12ms"));

  const testCall = call.mock.calls.find(([method]) => method === "connection.test");
  assert.ok(testCall);
  const testParams = testCall[1] as { config: { label: string; endpoint: string; user: string }; password: string };
  assert.equal(testParams.config.label, "Warehouse");
  assert.equal(testParams.config.endpoint, "db.example:5432/postgres");
  assert.equal(testParams.config.user, "reporter");
  assert.equal(testParams.password, "secret");

  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => assert.equal(saved.mock.calls.length, 1));
  assert.ok(call.mock.calls.some(([method]) => method === "connection.add"));
});

test("shows failed connection test and recovers on retry", async () => {
  const call = vi.mocked(backend.call);
  call.mockRejectedValueOnce(new Error("database offline"));
  call.mockResolvedValueOnce({ ok: true, latencyMs: 7 });
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);

  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "postgres" } });
  fireEvent.change(screen.getByPlaceholderText("127.0.0.1"), { target: { value: "db.example" } });
  fireEvent.change(within(dialog).getAllByPlaceholderText("postgres")[1]!, { target: { value: "reporter" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  assert.ok(await screen.findByText("database offline"));

  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  assert.ok(await screen.findByText("Connected in 7ms"));
  assert.equal(screen.queryByText("database offline"), null);
});
