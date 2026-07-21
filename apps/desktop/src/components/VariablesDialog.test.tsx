import { fireEvent, render, screen } from "@testing-library/react";
import { assert, test, vi } from "vitest";
import { VariablesDialog } from "./VariablesDialog";

test("retains a submitted value after closing and reopening in the same session", () => {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  const { rerender } = render(
    <VariablesDialog open variables={["id"]} onClose={onClose} onSubmit={onSubmit} />,
  );

  const input = screen.getByPlaceholderText("Valor para :id");
  fireEvent.change(input, { target: { value: "42" } });
  fireEvent.click(screen.getByRole("button", { name: "Executar" }));

  assert.deepEqual(onSubmit.mock.calls[0]?.[0], { id: "42" });

  rerender(<VariablesDialog open={false} variables={["id"]} onClose={onClose} onSubmit={onSubmit} />);
  rerender(<VariablesDialog open variables={["id"]} onClose={onClose} onSubmit={onSubmit} />);

  assert.equal(screen.getByPlaceholderText("Valor para :id").getAttribute("value"), "42");
});
