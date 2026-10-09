import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { QueryResult } from "@omni-sql/ts-types";
import { LanguageProvider } from "../i18n";
import { ResultsGrid, serializeCellValue } from "./ResultsGrid";
import { exportCsvFile, openExportedFile, revealExportedFile } from "../lib/file-io";

vi.mock("../lib/file-io", () => ({ exportCsvFile: vi.fn(), openExportedFile: vi.fn(), revealExportedFile: vi.fn() }));

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

test("distinguishes empty queries, unmatched filters, and execution failures", () => {
  const { rerender } = render(<LanguageProvider><ResultsGrid result={{ ...result, rows: [] }} /></LanguageProvider>);
  expect(screen.getByText("The query returned no rows. Review its filters and run it again.")).toBeTruthy();
  rerender(<LanguageProvider><ResultsGrid result={result} /></LanguageProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Filter data…" }), { target: { value: "absent-value" } });
  expect(screen.getByText("No rows match this filter. Clear or change the filter.")).toBeTruthy();
  rerender(<LanguageProvider><ResultsGrid error="Synthetic query error" /></LanguageProvider>);
  expect(screen.getByRole("alert").textContent).toBe("Synthetic query error");
  fireEvent.click(screen.getByRole("tab", { name: "Data" }));
  expect(screen.getByText("Execution failed. Check Messages, adjust the statement, and try again.")).toBeTruthy();
});

const renderGrid = () => render(
  <LanguageProvider>
    <ResultsGrid result={result} />
  </LanguageProvider>,
);

test("sorts duplicate column names independently through focusable headers", () => {
  render(<LanguageProvider><ResultsGrid result={{ ...result,
    columns: [result.columns[0]!, result.columns[0]!], rows: [[2, 30], [10, 1]],
  }} /></LanguageProvider>);
  const buttons = screen.getAllByRole("button", { name: "Sort by id" });
  buttons[1]!.focus();
  fireEvent.click(buttons[1]!);
  expect(buttons[1]!.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
  expect(within(screen.getAllByRole("row")[1]!).getByText("10")).toBeTruthy();
  fireEvent.click(buttons[1]!);
  expect(buttons[1]!.closest("th")?.getAttribute("aria-sort")).toBe("descending");
  expect(within(screen.getAllByRole("row")[1]!).getByText("2")).toBeTruthy();
});

test("navigates read-only cells without intercepting filter keys or starting an editor", () => {
  renderGrid();
  const cells = screen.getAllByRole("cell");
  cells[0]!.focus();
  fireEvent.keyDown(cells[0]!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(cells[1]);
  fireEvent.keyDown(cells[1]!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(cells[3]);
  fireEvent.keyDown(cells[3]!, { key: "Home", ctrlKey: true });
  expect(document.activeElement).toBe(cells[0]);
  fireEvent.keyDown(cells[0]!, { key: "F2" });
  expect(screen.queryByRole("textbox", { name: "Edit id, row 1" })).toBeNull();
  const filter = screen.getByRole("textbox", { name: "Filter data…" });
  filter.focus();
  expect(fireEvent.keyDown(filter, { key: "ArrowDown" })).toBe(true);
  expect(document.activeElement).toBe(filter);
});

test("keeps a cell reachable after pagination, filtering and hiding the active column", () => {
  render(<LanguageProvider><ResultsGrid result={{ ...result,
    rows: Array.from({ length: 101 }, (_, index) => [index, `item-${index}`]),
  }} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  let cell = screen.getByText("100").closest("td")!;
  expect(cell.tabIndex).toBe(0);
  cell.focus();
  fireEvent.keyDown(cell, { key: "ArrowRight" });
  expect(document.activeElement?.textContent).toBe("item-100");
  fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Columns: payload" }));
  expect(cell.tabIndex).toBe(0);
  fireEvent.change(screen.getByRole("textbox", { name: "Filter data…" }), { target: { value: "item-50" } });
  cell = screen.getByText("50").closest("td")!;
  expect(cell.tabIndex).toBe(0);
  cell.focus();
  fireEvent.keyDown(cell, { key: "ArrowRight" });
  expect(document.activeElement).toBe(cell);
});

test("edits sorted rows by keyboard, restores focus and applies only explicitly", async () => {
  const apply = vi.fn().mockResolvedValue(undefined);
  render(<LanguageProvider><ResultsGrid result={result}
    editability={{ editable: true, reason: null, table: { schema: "public", name: "orders" }, pkColumns: ["id"], selectStar: true, columns: [] }}
    onCommitChanges={apply} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Sort by id" }));
  fireEvent.click(screen.getByRole("button", { name: "Sort by id" }));
  const cell = screen.getByText("10").closest("td")!;
  cell.focus();
  fireEvent.keyDown(cell, { key: "Enter" });
  let input = screen.getByRole("textbox", { name: "Edit id, row 2" });
  fireEvent.change(input, { target: { value: "99" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(document.activeElement).toBe(cell);
  expect(screen.queryByRole("button", { name: "Apply 1" })).toBeNull();
  fireEvent.keyDown(cell, { key: "F2" });
  input = screen.getByRole("textbox", { name: "Edit id, row 2" });
  fireEvent.change(input, { target: { value: "99" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(document.activeElement).toBe(cell);
  expect(screen.getByText("Pending changes: 1").getAttribute("role")).toBe("status");
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply 1" }));
  expect(apply).toHaveBeenCalledWith([{ rowIndex: 1, colIndex: 0, value: "99" }]);
  await screen.findByText("Pending changes: 0");
  expect(document.activeElement).toBe(cell);
  fireEvent.keyDown(cell, { key: "F2" });
  input = screen.getByRole("textbox", { name: "Edit id, row 2" });
  fireEvent.change(input, { target: { value: "88" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const discard = screen.getByRole("button", { name: "Discard changes" });
  discard.focus();
  fireEvent.click(discard);
  expect(document.activeElement).toBe(cell);
  expect(apply).toHaveBeenCalledTimes(1);
});

test("offers full analytical CSV export separately from the grid export", () => {
  const onExportFullCsv = vi.fn();
  render(<LanguageProvider><ResultsGrid result={result} onExportFullCsv={onExportFullCsv} /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Export full CSV" }));
  expect(onExportFullCsv).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
});

test("shows query progress instead of the empty state while running", () => {
  render(
    <LanguageProvider>
      <ResultsGrid running result={null} />
    </LanguageProvider>,
  );

  expect(screen.getByTestId("query-running-indicator").textContent).toContain("Running…");
  expect(screen.queryByText("No results")).toBeNull();
});

test("offers result tools only after execution and apply only for pending edits", () => {
  const { rerender } = render(<LanguageProvider><ResultsGrid /></LanguageProvider>);
  expect(screen.getByText("Run a statement to view its results here.")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Filter data…" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();

  rerender(<LanguageProvider><ResultsGrid result={result} /></LanguageProvider>);
  expect(screen.getByRole("textbox", { name: "Filter data…" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Columns" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();

  rerender(<LanguageProvider><ResultsGrid result={result} stagedChanges={[{ rowIndex: 0, colIndex: 0, value: 7 }]} /></LanguageProvider>);
  expect(screen.getByRole("button", { name: "Apply 1" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeTruthy();
});

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
  vi.mocked(exportCsvFile).mockResolvedValueOnce("C:\\exports\\resultados.csv");
  vi.mocked(openExportedFile).mockResolvedValueOnce(undefined);
  vi.mocked(revealExportedFile).mockResolvedValueOnce(undefined);
  renderGrid();
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  expect(exportCsvFile).toHaveBeenCalledWith('id,payload\n2,"{""nested"":{""label"":""needle""},""values"":[""x"",2]}"\n10,"{""nested"":{""label"":""other""},""values"":[""y"",3]}"');
  expect(await screen.findByText("2 rows saved to resultados.csv")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Open CSV" }));
  expect(openExportedFile).toHaveBeenCalledWith("C:\\exports\\resultados.csv");
});

test("displays BSON values without envelopes while retaining exact raw values", () => {
  const values = { id: { $oid: "6ac4e4f54dee13476cf0fbd0" }, date: { $date: { $numberLong: "0" } }, items: [{ count: { $numberLong: "9007199254740993" }, price: { $numberDecimal: "12345678901234567890.123456789" } }] };
  expect(serializeCellValue(values, true)).toBe('{"id":"6ac4e4f54dee13476cf0fbd0","date":"1970-01-01T00:00:00.000Z","items":[{"count":"9007199254740993","price":"12345678901234567890.123456789"}]}');
  expect(serializeCellValue(values)).toBe(JSON.stringify(values));
  expect(serializeCellValue({ $date: "2024-01-02T03:04:05+03:00" }, true)).toBe("2024-01-02T00:04:05.000Z");
  for (const value of [{ $oid: "invalid" }, { $date: { $numberLong: "999999999999999999" } }, { $date: "invalid" }, { $numberLong: "abc" }, { $oid: "6ac4e4f54dee13476cf0fbd0", other: 1 }]) {
    expect(serializeCellValue(value, true)).toBe(JSON.stringify(value));
  }
  const circular: { self?: unknown } = {};
  circular.self = circular;
  expect(serializeCellValue(circular, true)).toBe('{"self":"[Circular]"}');
});

test("Mongo result cells show readable IDs and dates, filter by them and export original BSON", () => {
  const mongo: QueryResult = {
    columns: [{ name: "_id", dataType: "JSON", nullable: false }, { name: "data_evento", dataType: "JSON", nullable: false }],
    rows: [[{ $oid: "6ac4e4f54dee13476cf0fbd0" }, { $date: { $numberLong: "0" } }]],
    rowsMoreAvailable: false, elapsedMs: 1,
  };
  render(<LanguageProvider><ResultsGrid result={mongo} /></LanguageProvider>);
  expect(screen.getByText("6ac4e4f54dee13476cf0fbd0").getAttribute("title")).toBe('{"$oid":"6ac4e4f54dee13476cf0fbd0"}');
  expect(screen.getByText("1970-01-01T00:00:00.000Z")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Filter data…" }), { target: { value: "1970-01-01" } });
  expect(screen.getByText("6ac4e4f54dee13476cf0fbd0")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  expect(exportCsvFile).toHaveBeenLastCalledWith('_id,data_evento\n"{""$oid"":""6ac4e4f54dee13476cf0fbd0""}","{""$date"":{""$numberLong"":""0""}}"');
});

test("exports formula-like headers and cells as spreadsheet text", async () => {
  vi.mocked(exportCsvFile).mockResolvedValueOnce("/tmp/resultados.csv");
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

test("opens a foreign key in the related tab without starting cell editing", async () => {
  const lookup = vi.fn().mockResolvedValue({
    columns: [{ name: "name", dataType: "text", nullable: false }],
    rows: [["Acme"]], rowsMoreAvailable: false, elapsedMs: 1,
  });
  render(<LanguageProvider><ResultsGrid
    result={{ ...result, columns: [{ name: "customer_id", dataType: "integer", nullable: false }], rows: [[42]] }}
    editability={{ editable: true, reason: null, table: { schema: "public", name: "orders" }, pkColumns: ["customer_id"], selectStar: true, columns: [] }}
    relations={[{ schema: "public", name: "orders", kind: "table", columns: [{ name: "customer_id", dataType: "integer", nullable: false, isPrimaryKey: true, foreignKeyTo: { schema: "public", table: "customers", column: "id" } }] }]}
    onLookupRelated={lookup}
    onCellEdit={vi.fn()}
  /></LanguageProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open related record: 42" }));
  expect(lookup).toHaveBeenCalledWith({ schema: "public", table: "orders", column: "customer_id" }, 42);
  expect(screen.queryByRole("textbox", { name: "42" })).toBeNull();
  expect(await screen.findByText("Acme")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close related record" }));
  expect(screen.queryByRole("tab", { name: "Related" })).toBeNull();
  fireEvent.click(screen.getByText("42").closest("td")!);
  expect(screen.getByDisplayValue("42")).toBeTruthy();
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

test("cancels a new row with Escape and clears its draft", () => {
  render(
    <LanguageProvider>
      <ResultsGrid
        result={{ ...result, rows: [] }}
        editability={{ editable: true, reason: null, table: { schema: "public", name: "orders" }, pkColumns: ["id"], selectStar: true, columns: [] }}
        onInsertRow={vi.fn()}
      />
    </LanguageProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Add row" }));
  const input = screen.getByRole("textbox", { name: "New row value payload" });
  fireEvent.change(input, { target: { value: "discard me" } });
  fireEvent.keyDown(input, { key: "Escape" });

  expect(screen.queryByTestId("new-row")).toBeNull();
  expect(screen.getByRole("button", { name: "Add row" })).toBeTruthy();
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
