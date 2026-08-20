import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { ExecutionRiskDialog } from "./ExecutionRiskDialog";

test("critical execution requires typing the affected object", () => {
  const onConfirm = vi.fn();
  render(
    <LanguageProvider>
      <ExecutionRiskDialog
        analysis={{ level: "critical", findings: [{ kind: "truncate", level: "critical", statement: "TRUNCATE TABLE users", start: 0, objectName: "users" }] }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    </LanguageProvider>,
  );
  const confirm = screen.getByRole("button", { name: "I understand, execute" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Type users to confirm"), { target: { value: "users" } });
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledWith(false);
});

test("warning execution can be confirmed after review", () => {
  const onConfirm = vi.fn();
  render(
    <LanguageProvider>
      <ExecutionRiskDialog
        analysis={{ level: "warning", findings: [{ kind: "delete-without-where", level: "warning", statement: "DELETE FROM users", start: 0 }] }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    </LanguageProvider>,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Do not warn again for warning-level statements on this connection" }));
  fireEvent.click(screen.getByRole("button", { name: "I understand, execute" }));
  expect(onConfirm).toHaveBeenCalledWith(true);
});
