/**
 * Smoke test: importa os adaptadores REAIS do omni-sql e valida
 * introspect/runQuery/explain/listIndexes/getDefinition contra os
 * containers Docker de cada banco.
 *
 * Uso:
 *   node --test --import ./smoke-test.ts          # todos
 *   node --test --import ./smoke-test.ts -- pg    # só PostgreSQL
 *   node --test --import ./smoke-test.ts -- mysql # só MySQL
 *   node --test --import ./smoke-test.ts -- mssql # só SQL Server
 *   node --test --import ./smoke-test.ts -- oracle# só Oracle
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ConnectionConfig, Schema } from "@omni-sql/ts-types";
import type { Adapter } from "@omni-sql/adapters-core";

// ── Configurações por banco ──

interface Target {
  label: string;
  config: ConnectionConfig;
  password: string;
}

const TARGETS: Record<string, Target> = {
  pg: {
    label: "PostgreSQL",
    config: {
      id: "test-pg",
      label: "Test PG",
      dialect: "postgres",
      endpoint: "127.0.0.1:5432/omni_test",
      user: "omni",
    },
    password: "omni",
  },
  mysql: {
    label: "MySQL",
    config: {
      id: "test-mysql",
      label: "Test MySQL",
      dialect: "mysql",
      endpoint: "127.0.0.1:3306/omni_test",
      user: "omni",
    },
    password: "omni",
  },
  mssql: {
    label: "SQL Server",
    config: {
      id: "test-mssql",
      label: "Test MSSQL",
      dialect: "sqlserver",
      endpoint: "127.0.0.1:1433/omni_test",
      user: "sa",
    },
    password: "Omni!2024",
  },
  oracle: {
    label: "Oracle XE",
    config: {
      id: "test-oracle",
      label: "Test Oracle",
      dialect: "oracle",
      endpoint: "127.0.0.1:1521/XEPDB1",
      user: "OMNI",
    },
    password: "omni",
  },
};

// ── Fábrica de adaptadores ──

async function createAdapter(key: string, target: Target): Promise<Adapter> {
  switch (key) {
    case "pg": {
      const { PostgresAdapter } = await import("@omni-sql/adapters-pg");
      return new PostgresAdapter(target.config, target.password);
    }
    case "mysql": {
      const { MysqlAdapter } = await import("@omni-sql/adapters-mysql");
      return new MysqlAdapter(target.config, target.password);
    }
    case "mssql": {
      const { MssqlAdapter } = await import("@omni-sql/adapters-mssql");
      return new MssqlAdapter(target.config, target.password);
    }
    case "oracle": {
      const { OracleAdapter } = await import("@omni-sql/adapters-oracle");
      return new OracleAdapter(target.config, target.password);
    }
    default:
      throw new Error(`Unknown adapter: ${key}`);
  }
}

// ── Helpers ──

const SCHEMA_NAMES = ["public", "OMNI", "dbo"];

function findSchema(schemas: readonly Schema[]): Schema {
  const s = schemas.find((s) => SCHEMA_NAMES.includes(s.name));
  assert.ok(s, `no public/OMNI/dbo schema found in: ${schemas.map((s) => s.name)}`);
  return s;
}

// ── Filtro CLI ──

const filter = process.argv.includes("--")
  ? process.argv[process.argv.indexOf("--") + 1]
  : undefined;

const targets = Object.entries(TARGETS).filter(
  ([key]) => !filter || filter === key,
);

// ── Suites de teste ──

for (const [key, target] of targets) {
  describe(target.label, () => {
    let adapter: Adapter;

    it("connect", async () => {
      adapter = await createAdapter(key, target);
      const result = await adapter.test();
      assert.equal(result.ok, true, result.message);
    });

    it("introspect", async () => {
      const db = await adapter.introspect();
      assert.ok(db.schemas.length > 0, "no schemas returned");
    });

    it("listAvailableSchemas", async () => {
      const schemas = await adapter.listAvailableSchemas();
      assert.ok(schemas.length > 0, "no schemas");
    });

    it("listSchemas (cached)", () => {
      const schemas = adapter.listSchemas();
      assert.ok(schemas.length > 0, "no cached schemas");
    });

    it("listTables", () => {
      const schemas = adapter.listSchemas();
      const pub = findSchema(schemas);

      const tables = adapter.listTables(pub.name);
      const tableNames = tables.map((t) => t.name);
      assert.ok(tableNames.includes("customers"), `customers missing, got: ${tableNames}`);
      assert.ok(tableNames.includes("orders"), `orders missing, got: ${tableNames}`);
      assert.ok(tableNames.includes("products"), `products missing, got: ${tableNames}`);
      assert.ok(tableNames.includes("order_items"), `order_items missing, got: ${tableNames}`);
    });

    it("listColumns (customers)", () => {
      const schemas = adapter.listSchemas();
      const pub = findSchema(schemas);
      const cols = adapter.listColumns(pub.name, "customers");
      assert.ok(cols.length >= 4, `expected 4+ columns, got ${cols.length}`);

      const idCol = cols.find((c) => c.name === "id" || c.name === "ID");
      assert.ok(idCol, "id column missing");
      assert.equal(idCol!.isPrimaryKey, true, "id should be PK");

      const nameCol = cols.find((c) => c.name === "name" || c.name === "NAME");
      assert.ok(nameCol, "name column missing");
    });

    it("listColumns (orders with FK)", () => {
      const schemas = adapter.listSchemas();
      const pub = findSchema(schemas);
      const cols = adapter.listColumns(pub.name, "orders");
      const fkCol = cols.find(
        (c) => c.name === "customer_id" || c.name === "CUSTOMER_ID",
      );
      assert.ok(fkCol, "customer_id column missing");
      assert.ok(fkCol!.foreignKeyTo, "customer_id should have FK reference");
    });

    it("listFunctions", () => {
      const schemas = adapter.listSchemas();
      const pub = findSchema(schemas);
      const fns = adapter.listFunctions(pub.name);
      const fnNames = fns.map((f) => f.name.toUpperCase());
      assert.ok(
        fnNames.some((n) => n.includes("GET_CUSTOMER_TOTAL")),
        `get_customer_total missing, got: ${fnNames}`,
      );
    });

    it("runQuery: SELECT literal", async () => {
      const result = await adapter.runQuery("SELECT 1 AS one", 10);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0]?.[0], 1);
      assert.ok(result.elapsedMs >= 0);
    });

    it("runQuery: COUNT customers", async () => {
      const result = await adapter.runQuery("SELECT COUNT(*) FROM customers", 10);
      const count = Number(result.rows[0]?.[0]);
      assert.equal(count, 5, `expected 5 customers, got ${count}`);
    });

    it("runQuery: JOIN orders + customers", async () => {
      const result = await adapter.runQuery(
        "SELECT o.id, c.name, o.total FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id",
        100,
      );
      assert.equal(result.rows.length, 5);
      assert.equal(String(result.rows[0]?.[1]), "Alice Silva");
    });

    it("runQuery: SUM + GROUP BY", async () => {
      const result = await adapter.runQuery(
        `SELECT c.city, SUM(o.total) AS city_total
         FROM orders o JOIN customers c ON c.id = o.customer_id
         GROUP BY c.city ORDER BY city_total DESC`,
        100,
      );
      assert.ok(result.rows.length >= 2, "expected at least 2 cities");
    });

    it("runQuery: CASE expression", async () => {
      const result = await adapter.runQuery(
        `SELECT name, price,
         CASE WHEN price > 1000 THEN 'high' ELSE 'low' END AS tier
         FROM products ORDER BY price DESC`,
        100,
      );
      assert.equal(result.rows.length, 5);
      assert.equal(String(result.rows[0]?.[2]), "high");
    });

    it("runQuery: subquery", async () => {
      const result = await adapter.runQuery(
        `SELECT name,
         (SELECT COUNT(*) FROM orders WHERE customer_id = customers.id) AS order_count
         FROM customers ORDER BY name`,
        100,
      );
      assert.equal(result.rows.length, 5);
      const alice = result.rows.find((r) => String(r?.[0]) === "Alice Silva");
      assert.ok(alice, "Alice not found");
      assert.equal(Number(alice?.[1]), 2, "Alice should have 2 orders");
    });

    it("explain", async () => {
      const result = await adapter.explain("SELECT * FROM orders WHERE customer_id = 1");
      assert.ok(result.textual.length > 0, "EXPLAIN returned empty");
      assert.ok(result.raw !== undefined, "EXPLAIN raw missing");
    });

    it("listIndexes (orders)", async () => {
      const schemas = adapter.listSchemas();
      const pub = findSchema(schemas);
      const indexes = await adapter.listIndexes(pub.name, "orders");
      assert.ok(indexes.length >= 1, `expected 1+ indexes, got ${indexes.length}`);
      const allCols = indexes.flatMap((idx) => [...idx.columns]);
      assert.ok(
        allCols.some((c) => c === "customer_id" || c === "CUSTOMER_ID"),
        `customer_id index missing, got columns: ${allCols}`,
      );
    });

    it("listIndexes (order_items)", async () => {
      const schemas = adapter.listSchemas();
      const pub = findSchema(schemas);
      const indexes = await adapter.listIndexes(pub.name, "order_items");
      assert.ok(indexes.length >= 1, "expected 1+ indexes on order_items");
    });

    it("getDefinition (view)", async () => {
      const schemas = adapter.listSchemas();
      const pub = findSchema(schemas);
      const def = await adapter.getDefinition("view", pub.name, "order_summary");
      assert.ok(def.length > 0, "view definition empty");
      assert.ok(
        /orders|customers/i.test(def),
        `view def doesn't reference orders/customers: ${def.slice(0, 200)}`,
      );
    });

    it("getDefinition (function/procedure)", async () => {
      const schemas = adapter.listSchemas();
      const pub = findSchema(schemas);
      const def = await adapter.getDefinition("function", pub.name, "get_customer_total");
      assert.ok(def.length > 0, "function definition empty");
    });

    it("close", async () => {
      await adapter.close();
      assert.ok(true, "closed without error");
    });
  });
}
