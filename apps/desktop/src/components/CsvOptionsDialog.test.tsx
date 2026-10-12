import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { previewAnalysisCsv, type CsvPreview } from "../lib/analysis";
import { CsvOptionsDialog } from "./CsvOptionsDialog";

vi.mock("../lib/analysis", () => ({ previewAnalysisCsv: vi.fn() }));
const preview: CsvPreview = { columns: ["id", "name"], rows: [["001", "Ada;Lovelace"]], rowsMoreAvailable: true };
beforeEach(() => { localStorage.clear(); vi.mocked(previewAnalysisCsv).mockReset(); });

it("updates the native preview with the chosen delimiter before confirming", async () => {
  vi.mocked(previewAnalysisCsv).mockResolvedValue(preview);
  const resolve = vi.fn();
  render(<LanguageProvider><CsvOptionsDialog path="C:/tmp/orders.csv" onResolve={resolve} /></LanguageProvider>);
  expect(screen.getByRole("button", { name: "Import CSV" }).hasAttribute("disabled")).toBe(true);
  expect(await screen.findByText("001")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Delimiter" }), { target: { value: ";" } });
  expect(screen.queryByText("001")).toBeNull();
  expect(screen.getByRole("button", { name: "Import CSV" }).hasAttribute("disabled")).toBe(true);
  expect(await screen.findByText("Ada;Lovelace")).toBeTruthy();
  expect(previewAnalysisCsv).toHaveBeenLastCalledWith("C:/tmp/orders.csv", ";");
  fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
  expect(resolve).toHaveBeenCalledWith(";");
});

it("ignores stale preview responses", async () => {
  let finishOld!: (value: CsvPreview) => void;
  vi.mocked(previewAnalysisCsv).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; })).mockResolvedValue(preview);
  const resolve = vi.fn();
  render(<LanguageProvider><CsvOptionsDialog path="C:/tmp/orders.csv" onResolve={resolve} /></LanguageProvider>);
  await waitFor(() => expect(finishOld).toBeTypeOf("function"));
  fireEvent.change(screen.getByRole("combobox", { name: "Delimiter" }), { target: { value: "\t" } });
  expect(await screen.findByText("001")).toBeTruthy();
  await act(async () => { finishOld({ columns: ["stale"], rows: [["old result"]], rowsMoreAvailable: false }); });
  expect(screen.queryByText("old result")).toBeNull();
  expect(screen.getByText("001")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(resolve).toHaveBeenCalledWith(null);
});

it("validates custom delimiters without trimming a valid space", () => {
  const resolve = vi.fn();
  render(<LanguageProvider><CsvOptionsDialog onResolve={resolve} /></LanguageProvider>);
  fireEvent.change(screen.getByRole("combobox", { name: "Delimiter" }), { target: { value: "custom" } });
  const input = screen.getByRole("textbox", { name: "Custom delimiter" });
  const confirm = screen.getByRole("button", { name: "Choose destination" });
  for (const value of ["", "||", '"', "é", "😀"]) {
    fireEvent.change(input, { target: { value } });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Use one printable ASCII character other than double quotes, or a tab.")).toBeTruthy();
  }
  fireEvent.change(input, { target: { value: " " } });
  expect(confirm.hasAttribute("disabled")).toBe(false);
  fireEvent.click(confirm);
  expect(resolve).toHaveBeenCalledWith(" ");
  expect(previewAnalysisCsv).not.toHaveBeenCalled();
});

it("reports preview errors while allowing full import validation", async () => {
  vi.mocked(previewAnalysisCsv).mockRejectedValue(new Error("CSV preview exceeds 1 MiB"));
  const resolve = vi.fn();
  render(<LanguageProvider><CsvOptionsDialog path="C:/tmp/wide.csv" onResolve={resolve} /></LanguageProvider>);
  expect(await screen.findByText(/Preview unavailable.*exceeds 1 MiB/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
  expect(resolve).toHaveBeenCalledWith(",");
});

it("shows empty and single-column previews in Portuguese", async () => {
  localStorage.setItem("omni-sql:language", "pt-BR");
  vi.mocked(previewAnalysisCsv).mockResolvedValue({ columns: ["nome"], rows: [], rowsMoreAvailable: false });
  render(<LanguageProvider><CsvOptionsDialog path="C:/tmp/vazio.csv" onResolve={vi.fn()} /></LanguageProvider>);
  expect(await screen.findByText("Este arquivo tem cabeçalho, mas não contém linhas de dados.")).toBeTruthy();
  expect(screen.getByText(/Apenas uma coluna detectada/)).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Delimitador" })).toBeTruthy();
});
