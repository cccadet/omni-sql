import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
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
