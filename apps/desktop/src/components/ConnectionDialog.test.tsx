import { assert, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionDialog } from "./ConnectionDialog";
import { LanguageProvider } from "../i18n";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("../lib/file-io", () => ({ pickJarPath: vi.fn() }));

const close = vi.fn();
const saved = vi.fn();

test("keeps an existing connection ID read-only and explains why", () => {
  renderWithLanguage(
    <ConnectionDialog
      open
      editing={{ id: "conn-saved", label: "Saved", dialect: "postgres", endpoint: "db:5432/app", user: "user" }}
      onClose={close}
      onSaved={saved}
    />,
  );

  const idInput = screen.getByDisplayValue("conn-saved");
  assert.equal(idInput.getAttribute("readonly"), "");
  assert.ok(screen.getByText("Fixo para preservar as credenciais salvas."));
  assert.ok(screen.getByRole("button", { name: "Save connection" }));
});

test("does not show the internal ID for a new connection", () => {
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);

  assert.equal(screen.queryByText("ID interno"), null);
});
