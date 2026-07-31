import { fireEvent, render, screen } from "@testing-library/react";
import { assert, test, vi } from "vitest";
import { VariablesDialog } from "./VariablesDialog";
import { LanguageProvider } from "../i18n";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

test("retains a submitted value after closing and reopening in the same session", () => {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  const { rerender } = renderWithLanguage(
    <VariablesDialog open variables={["id"]} onClose={onClose} onSubmit={onSubmit} />,
  );

  const input = screen.getByPlaceholderText("Value for :id");
  fireEvent.change(input, { target: { value: "42" } });
  fireEvent.click(screen.getByRole("button", { name: "Run" }));

  assert.deepEqual(onSubmit.mock.calls[0]?.[0], { id: "42" });

  rerender(<LanguageProvider><VariablesDialog open={false} variables={["id"]} onClose={onClose} onSubmit={onSubmit} /></LanguageProvider>);
  rerender(<LanguageProvider><VariablesDialog open variables={["id"]} onClose={onClose} onSubmit={onSubmit} /></LanguageProvider>);

  assert.equal(screen.getByPlaceholderText("Value for :id").getAttribute("value"), "42");
});
