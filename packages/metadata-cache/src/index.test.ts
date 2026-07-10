import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { MetadataCache } from "./index.ts";
import type {
  ConnectionConfig,
  FunctionDef,
  Relation,
} from "@omni-sql/ts-types";

function tmpPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "omni-cache-")),
    "metadata.db",
  );
}

function cfg(id = "c1"): ConnectionConfig {
  return {
    id,
    label: "Test",
    dialect: "postgres",
    endpoint: "memory://local",
    user: "anon",
  };
}

const USERS: Relation = {
  schema: "public",
  name: "users",
  kind: "table",
  columns: [
    { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinalPosition: 0 },
    { name: "name", dataType: "text", nullable: false, isPrimaryKey: false, ordinalPosition: 1 },
  ],
  constraints: [{ name: "pk", kind: "primary", columns: ["id"] }],
};

const ORDERS: Relation = {
  schema: "public",
  name: "orders",
  kind: "table",
  columns: [
    { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true, ordinalPosition: 0 },
    { name: "user_id", dataType: "integer", nullable: false, isPrimaryKey: false, ordinalPosition: 1 },
  ],
  constraints: [
    { name: "pk_orders", kind: "primary", columns: ["id"] },
    {
      name: "fk_orders_user",
      kind: "foreign",
      columns: ["user_id"],
      references: { schema: "public", table: "users", column: "id" },
    },
  ],
};

const COALESCE: FunctionDef = {
  schema: "public",
  name: "COALESCE",
  overloads: [
    {
      parameters: [{ name: "v", dataType: "any", mode: "in", ordinalPosition: 0 }],
      returnType: "any",
    },
  ],
};

test("ingest and read back: getTablesBySchema <2ms after reindex", () => {
  const cache = MetadataCache.open(tmpPath());
  try {
    cache.upsertConnection(cfg());
    cache.ingestIntrospection("c1", [{
      name: "public",
      relations: [USERS, ORDERS],
      functions: [COALESCE],
    }]);
    const t0 = process.hrtime.bigint();
    const rels = cache.getTablesBySchema("c1", "public");
    const t1 = process.hrtime.bigint();
    const elapsedMs = Number(t1 - t0) / 1e6;
    assert.ok(rels.some((r) => r.name === "users"));
    assert.ok(rels.some((r) => r.name === "orders"));
    assert.ok(elapsedMs < 2, `lookup ${elapsedMs}ms deve ser <2ms`);
  } finally {
    cache.close();
  }
});

test("getColumnsByTable returns Column[] in declaration order", () => {
  const cache = MetadataCache.open(tmpPath());
  try {
    cache.upsertConnection(cfg());
    cache.ingestIntrospection("c1", [{
      name: "public",
      relations: [USERS],
      functions: [],
    }]);
    const cols = cache.getColumnsByTable("c1", "public", "users");
    assert.equal(cols.length, 2);
    const c0 = cols[0]!;
    assert.equal(c0.name, "id");
    assert.equal(c0.isPrimaryKey, true);
  } finally {
    cache.close();
  }
});

test("getForeignKeysTo finds relations referencing target table", () => {
  const cache = MetadataCache.open(tmpPath());
  try {
    cache.upsertConnection(cfg());
    cache.ingestIntrospection("c1", [{
      name: "public",
      relations: [USERS, ORDERS],
      functions: [],
    }]);
    const refs = cache.getForeignKeysTo("c1", "public", "users");
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.name, "orders");
  } finally {
    cache.close();
  }
});

test("ingest is transactional — partial failures don't replace previous cache", () => {
  const cache = MetadataCache.open(tmpPath());
  try {
    cache.upsertConnection(cfg());
    cache.ingestIntrospection("c1", [{
      name: "public",
      relations: [USERS],
      functions: [],
    }]);
    const before = cache.getTablesBySchema("c1", "public");
    assert.equal(before.length, 1);
    // Now try a bad ingest — name is not nullable in DB schema; should throw.
    assert.throws(() => {
      cache.ingestIntrospection("c1", [{
        // passing an undefined relationship to force TypeError
        name: null as unknown as string,
        relations: [],
        functions: [],
      }]);
    });
    const after = cache.getTablesBySchema("c1", "public");
    assert.equal(after.length, 1, "previous cache should survive failed ingest");
  } finally {
    cache.close();
  }
});

test("getFunctions returns catalog functions", () => {
  const cache = MetadataCache.open(tmpPath());
  try {
    cache.upsertConnection(cfg());
    cache.ingestIntrospection("c1", [{
      name: "public",
      relations: [],
      functions: [COALESCE],
    }]);
    const fns = cache.getFunctions("c1", "public");
    assert.equal(fns.length, 1);
    assert.equal(fns[0]!.name, "COALESCE");
  } finally {
    cache.close();
  }
});

test("removeConnection drops schema too", () => {
  const cache = MetadataCache.open(tmpPath());
  try {
    cache.upsertConnection(cfg());
    cache.ingestIntrospection("c1", [{
      name: "public",
      relations: [USERS],
      functions: [],
    }]);
    cache.removeConnection("c1");
    assert.equal(cache.getConnection("c1"), undefined);
    assert.deepEqual(cache.getTablesBySchema("c1", "public"), []);
  } finally {
    cache.close();
  }
});

test("lastSyncedAt is populated after ingest", () => {
  const cache = MetadataCache.open(tmpPath());
  try {
    cache.upsertConnection(cfg());
    const now = 1700000000000;
    cache.ingestIntrospection("c1", [{
      name: "public",
      relations: [USERS],
      functions: [],
    }], now);
    assert.equal(cache.lastSyncedAt("c1", "connection"), now);
    assert.equal(cache.lastSyncedAt("c1", "schema", "public"), now);
    assert.equal(cache.lastSyncedAt("c1", "relation", "public.users"), now);
  } finally {
    cache.close();
  }
});