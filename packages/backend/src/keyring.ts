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

// Lazy-loaded because @napi-rs/keyring may not be available in headless/test
// environments and its import is a CommonJS module.
type NativeEntry = new (service: string, slot: string) => {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | null>;
  deletePassword(): Promise<void>;
};

let nativeEntryCtor: NativeEntry | null = null;

async function getNativeEntry(
  slot: string,
): Promise<ReturnType<typeof makeKeyringEntry>> {
  if (!nativeEntryCtor) {
    const pkg = (await import("@napi-rs/keyring")).default as unknown as {
      Entry: new (service: string, slot: string) => {
        setPassword(password: string): Promise<void>;
        getPassword(): Promise<string | null>;
        deletePassword(): Promise<void>;
      };
    };
    nativeEntryCtor = pkg.Entry;
  }
  return makeKeyringEntry(new nativeEntryCtor(SERVICE, slot));
}

function makeKeyringEntry(entry: {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | null>;
  deletePassword(): Promise<void>;
}) {
  return {
    setPassword: (password: string) => entry.setPassword(password),
    getPassword: async () => (await entry.getPassword()) ?? undefined,
    deletePassword: () => entry.deletePassword(),
  };
}

function makeDevEntry(path: string, slot: string) {
  return {
    setPassword: async (password: string) => {
      const kr = loadDevKeyring(path);
      kr.secrets[slot] = password;
      saveDevKeyring(path, kr);
    },
    getPassword: async () => {
      const kr = loadDevKeyring(path);
      return kr.secrets[slot];
    },
    deletePassword: async () => {
      const kr = loadDevKeyring(path);
      delete kr.secrets[slot];
      saveDevKeyring(path, kr);
    },
  };
}

async function openEntry(slot: string) {
  const devPath = devKeyringPath();
  if (devPath) {
    return makeDevEntry(devPath, slot);
  }
  return getNativeEntry(slot);
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
  const entry = await openEntry(slotOf(config.id));
  await entry.setPassword(password);
}

/** Retrieves a password from the OS keyring (or dev fallback). */
export async function getPassword(
  config: Pick<ConnectionConfig, "id">,
): Promise<string | undefined> {
  const entry = await openEntry(slotOf(config.id));
  return entry.getPassword();
}

/** Deletes a password from the OS keyring (or dev fallback). */
export async function deletePassword(
  config: Pick<ConnectionConfig, "id">,
): Promise<void> {
  const entry = await openEntry(slotOf(config.id));
  await entry.deletePassword();
}
