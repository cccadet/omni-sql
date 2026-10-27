import { assert, beforeEach, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectionImportDialog } from "./ConnectionImportDialog";
import { LanguageProvider } from "../i18n";
import { backend, type ConnectionEntry, type ConnectionGroup } from "../lib/backend";
import { buildConnectionExport } from "../lib/connection-import";

vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));

const dbeaverSource = JSON.stringify({
  folders: { Prod: {} },
  connections: {
    pg: { provider: "postgresql", name: "Orders", folder: "Prod", configuration: { host: "pg", port: "5432", database: "orders", user: "app" } },
    my: { provider: "mysql", driver: "mysql8", name: "Shop", folder: "Staging", configuration: { host: "my", port: "3306", database: "shop" } },
    dup: { provider: "postgresql", name: "Existing", configuration: { host: "old", port: "5432", database: "db", user: "u" } },
    lite: { provider: "generic", driver: "sqlite_jdbc", name: "Notes", configuration: { database: "notes.db" } },
  },
});

type Added = { config: { id: string; label: string; endpoint: string; options?: Record<string, unknown> }; password?: string };

beforeEach(() => {
  vi.mocked(backend.call).mockReset();
  vi.mocked(backend.call).mockImplementation(async (method, params) => {
    if (method === "connection.add") return { connectionId: (params as Added).config.id, ok: true };
    if (method === "connectionGroup.create") return { group: { id: `g-${(params as { name: string }).name}`, name: (params as { name: string }).name } };
    return {};
  });
});

function renderDialog(connections: ConnectionEntry[] = [], groups: ConnectionGroup[] = []) {
  const imported = vi.fn().mockResolvedValue(undefined);
  render(<LanguageProvider><ConnectionImportDialog open connections={connections} groups={groups} onClose={vi.fn()} onImported={imported} /></LanguageProvider>);
  return imported;
}

const choose = (label: string, contents: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: [new File([contents], "connections.json", { type: "application/json" })] } });
const calls = (method: string) => vi.mocked(backend.call).mock.calls.filter(([name]) => name === method).map(([, params]) => params);

test("imports the selected DBeaver connections into matching or new folders", async () => {
  const imported = renderDialog([{ id: "old", label: "Old", dialect: "postgres", endpoint: "old:5432/db", user: "u" }], [{ id: "g-prod", name: "PROD" }]);
  fireEvent.click(screen.getByRole("radio", { name: "DBeaver" }));
  choose("Choose data-sources.json", dbeaverSource);

  assert.equal((await screen.findByRole("checkbox", { name: "Orders" }) as HTMLInputElement).checked, true);
  assert.equal((screen.getByRole("checkbox", { name: "Existing" }) as HTMLInputElement).checked, false);
  assert.equal((screen.getByRole("checkbox", { name: "Notes" }) as HTMLInputElement).disabled, true);
  screen.getByText(/Unsupported type: sqlite_jdbc/);
  screen.getByText(/User and password required/);

  fireEvent.click(screen.getByRole("button", { name: "Import 2" }));
  await screen.findByText("Imported 2 connections.");

  const added = calls("connection.add") as Added[];
  assert.deepEqual(added.map(({ config }) => [config.label, config.endpoint]), [["Orders", "pg:5432/orders"], ["Shop", "my:3306/shop"]]);
  assert.ok(added.every((params) => params.password === undefined));
  assert.deepEqual(calls("connectionGroup.create"), [{ name: "Staging" }]);
  assert.deepEqual(calls("connection.move"), [
    { connectionId: added[0]!.config.id, groupId: "g-prod" },
    { connectionId: added[1]!.config.id, groupId: "g-Staging" },
  ]);
  await waitFor(() => assert.equal(imported.mock.calls.length, 1));
});

test("imports one connection from an omni-sql export and re-links DuckLake catalogs in a batch", async () => {
  const exported = buildConnectionExport([
    { id: "lake", label: "Lake", dialect: "s3", endpoint: "s3://lake", user: "", options: { buckets: '["s3://lake"]', ducklakeMappings: '[{"prefix":"s3://lake","kind":"postgres","connectionId":"pg-1"}]' } },
    { id: "pg-1", label: "Catalog", dialect: "postgres", endpoint: "pg:5432/catalog", user: "app", groupId: "g", options: { mcpAccess: "off" } },
    { id: "my-1", label: "Shop", dialect: "mysql", endpoint: "my:3306/shop", user: "app" },
  ], [{ id: "g", name: "Prod" }]);
  renderDialog();
  choose("Choose export file", exported);

  // Leave only one connection selected first.
  fireEvent.click(await screen.findByRole("checkbox", { name: "Lake" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Catalog" }));
  fireEvent.click(screen.getByRole("button", { name: "Import 1" }));
  await screen.findByText("Imported 1 connections.");
  assert.deepEqual((calls("connection.add") as Added[]).map(({ config }) => config.label), ["Shop"]);

  vi.mocked(backend.call).mockClear();
  choose("Choose export file", exported);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Shop" }));
  fireEvent.click(screen.getByRole("button", { name: "Import 2" }));
  await screen.findByText("Imported 2 connections.");
  const added = calls("connection.add") as Added[];
  // The PostgreSQL catalog is created first so the S3 connection can point at its new id.
  assert.deepEqual(added.map(({ config }) => config.label), ["Catalog", "Lake"]);
  assert.deepEqual(added[0]!.config.options, { mcpAccess: "off" });
  assert.deepEqual(JSON.parse(String(added[1]!.config.options?.ducklakeMappings)), [{ prefix: "s3://lake", kind: "postgres", connectionId: added[0]!.config.id }]);
  assert.deepEqual(calls("connection.move"), [{ connectionId: added[0]!.config.id, groupId: "g-Prod" }]);
});

test("explains when the chosen file does not match the selected source", async () => {
  renderDialog();
  choose("Choose export file", dbeaverSource);
  await screen.findByText("This is not an omni-sql connection export.");
  fireEvent.click(screen.getByRole("radio", { name: "DBeaver" }));
  choose("Choose data-sources.json", "{}");
  await screen.findByText("This is not a DBeaver data-sources.json file.");
});

test("imports the DBeaver user and password from credentials-config.json, in either order", async () => {
  const source = JSON.stringify({ connections: { pg: { provider: "postgresql", name: "Orders", configuration: { host: "pg", port: "5432", database: "orders" } } } });
  const key = await crypto.subtle.importKey("raw", Uint8Array.from("babb4a9f774ab853c96c2d653dfe544a".match(/../g)!, (byte) => Number.parseInt(byte, 16)), "AES-CBC", false, ["encrypt"]);
  const iv = new Uint8Array(16).fill(7);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, new TextEncoder().encode(JSON.stringify({ pg: { "#connection": { user: "app", password: "s3cret" } } }))));
  const encrypted = new Uint8Array(16 + cipher.length);
  encrypted.set(iv);
  encrypted.set(cipher, 16);
  const credentialsFile = new File([encrypted], "credentials-config.json");
  // jsdom's File has no arrayBuffer().
  Object.defineProperty(credentialsFile, "arrayBuffer", { value: async () => encrypted.buffer });

  renderDialog();
  fireEvent.click(screen.getByRole("radio", { name: "DBeaver" }));
  fireEvent.change(screen.getByLabelText("Add credentials-config.json"), { target: { files: [credentialsFile] } });
  await screen.findByText("Credentials read for 1 DBeaver connections.");
  choose("Choose data-sources.json", source);
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await screen.findByText("Imported 1 connections.");

  const [added] = calls("connection.add") as Added[];
  assert.deepEqual([added?.config.label, (added?.config as { user?: string }).user, added?.password], ["Orders", "app", "s3cret"]);
});

test("explains when credentials-config.json cannot be decrypted", async () => {
  renderDialog();
  fireEvent.click(screen.getByRole("radio", { name: "DBeaver" }));
  const file = new File(["not encrypted"], "credentials-config.json");
  Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("not encrypted").buffer });
  fireEvent.change(screen.getByLabelText("Add credentials-config.json"), { target: { files: [file] } });
  await screen.findByText("This is not a readable DBeaver credentials-config.json file.");
});
