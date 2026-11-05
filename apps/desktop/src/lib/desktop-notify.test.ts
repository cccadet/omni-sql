import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  requestUserAttention: vi.fn(async () => undefined),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ requestUserAttention: tauri.requestUserAttention }),
  UserAttentionType: { Critical: 1, Informational: 2 },
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => "granted",
  sendNotification: tauri.sendNotification,
}));

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

describe("notifyDesktop default wiring", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("uses window focus to decide and goes through the Tauri plugins", async () => {
    tauri.sendNotification.mockClear();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    expect(await notifyDesktop({ title: "T", body: "B" })).toBe(false);
    expect(tauri.sendNotification).not.toHaveBeenCalled();

    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(await notifyDesktop({ title: "T", body: "B" })).toBe(true);
    expect(tauri.sendNotification).toHaveBeenCalledWith({ title: "T", body: "B" });
    expect(tauri.requestUserAttention).toHaveBeenCalledWith(1);
  });

  it("respects the saved setting", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    saveDesktopNotificationsEnabled(false);
    tauri.sendNotification.mockClear();
    expect(await notifyDesktop({ title: "T", body: "B" })).toBe(false);
    expect(tauri.sendNotification).not.toHaveBeenCalled();
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
