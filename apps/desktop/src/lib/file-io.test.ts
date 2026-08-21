import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { basenameNoExt, exportCsvFile, pickJarPath, pickOpenPath, pickSavePath, readSqlFile, writeSqlFile } from "./file-io";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

it("handles SQL filenames across Windows and POSIX paths", () => {
  expect(basenameNoExt("/queries/Report.SQL")).toBe("Report");
  expect(basenameNoExt("C:\\queries\\draft.sql")).toBe("draft");
  expect(basenameNoExt("untitled")).toBe("untitled");
});

it("uses SQL dialog filters and maps cancelled selections to null", async () => {
  vi.mocked(save).mockResolvedValueOnce("/tmp/query.sql").mockResolvedValueOnce(null);
  vi.mocked(open).mockResolvedValueOnce("/tmp/query.sql").mockResolvedValueOnce(["/tmp/ignored.sql"]);

  await expect(pickSavePath("query")).resolves.toBe("/tmp/query.sql");
  await expect(pickSavePath("query")).resolves.toBeNull();
  await expect(pickOpenPath()).resolves.toBe("/tmp/query.sql");
  await expect(pickOpenPath()).resolves.toBeNull();
  expect(save).toHaveBeenCalledWith({ filters: [{ name: "SQL", extensions: ["sql"] }], defaultPath: "query.sql" });
  expect(open).toHaveBeenCalledWith({ filters: [{ name: "SQL", extensions: ["sql"] }], multiple: false });
});

it("uses native invoke for SQL reads and writes and JAR selection", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(undefined).mockResolvedValueOnce("SELECT 1");
  vi.mocked(open).mockResolvedValueOnce("/tmp/sidecar.jar");

  await writeSqlFile("/tmp/query.sql", "SELECT 1");
  await expect(readSqlFile("/tmp/query.sql")).resolves.toBe("SELECT 1");
  await expect(pickJarPath()).resolves.toBe("/tmp/sidecar.jar");
  expect(invoke).toHaveBeenNthCalledWith(1, "write_text_file", { path: "/tmp/query.sql", contents: "SELECT 1" });
  expect(invoke).toHaveBeenNthCalledWith(2, "read_text_file", { path: "/tmp/query.sql" });
  expect(open).toHaveBeenCalledWith({ filters: [{ name: "JAR", extensions: ["jar"] }], multiple: false });
});

it("uses the native CSV export command", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(true);

  await expect(exportCsvFile("id,name\n1,Ada")).resolves.toBe(true);
  expect(invoke).toHaveBeenCalledWith("write_csv_file", { contents: "id,name\n1,Ada" });
});
