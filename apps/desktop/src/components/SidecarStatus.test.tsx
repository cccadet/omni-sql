import { test, assert, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { SidecarStatus } from "./SidecarStatus";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedListen = vi.mocked(listen);
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedListen.mockReset();
  mockedInvoke.mockReset();
});

test("SidecarStatus follows sidecar-status events and cleans up the listener", async () => {
  let handler: ((event: { payload: string }) => void) | undefined;
  const unlisten = vi.fn();
  mockedListen.mockImplementation(async (_event, callback) => {
    handler = callback as (event: { payload: string }) => void;
    return unlisten;
  });
  mockedInvoke.mockResolvedValue("checking");

  const view = render(<SidecarStatus />);
  await waitFor(() => assert.ok(handler));
  handler?.({ payload: "ready" });
  assert.ok(await screen.findByLabelText(/ativa/));

  view.unmount();
  assert.equal(unlisten.mock.calls.length, 1);
});

test("SidecarStatus recovers the status emitted before React mounted", async () => {
  const unlisten = vi.fn();
  mockedListen.mockResolvedValue(unlisten);
  mockedInvoke.mockResolvedValue("ready");

  render(<SidecarStatus />);

  assert.ok(await screen.findByLabelText(/ativa/));
  assert.equal(mockedInvoke.mock.calls[0]?.[0], "get_sidecar_status");
});

test("SidecarStatus is unavailable when the Tauri event bridge is absent", async () => {
  mockedListen.mockRejectedValue(new Error("not running in Tauri"));

  render(<SidecarStatus />);

  assert.ok(await screen.findByLabelText(/indisponível/));
  assert.equal(screen.queryByLabelText(/ativa/), null);
});
