import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ConnectionConfig } from "@omni-sql/ts-types";

const SERVICE = "dev.omnisql";

function devKeyringPath(): string | undefined {
  if (process.env.OMNI_SQL_DEV_KEYRING_FILE) {
    return process.env.OMNI_SQL_DEV_KEYRING_FILE;
  }
  if (process.env.OMNI_SQL_DEV_KEYRING === "1") {
    return path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
      "omni-sql",
      "dev-keyring.json",
    );
  }
  return undefined;
}

interface DevKeyring {
  version: 1;
  secrets: Record<string, string>;
}

function loadDevKeyring(path: string): DevKeyring {
  try {
    const raw = fs.readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as DevKeyring;
    if (parsed.version !== 1) throw new Error("unsupported dev keyring version");
    return parsed;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, secrets: {} };
    }
    throw e;
  }
}

function saveDevKeyring(path: string, kr: DevKeyring): void {
  fs.mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(kr, null, 2), { mode: 0o600 });
}

function slotOf(connectionId: string): string {
  return `connection:${connectionId}`;
}

async function withDevKeyring<T>(
  path: string,
  fn: (kr: DevKeyring) => T,
): Promise<T> {
  const kr = loadDevKeyring(path);
  const result = fn(kr);
  saveDevKeyring(path, kr);
  return result;
}

// Lazy-loaded because @napi-rs/keyring may not be available in headless/test
// environments and its import is a CommonJS module.
type NativeEntryCtor = new (service: string, slot: string) => {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | null>;
  deletePassword(): Promise<void>;
};

let nativeEntryCtor: NativeEntryCtor | null = null;

async function getNativeEntryCtor(): Promise<NativeEntryCtor> {
  if (!nativeEntryCtor) {
    const pkg = (await import("@napi-rs/keyring")).default as unknown as {
      Entry: NativeEntryCtor;
    };
    nativeEntryCtor = pkg.Entry;
  }
  return nativeEntryCtor;
}

/** Returns the keyring slot identifier for a connection config. */
export function passwordSlotFor(config: Pick<ConnectionConfig, "id">): string {
  return slotOf(config.id);
}

/** Stores a password in the OS keyring (or dev fallback). */
export async function setPassword(
  config: Pick<ConnectionConfig, "id">,
  password: string,
): Promise<void> {
  const slot = slotOf(config.id);
  const devPath = devKeyringPath();
  if (devPath) {
    await withDevKeyring(devPath, (kr) => {
      kr.secrets[slot] = password;
    });
    return;
  }
  const Entry = await getNativeEntryCtor();
  const entry = new Entry(SERVICE, slot);
  await entry.setPassword(password);
}

/** Retrieves a password from the OS keyring (or dev fallback). */
export async function getPassword(
  config: Pick<ConnectionConfig, "id">,
): Promise<string | undefined> {
  const slot = slotOf(config.id);
  const devPath = devKeyringPath();
  if (devPath) {
    return withDevKeyring(devPath, (kr) => kr.secrets[slot]);
  }
  const Entry = await getNativeEntryCtor();
  const entry = new Entry(SERVICE, slot);
  return (await entry.getPassword()) ?? undefined;
}

/** Deletes a password from the OS keyring (or dev fallback). */
export async function deletePassword(
  config: Pick<ConnectionConfig, "id">,
): Promise<void> {
  const slot = slotOf(config.id);
  const devPath = devKeyringPath();
  if (devPath) {
    await withDevKeyring(devPath, (kr) => {
      delete kr.secrets[slot];
    });
    return;
  }
  const Entry = await getNativeEntryCtor();
  const entry = new Entry(SERVICE, slot);
  await entry.deletePassword();
}
