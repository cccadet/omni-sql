import { test } from "node:test";
import assert from "node:assert/strict";

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
