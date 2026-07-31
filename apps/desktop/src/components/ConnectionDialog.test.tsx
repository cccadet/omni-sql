import { assert, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectionDialog } from "./ConnectionDialog";
import { LanguageProvider } from "../i18n";
import { backend } from "../lib/backend";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("../lib/file-io", () => ({ pickJarPath: vi.fn() }));

const close = vi.fn();
const saved = vi.fn();

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
