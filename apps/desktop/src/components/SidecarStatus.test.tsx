import { test, assert, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { SidecarStatus } from "./SidecarStatus";
import { LanguageProvider } from "../i18n";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

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

  const view = renderWithLanguage(<SidecarStatus />);
  await waitFor(() => assert.ok(handler));
  handler?.({ payload: "ready" });
  assert.ok(await screen.findByLabelText(/Smart search: active/));

  view.unmount();
  assert.equal(unlisten.mock.calls.length, 1);
});

test("SidecarStatus recovers the status emitted before React mounted", async () => {
  const unlisten = vi.fn();
  mockedListen.mockResolvedValue(unlisten);
  mockedInvoke.mockResolvedValue("ready");

  renderWithLanguage(<SidecarStatus />);

  assert.ok(await screen.findByLabelText(/Smart search: active/));
  assert.equal(mockedInvoke.mock.calls[0]?.[0], "get_sidecar_status");
});

test("SidecarStatus is unavailable when the Tauri event bridge is absent", async () => {
  mockedListen.mockRejectedValue(new Error("not running in Tauri"));

  renderWithLanguage(<SidecarStatus />);

  assert.ok(await screen.findByLabelText(/Smart search: unavailable/));
  assert.equal(screen.queryByLabelText(/Smart search: active/), null);
});
