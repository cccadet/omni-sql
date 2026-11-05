import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export const DESKTOP_NOTIFICATIONS_KEY = "omni-sql:desktopNotifications";
/** Queries shorter than this finish before the user has switched away; notifying would be noise. */
export const LONG_QUERY_NOTIFY_MS = 10_000;

export function loadDesktopNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveDesktopNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, String(enabled));
  } catch {
    // localStorage can be unavailable in restricted webviews.
  }
}

export interface DesktopNotifyDeps {
  enabled: () => boolean;
  inBackground: () => boolean;
  available: () => boolean;
  requestAttention: () => Promise<void>;
  permissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<string>;
  send: (notification: { title: string; body: string }) => void;
}

const defaultDeps: DesktopNotifyDeps = {
  enabled: loadDesktopNotificationsEnabled,
  inBackground: () => document.visibilityState !== "visible" || !document.hasFocus(),
  // Resolved lazily so tests that mock the Tauri modules partially still load this file.
  available: () => isTauri(),
  requestAttention: () => getCurrentWindow().requestUserAttention(UserAttentionType.Critical),
  permissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
  send: (notification) => sendNotification(notification),
};

/**
 * Shows a native notification and flashes the taskbar entry, but only while the
 * window is in the background: in front of the user the in-app UI is enough.
 * Never throws; a missing permission or plugin failure just skips the notice.
 */
export async function notifyDesktop(
  notification: { title: string; body: string },
  deps: DesktopNotifyDeps = defaultDeps,
): Promise<boolean> {
  try {
    if (!deps.enabled() || !deps.available() || !deps.inBackground()) return false;
    await deps.requestAttention().catch(() => undefined);
    const granted = (await deps.permissionGranted()) || (await deps.requestPermission()) === "granted";
    if (!granted) return false;
    deps.send(notification);
    return true;
  } catch {
    return false;
  }
}
