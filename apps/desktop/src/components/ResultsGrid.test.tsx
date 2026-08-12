import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { QueryResult } from "@omni-sql/ts-types";
import { LanguageProvider } from "../i18n";
import { ResultsGrid, serializeCellValue } from "./ResultsGrid";

const result: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", nullable: false },
    { name: "payload", dataType: "json", nullable: true },
  ],
  rows: [
    [2, { nested: { label: "needle" }, values: ["x", 2] }],
    [10, { nested: { label: "other" }, values: ["y", 3] }],
  ],
  rowsMoreAvailable: false,
  elapsedMs: 1,
};

const firstPayload = result.rows[0]![1];

const renderGrid = () => render(
  <LanguageProvider>
    <ResultsGrid result={result} />
  </LanguageProvider>,
);

test("serializes nested values without object coercion", () => {
  expect(serializeCellValue(firstPayload)).toBe('{"nested":{"label":"needle"},"values":["x",2]}');
  expect(serializeCellValue(null)).toBe("");
  expect(serializeCellValue(new Date("2024-01-02T03:04:05.000Z"))).toBe("2024-01-02T03:04:05.000Z");
});

test("serializes BigInt, circular, callable, and invalid-date values safely", () => {
  const circular: { self?: unknown; count: bigint } = { count: 1n };
  circular.self = circular;
  expect(serializeCellValue(circular)).toBe('{"count":"1n","self":"[Circular]"}');
  expect(serializeCellValue(Symbol("marker"))).toBe("Symbol(marker)");
  expect(serializeCellValue(() => undefined)).toContain("=>");
  expect(serializeCellValue(new Date("invalid"))).toBe("Invalid Date");
});

test("uses serialized nested values for display, filtering, and sorting", () => {
  renderGrid();
  const serialized = serializeCellValue(firstPayload);

  expect(screen.getByText(serialized)).toBeTruthy();

  fireEvent.change(screen.getByPlaceholderText("Data..."), { target: { value: "needle" } });
  expect(screen.getByText(serialized)).toBeTruthy();
  expect(screen.queryByText('{"nested":{"label":"other"},"values":["y",3]}')).toBeNull();

  fireEvent.change(screen.getByPlaceholderText("Data..."), { target: { value: "" } });
  fireEvent.click(screen.getByText("id").closest("th") as HTMLElement);
  const rows = screen.getAllByRole("row");
  expect(within(rows[1]!).getByText("2")).toBeTruthy();
  expect(within(rows[2]!).getByText("10")).toBeTruthy();
});

test("keeps export anchor alive until click before revoking URL", () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => "blob:test");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const remove = vi.spyOn(HTMLAnchorElement.prototype, "remove");

  try {
    renderGrid();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  } finally {
    click.mockRestore();
    remove.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

test("stages editable cells and commits or discards the staged batch", async () => {
  const stage = vi.fn();
  const commit = vi.fn();
  const discard = vi.fn();
  render(
    <LanguageProvider>
      <ResultsGrid
        result={result}
        editability={{ editable: true, reason: null, table: { schema: "public", name: "orders" }, pkColumns: ["id"], selectStar: false, columns: [] }}
        onStageCellEdit={stage}
        onCommitChanges={commit}
        onDiscardChanges={discard}
      />
    </LanguageProvider>,
  );

  fireEvent.click(screen.getByText("2").closest("td")!);
  const editInput = screen.getAllByRole("textbox").at(-1)!;
  fireEvent.change(editInput, { target: { value: "7" } });
  fireEvent.keyDown(editInput, { key: "Enter" });
  expect(stage).toHaveBeenCalledWith(0, 0, "7");
  fireEvent.click(await screen.findByRole("button", { name: "Apply 1" }));
  expect(commit).toHaveBeenCalledWith([{ rowIndex: 0, colIndex: 0, value: "7" }]);

  fireEvent.click(screen.getByText("7").closest("td")!);
  const secondEdit = screen.getAllByRole("textbox").at(-1)!;
  fireEvent.change(secondEdit, { target: { value: "8" } });
  fireEvent.keyDown(secondEdit, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(discard).toHaveBeenCalledOnce();
});

test("surfaces messages and plans for result and error states", async () => {
  const resultWithMessages: QueryResult = { ...result, rowsAffected: 2, rowsMoreAvailable: true };
  render(
    <LanguageProvider>
      <ResultsGrid result={resultWithMessages} error="query failed" planText="EXPLAIN SELECT 1" />
    </LanguageProvider>,
  );

  expect(await screen.findByText("query failed")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
  expect(screen.getByText("EXPLAIN SELECT 1")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
  expect(screen.getByText("query failed")).toBeTruthy();
});
