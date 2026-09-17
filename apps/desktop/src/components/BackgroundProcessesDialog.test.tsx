import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { BackgroundProcessesDialog } from "./BackgroundProcessesDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const processes = [
  { id: "backend", pid: 123, running: true },
  { id: "jvm", pid: null, running: false },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockImplementation(async (command) => command === "get_managed_processes" ? processes : undefined);
});

test("loads process status, refreshes it, and stops a confirmed process", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<BackgroundProcessesDialog open onClose={vi.fn()} language="en" />);

  expect(await screen.findByText(/Node backend — Running \(PID 123\)/)).toBeTruthy();
  expect(screen.getByText(/JVM sidecar — Stopped/)).toBeTruthy();
  expect((screen.getAllByRole("button", { name: "Stop" })[1] as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));

  fireEvent.click(screen.getAllByRole("button", { name: "Stop" })[0]!);
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("stop_managed_process", { id: "backend" }));
  await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(4));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Stop Node backend?"));
  confirm.mockRestore();
});

test("keeps a process running when stopping is declined and reports restart errors", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  invokeMock.mockImplementation(async (command) => {
    if (command === "get_managed_processes") return processes;
    if (command === "restart_managed_processes") throw new Error("restart failed");
    return undefined;
  });
  render(<BackgroundProcessesDialog open onClose={vi.fn()} language="pt-BR" />);

  fireEvent.click((await screen.findAllByRole("button", { name: "Encerrar" }))[0]!);
  expect(invokeMock).not.toHaveBeenCalledWith("stop_managed_process", expect.anything());

  fireEvent.click(screen.getByRole("button", { name: "Reiniciar aplicativo e serviços" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Error: restart failed");
  expect(screen.getByRole("button", { name: "Reiniciar aplicativo e serviços" }).hasAttribute("disabled")).toBe(false);
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Reiniciar o omni-sql"));
  confirm.mockRestore();
});
