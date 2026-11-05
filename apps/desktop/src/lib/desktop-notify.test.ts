import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDesktopNotificationsEnabled,
  notifyDesktop,
  saveDesktopNotificationsEnabled,
  type DesktopNotifyDeps,
} from "./desktop-notify";

function deps(overrides: Partial<DesktopNotifyDeps> = {}): DesktopNotifyDeps & { sent: unknown[]; attention: number } {
  const state = { sent: [] as unknown[], attention: 0 };
  return Object.assign(state, {
    enabled: () => true,
    inBackground: () => true,
    available: () => true,
    requestAttention: async () => { state.attention += 1; },
    permissionGranted: async () => true,
    requestPermission: async () => "granted",
    send: (n: unknown) => { state.sent.push(n); },
    ...overrides,
  });
}

describe("notifyDesktop", () => {
  it("notifies and flashes the taskbar while the window is in the background", async () => {
    const d = deps();
    expect(await notifyDesktop({ title: "T", body: "B" }, d)).toBe(true);
    expect(d.sent).toEqual([{ title: "T", body: "B" }]);
    expect(d.attention).toBe(1);
  });

  it("stays silent while the window is focused, disabled, or outside Tauri", async () => {
    for (const override of [{ inBackground: () => false }, { enabled: () => false }, { available: () => false }]) {
      const d = deps(override);
      expect(await notifyDesktop({ title: "T", body: "B" }, d)).toBe(false);
      expect(d.sent).toEqual([]);
      expect(d.attention).toBe(0);
    }
  });

  it("asks for permission once and still flashes the taskbar when it is denied", async () => {
    const request = vi.fn(async () => "denied");
    const d = deps({ permissionGranted: async () => false, requestPermission: request });
    expect(await notifyDesktop({ title: "T", body: "B" }, d)).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(d.sent).toEqual([]);
    expect(d.attention).toBe(1);
  });

  it("never throws when the plugin fails", async () => {
    const d = deps({ requestAttention: async () => { throw new Error("no window"); }, send: () => { throw new Error("boom"); } });
    expect(await notifyDesktop({ title: "T", body: "B" }, d)).toBe(false);
  });
});

describe("desktop notification setting", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to enabled and persists changes", () => {
    expect(loadDesktopNotificationsEnabled()).toBe(true);
    saveDesktopNotificationsEnabled(false);
    expect(loadDesktopNotificationsEnabled()).toBe(false);
    saveDesktopNotificationsEnabled(true);
    expect(loadDesktopNotificationsEnabled()).toBe(true);
  });
});
