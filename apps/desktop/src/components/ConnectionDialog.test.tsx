import { assert, beforeEach, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { ConnectionDialog } from "./ConnectionDialog";
import { LanguageProvider } from "../i18n";
import { backend } from "../lib/backend";
import { listAnalysisS3 } from "../lib/analysis";

const renderWithLanguage = (ui: React.ReactElement) => render(<LanguageProvider>{ui}</LanguageProvider>);

vi.mock("../lib/backend", () => ({ backend: { call: vi.fn() } }));
vi.mock("../lib/analysis", () => ({ listAnalysisS3: vi.fn() }));
vi.mock("../lib/file-io", () => ({ pickJarPath: vi.fn() }));

const close = vi.fn();
const saved = vi.fn();

beforeEach(() => {
  vi.mocked(backend.call).mockReset();
  vi.mocked(backend.call).mockImplementation(async (method) => method === "connection.list" ? { configs: [] } : undefined);
  close.mockReset();
  saved.mockReset();
  vi.mocked(listAnalysisS3).mockReset();
});

test("registers multiple S3 buckets without choosing a format", async () => {
  vi.mocked(backend.call).mockImplementation(async (method) => method === "connection.list"
    ? { configs: [] } : method === "connection.listBuckets"
      ? { buckets: ["bucket", "bucket-two"] } : { connectionId: "s3-1", ok: true });
  vi.mocked(listAnalysisS3).mockResolvedValue([]);
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "s3" } });
  fireEvent.change(screen.getByPlaceholderText("My connection"), { target: { value: "Sales lake" } });
  fireEvent.click(screen.getByRole("button", { name: "Load buckets" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "bucket" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "bucket-two" }));
  assert.equal(screen.queryByRole("combobox", { name: "Formato S3" }), null);
  fireEvent.change(screen.getByPlaceholderText("us-east-1 (optional)"), { target: { value: "us-east-1" } });
  fireEvent.change(screen.getByPlaceholderText("https://host:9000 (optional)"), { target: { value: "http://127.0.0.1:9000" } });
  fireEvent.change(screen.getByPlaceholderText("Access Key ID (optional)"), { target: { value: "omni_test" } });
  fireEvent.change(screen.getByPlaceholderText("Secret Access Key (optional)"), { target: { value: "omni_test_secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => assert.equal(vi.mocked(listAnalysisS3).mock.calls.length, 1));
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => assert.equal(saved.mock.calls.length, 1));
  const add = vi.mocked(backend.call).mock.calls.find(([method]) => method === "connection.add");
  assert.ok(add);
  const params = add[1] as { config: { label: string; dialect: string; endpoint: string; user: string; options: unknown }; password: string };
  const config = params.config;
  assert.equal(config.label, "Sales lake");
  assert.equal(config.dialect, "s3");
  assert.equal(config.endpoint, "s3://bucket");
  assert.equal(config.user, "omni_test");
  assert.equal(params.password, "omni_test_secret");
  assert.deepEqual(config.options, { region: "us-east-1", endpoint: "http://127.0.0.1:9000", buckets: '["s3://bucket","s3://bucket-two"]', ducklakeMappings: "[]" });
});

test("loads S3 buckets and saves the selected ones", async () => {
  vi.mocked(backend.call).mockImplementation(async (method) => {
    if (method === "connection.list") return { configs: [] };
    if (method === "connection.listBuckets") return { buckets: ["bucket-a", "bucket-b"] };
    return { connectionId: "s3-1", ok: true };
  });
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "s3" } });
  fireEvent.change(screen.getByPlaceholderText("My connection"), { target: { value: "S3 account" } });
  fireEvent.click(screen.getByRole("button", { name: "Load buckets" }));
  const first = await screen.findByRole("checkbox", { name: "bucket-a" });
  assert.equal((first as HTMLInputElement).checked, false);
  fireEvent.click(first);
  assert.equal((first as HTMLInputElement).checked, true);
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => assert.equal(saved.mock.calls.length, 1));
  const add = vi.mocked(backend.call).mock.calls.find(([method]) => method === "connection.add");
  assert.ok(add);
  const { config } = add[1] as { config: { endpoint: string; options: { buckets: string } } };
  assert.equal(config.endpoint, "s3://bucket-a");
  assert.equal(config.options.buckets, '["s3://bucket-a"]');
});

test("saves an S3 account without buckets", async () => {
  vi.mocked(backend.call).mockImplementation(async (method) => method === "connection.list"
    ? { configs: [] } : { connectionId: "s3-empty", ok: true });
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "s3" } });
  fireEvent.change(screen.getByPlaceholderText("My connection"), { target: { value: "S3 account" } });
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => assert.equal(saved.mock.calls.length, 1));
  const add = vi.mocked(backend.call).mock.calls.find(([method]) => method === "connection.add");
  assert.ok(add);
  const { config } = add[1] as { config: { endpoint: string; options: { buckets: string } } };
  assert.equal(config.endpoint, "s3://");
  assert.equal(config.options.buckets, "[]");
});

test("keeps S3 fields focused after loading buckets, saving, and reopening", async () => {
  let stored: ConnectionConfig = { id: "s3-1", label: "S3", dialect: "s3", endpoint: "s3://bucket-a", user: "key", options: { buckets: '["s3://bucket-a"]' } };
  vi.mocked(backend.call).mockImplementation(async (method, params) => {
    if (method === "connection.list") return { configs: [] };
    if (method === "connection.listBuckets") return { buckets: ["bucket-a", "bucket-b"] };
    if (method === "connection.add") {
      stored = (params as { config: ConnectionConfig }).config;
      return { connectionId: "s3-1" };
    }
    return undefined;
  });
  function Harness() {
    const [open, setOpen] = useState(true);
    return <>
      <button onClick={() => setOpen(true)}>Reopen</button>
      {open && <ConnectionDialog open editing={stored} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />}
    </>;
  }
  renderWithLanguage(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Load buckets" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "bucket-b" }));
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  const region = screen.getByRole("textbox", { name: "Region" });
  region.focus();
  fireEvent.change(region, { target: { value: "us-east-1" } });
  assert.equal(document.activeElement, region);
  assert.equal((screen.getByRole("checkbox", { name: "bucket-b" }) as HTMLInputElement).checked, true);
});

test("does not expose an existing connection internal ID", () => {
  renderWithLanguage(
    <ConnectionDialog
      open
      editing={{ id: "conn-saved", label: "Saved", dialect: "postgres", endpoint: "db:5432/app", user: "user" }}
      onClose={close}
      onSaved={saved}
    />,
  );

  assert.equal(screen.queryByDisplayValue("conn-saved"), null);
  assert.equal(screen.queryByText("ID interno"), null);
  assert.ok(screen.getByRole("button", { name: "Save connection" }));
});

test("keeps focus in a connection field while editing", () => {
  vi.mocked(backend.call).mockResolvedValue({ configs: [] });
  renderWithLanguage(
    <ConnectionDialog
      open
      editing={{ id: "conn-saved", label: "Saved", dialect: "postgres", endpoint: "db:5432/app", user: "user" }}
      onClose={close}
      onSaved={saved}
    />,
  );

  const name = screen.getByRole("textbox", { name: "Name" });
  assert.equal(name, screen.getByDisplayValue("Saved"));
  name.focus();
  fireEvent.change(name, { target: { value: "Saved updated" } });
  assert.equal(document.activeElement, name);
  assert.equal(screen.getByDisplayValue("Saved updated"), name);
});

test("shows saved schemas first and filters the loaded schema list", async () => {
  const call = vi.mocked(backend.call);
  call.mockImplementation(async (method) => method === "connection.listSchemas"
    ? { schemas: ["zeta", "archive", "public", "beta"] }
    : { ok: true });
  renderWithLanguage(
    <ConnectionDialog
      open
      editing={{ id: "conn-saved", label: "Saved", dialect: "postgres", endpoint: "db:5432/app", user: "user", schemas: ["zeta", "public"] }}
      onClose={close}
      onSaved={saved}
    />,
  );

  const schemaList = document.querySelector(".connection-schema-list")!;
  const schemaRows = () => [...schemaList.querySelectorAll(".connection-schema-row")].map((row) => row.textContent?.replace("Selected", "").trim());
  assert.deepEqual(schemaRows(), ["public", "zeta"]);
  assert.ok(screen.getByText("2 selected of 2"));

  fireEvent.click(screen.getByRole("button", { name: "Load schemas" }));
  await screen.findByText("2 selected of 4");
  assert.deepEqual(schemaRows(), ["public", "zeta", "archive", "beta"]);

  fireEvent.change(screen.getByRole("textbox", { name: "Search schemas…" }), { target: { value: "ar" } });
  assert.deepEqual(schemaRows(), ["archive"]);
  fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
  assert.ok(screen.getByText("3 selected of 4"));
});

test("duplicates editable fields with a new ID and empty password", async () => {
  const call = vi.mocked(backend.call);
  call.mockResolvedValue({ ok: true });
  renderWithLanguage(
    <ConnectionDialog
      open
      editing={{ id: "conn-saved", label: "Saved", dialect: "postgres", endpoint: "db:5432/app", user: "user" }}
      duplicating
      onClose={close}
      onSaved={saved}
    />,
  );

  assert.ok(screen.getByRole("heading", { name: "Duplicate connection" }));
  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => assert.ok(call.mock.calls.length > 0));
  const [, params] = call.mock.calls.at(-1)!;
  const duplicatedParams = params as { password?: string; config: { id: string } };
  assert.equal(duplicatedParams.password, "");
  assert.notEqual(duplicatedParams.config.id, "conn-saved");
  assert.match(duplicatedParams.config.id, /^conn-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test("does not show the internal ID for a new connection", () => {
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);

  assert.equal(screen.queryByText("ID interno"), null);
});

test("tests and saves a new connection", async () => {
  const call = vi.mocked(backend.call);
  call.mockImplementation(async (method) => method === "connection.add"
    ? { ok: true, connectionId: "conn-new" }
    : { ok: true, latencyMs: 12 });
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);

  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "postgres" } });
  fireEvent.change(screen.getByPlaceholderText("My connection"), { target: { value: "Warehouse" } });
  fireEvent.change(screen.getByPlaceholderText("127.0.0.1"), { target: { value: "db.example" } });
  fireEvent.change(within(dialog).getAllByPlaceholderText("postgres")[1]!, { target: { value: "reporter" } });
  fireEvent.change(screen.getByPlaceholderText("••••••"), { target: { value: "secret" } });

  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  assert.ok(await screen.findByText("Connected in 12ms"));

  const testCall = call.mock.calls.find(([method]) => method === "connection.test");
  assert.ok(testCall);
  const testParams = testCall[1] as { config: { label: string; endpoint: string; user: string }; password: string };
  assert.equal(testParams.config.label, "Warehouse");
  assert.equal(testParams.config.endpoint, "db.example:5432/postgres");
  assert.equal(testParams.config.user, "reporter");
  assert.equal(testParams.password, "secret");

  fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => assert.equal(saved.mock.calls.length, 1));
  assert.deepEqual(saved.mock.calls[0], ["conn-new"]);
  assert.ok(call.mock.calls.some(([method]) => method === "connection.add"));
});

test("shows failed connection test and recovers on retry", async () => {
  const call = vi.mocked(backend.call);
  let attempts = 0;
  call.mockImplementation(async (method) => {
    if (method === "connection.list") return { configs: [] };
    if (method === "connection.test" && attempts++ === 0) throw new Error("database offline");
    return { ok: true, latencyMs: 7 };
  });
  renderWithLanguage(<ConnectionDialog open onClose={close} onSaved={saved} />);

  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "postgres" } });
  fireEvent.change(screen.getByPlaceholderText("127.0.0.1"), { target: { value: "db.example" } });
  fireEvent.change(within(dialog).getAllByPlaceholderText("postgres")[1]!, { target: { value: "reporter" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  assert.ok(await screen.findByText("database offline"));

  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  assert.ok(await screen.findByText("Connected in 7ms"));
  assert.equal(screen.queryByText("database offline"), null);
});
