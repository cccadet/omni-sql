import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { QueryResult } from "@omni-sql/ts-types";
import { LanguageProvider } from "../i18n";
import { ResultsGrid, serializeCellValue } from "./ResultsGrid";
import { exportCsvFile } from "../lib/file-io";

vi.mock("../lib/file-io", () => ({ exportCsvFile: vi.fn() }));

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

  fireEvent.change(screen.getByRole("textbox", { name: "Filter data…" }), { target: { value: "needle" } });
  expect(screen.getByText(serialized)).toBeTruthy();
  expect(screen.queryByText('{"nested":{"label":"other"},"values":["y",3]}')).toBeNull();

  fireEvent.change(screen.getByRole("textbox", { name: "Filter data…" }), { target: { value: "" } });
  fireEvent.click(screen.getByText("id").closest("th") as HTMLElement);
  const rows = screen.getAllByRole("row");
  expect(within(rows[1]!).getByText("2")).toBeTruthy();
  expect(within(rows[2]!).getByText("10")).toBeTruthy();
});

test("finds a column, scrolls it into focus, and temporarily highlights it", () => {
  vi.useFakeTimers();
  try {
    renderGrid();
    const header = screen.getByRole("columnheader", { name: /payload/ });
    const grid = header.closest("div[style*='overflow']")!;
    const scrollTo = vi.fn();
    Object.defineProperties(header, {
      offsetLeft: { value: 400 },
      offsetWidth: { value: 100 },
    });
    Object.defineProperties(grid, {
      clientWidth: { value: 200 },
      scrollTo: { value: scrollTo },
    });

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search columns…" }), { target: { value: "payload" } });
    fireEvent.click(screen.getByRole("button", { name: "payload" }));

    expect(scrollTo).toHaveBeenCalledWith({ left: 350, behavior: "smooth" });
    expect(header.getAttribute("data-column-focused")).toBe("true");
    expect(screen.getByText(serializeCellValue(firstPayload)).closest("td")?.getAttribute("data-column-focused")).toBe("true");

    act(() => vi.advanceTimersByTime(2_500));
    expect(header.getAttribute("data-column-focused")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Columns: payload" }));
    expect(screen.queryByRole("columnheader", { name: /payload/ })).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("exports through the native save flow", async () => {
  vi.mocked(exportCsvFile).mockResolvedValueOnce(true);
  renderGrid();
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  expect(exportCsvFile).toHaveBeenCalledWith('id,payload\n2,"{""nested"":{""label"":""needle""},""values"":[""x"",2]}"\n10,"{""nested"":{""label"":""other""},""values"":[""y"",3]}"');
});

test("exports formula-like headers and cells as spreadsheet text", async () => {
  vi.mocked(exportCsvFile).mockResolvedValueOnce(true);
  const formulaResult: QueryResult = {
    columns: [{ name: "=header", dataType: "text", nullable: true }],
    rows: [["  @SUM(A1:A2)"], ["-42"], ["normal"]],
    rowsMoreAvailable: false,
    elapsedMs: 1,
  };
  render(<LanguageProvider><ResultsGrid result={formulaResult} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  expect(exportCsvFile).toHaveBeenCalledWith("'=header\n'  @SUM(A1:A2)\n'-42\nnormal");
});

test("shows native CSV export failures", async () => {
  vi.mocked(exportCsvFile).mockRejectedValueOnce(new Error("disk full"));
  renderGrid();
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  expect(await screen.findByText("Could not save: disk full")).toBeTruthy();
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

test("adds a row from an empty editable result and omits untouched columns", async () => {
  const insertRow = vi.fn().mockResolvedValue(undefined);
  render(
    <LanguageProvider>
      <ResultsGrid
        result={{ ...result, rows: [] }}
        editability={{ editable: true, reason: null, table: { schema: "public", name: "orders" }, pkColumns: ["id"], selectStar: true, columns: [] }}
        onInsertRow={insertRow}
      />
    </LanguageProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Add row" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New row value payload" }), { target: { value: "hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Insert" }));

  expect(insertRow).toHaveBeenCalledWith({ 1: "hello" });
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
