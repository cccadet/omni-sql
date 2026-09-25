import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.OMNI_SQL_METADATA_DB ??= ":memory:";
const { handlers, mutatesDatabaseStructure } = await import("./handlers.ts");

test("S3 sources are stored in the connection list without a database adapter", async () => {
  await handlers["connection.add"]({
    config: { id: "s3-test", label: "Sales lake", dialect: "s3", endpoint: "s3://bucket",
      user: "", options: { region: "us-east-1", endpoint: "http://127.0.0.1:9000" } },
  });
  const { configs } = await handlers["connection.list"]();
  assert.deepEqual(configs.find((config) => config.id === "s3-test"), {
    id: "s3-test", label: "Sales lake", dialect: "s3", endpoint: "s3://bucket",
    user: "", options: { region: "us-east-1", endpoint: "http://127.0.0.1:9000" },
    schemas: undefined, groupId: null, lastSyncedAt: undefined,
  });
  assert.deepEqual(await handlers["connection.s3Credentials"]({ connectionId: "s3-test" }), {
    accessKeyId: "", secretAccessKey: undefined,
  });
  await handlers["connection.remove"]({ connectionId: "s3-test" });
});

test("S3 connection can be saved before selecting buckets", async () => {
  const config = { id: "s3-empty", label: "S3 account", dialect: "s3" as const,
    endpoint: "s3://", user: "", options: { buckets: "[]" } };
  try {
    await handlers["connection.add"]({ config });
    const { configs } = await handlers["connection.list"]();
    assert.deepEqual(configs.find((item) => item.id === config.id)?.options?.buckets, "[]");
  } finally {
    await handlers["connection.remove"]({ connectionId: config.id });
  }
});

test("lists S3 buckets using connection credentials", async () => {
  const server = createServer((request, response) => {
    assert.match(String(request.headers.authorization), /^AWS4-HMAC-SHA256 /);
    response.setHeader("Content-Type", "application/xml");
    response.end('<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets><Bucket><Name>first</Name></Bucket><Bucket><Name>second</Name></Bucket></Buckets></ListAllMyBucketsResult>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await handlers["connection.listBuckets"]({ config: {
      id: "s3-discovery", label: "S3 account", dialect: "s3", endpoint: "s3://", user: "key-id",
      options: { region: "us-east-1", endpoint: `http://127.0.0.1:${address.port}` },
    }, password: "secret" });
    assert.deepEqual(result.buckets, ["first", "second"]);
  } finally {
    server.close();
  }
});

test("S3 access key and secret are recovered from the saved connection", async () => {
  const connectionId = "s3-credential-test";
  try {
    await handlers["connection.add"]({
      config: { id: connectionId, label: "Private bucket", dialect: "s3", endpoint: "s3://private-bucket", user: "key-id" },
      password: "secret-value",
    });
    assert.deepEqual(await handlers["connection.s3Credentials"]({ connectionId }), {
      accessKeyId: "key-id", secretAccessKey: "secret-value",
    });
  } finally {
    await handlers["connection.remove"]({ connectionId });
  }
});

test("DuckLake mappings resolve PostgreSQL credentials and retain table overrides", async () => {
  const pgId = "ducklake-pg";
  const s3Id = "ducklake-s3";
  try {
    await handlers["connection.add"]({ config: { id: pgId, label: "Lake catalog", dialect: "postgres",
      endpoint: "127.0.0.1:5432/lake", user: "reader" }, password: "pg-secret" });
    await handlers["connection.add"]({ config: { id: s3Id, label: "Lake data", dialect: "s3",
      endpoint: "s3://bucket", user: "", options: { ducklakeMappings: JSON.stringify([
        { prefix: "s3://bucket", kind: "postgres", connectionId: pgId },
        { prefix: "s3://bucket/main/orders", kind: "sqlite", path: "C:/lake/catalog.sqlite" },
      ]) } } });
    assert.deepEqual((await handlers["connection.s3Credentials"]({ connectionId: s3Id })).ducklakeMappings, [
      { prefix: "s3://bucket", catalog: { kind: "postgres", host: "127.0.0.1", port: 5432, database: "lake", user: "reader", password: "pg-secret" } },
      { prefix: "s3://bucket/main/orders", catalog: { kind: "sqlite", path: "C:/lake/catalog.sqlite" } },
    ]);
  } finally {
    await handlers["connection.remove"]({ connectionId: s3Id }).catch(() => undefined);
    await handlers["connection.remove"]({ connectionId: pgId }).catch(() => undefined);
  }
});

test("mutatesDatabaseStructure recognizes schema-changing statements", () => {
  assert.equal(mutatesDatabaseStructure("ALTER TABLE public.items ADD COLUMN note text"), true);
  assert.equal(mutatesDatabaseStructure("-- generated\nCREATE INDEX ix_items_note ON public.items(note)"), true);
  assert.equal(mutatesDatabaseStructure("/* reviewed */ DROP VIEW public.report"), true);
});

test("mutatesDatabaseStructure ignores data and read statements", () => {
  assert.equal(mutatesDatabaseStructure("SELECT * FROM public.items"), false);
  assert.equal(mutatesDatabaseStructure("UPDATE public.items SET note = NULL"), false);
  assert.equal(mutatesDatabaseStructure("WITH rows AS (SELECT 1) SELECT * FROM rows"), false);
});
