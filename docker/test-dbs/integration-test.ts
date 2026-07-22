/**
 * Integration test: sobe o backend Node (JSON-RPC), adiciona cada banco
 * real via `connection.add`, e testa o pipeline completo — exatamente como
 * a UI faz. Valida introspecção, queries, completion e explain pelo
 * protocolo HTTP real.
 *
 * Pré-requisito: containers Docker rodando (`docker compose up -d`).
 *
 * Uso:
 *   node --test --import ./integration-test.ts          # todos
 *   node --test --import ./integration-test.ts -- pg    # só PostgreSQL
 *   node --test --import ./integration-test.ts -- mysql # só MySQL
 *   node --test --import ./integration-test.ts -- mssql # só SQL Server
 *   node --test --import ./integration-test.ts -- oracle# só Oracle
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { JsonRpcResponse } from "@omni-sql/backend/protocol";

const RUN_INTEGRATION = process.env.OMNI_SQL_RUN_INTEGRATION === "1";

if (RUN_INTEGRATION) {
// ── Isolar cache SQLite e keyring em tmp dir ──

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-integration-"));
process.env.OMNI_SQL_METADATA_DB = path.join(tmpDir, "metadata.db");
process.env.OMNI_SQL_DEV_KEYRING_FILE = path.join(tmpDir, "keyring.json");
process.env.OMNI_SQL_AUTH_TOKEN = process.env.OMNI_SQL_AUTH_TOKEN ?? "integration-auth-token";

const { startServer } = await import("@omni-sql/backend");

const SIDECAR_HEALTH_URL = "http://127.0.0.1:41921/health";
const SIDECAR_SCOPE_URL = "http://127.0.0.1:41921/scope/resolve";

async function canResolveCte(): Promise<boolean> {
  try {
    const authHeaders = { authorization: `Bearer ${process.env.OMNI_SQL_AUTH_TOKEN}` };
    const health = await fetch(SIDECAR_HEALTH_URL, { headers: authHeaders });
    if (!health.ok) return false;

    const res = await fetch(SIDECAR_SCOPE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({
        sql: "WITH cte AS (SELECT id, name FROM customers) SELECT * FROM cte",
      }),
    });
    if (!res.ok) return false;

    const parsed = (await res.json()) as { ctes?: { name?: string }[] };
    return (
      parsed.ctes?.some((cte) => cte.name?.toLowerCase() === "cte") ?? false
    );
  } catch {
    return false;
  }
}

const cteCompletionAvailable = await canResolveCte();

// ── Configurações ──

interface Target {
  label: string;
  dialect: string;
  endpoint: string;
  user: string;
  password: string;
  /** Schema público (public/dbo/OMNI) — Oracle usa o próprio user como schema. */
  schema: string;
}

const TARGETS: Record<string, Target> = {
  pg: {
    label: "PostgreSQL",
    dialect: "postgres",
    endpoint: "127.0.0.1:5432/omni_test",
    user: "omni",
    password: "omni",
    schema: "public",
  },
  mysql: {
    label: "MySQL",
    dialect: "mysql",
    endpoint: "127.0.0.1:3306/omni_test",
    user: "omni",
    password: "omni",
    schema: "omni_test",
  },
  mssql: {
    label: "SQL Server",
    dialect: "sqlserver",
    endpoint: "127.0.0.1:1433/omni_test",
    user: "sa",
    password: "Omni!2024",
    schema: "dbo",
  },
  oracle: {
    label: "Oracle XE",
    dialect: "oracle",
    endpoint: "127.0.0.1:1521/XEPDB1",
    user: "OMNI",
    password: "omni",
    schema: "OMNI",
  },
};

// ── Filtro CLI ──

const filter = process.argv.includes("--")
  ? process.argv[process.argv.indexOf("--") + 1]
  : undefined;

const targets = Object.entries(TARGETS).filter(
  ([key]) => !filter || filter === key,
);

// ── RPC helper ──

const PORT = 14380;
const RPC_URL = `http://127.0.0.1:${PORT}/rpc`;
let rpcId = 0;

async function rpc(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const id = ++rpcId;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  });
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const json = (await res.json()) as JsonRpcResponse;
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json;
}

// ── Suites de teste ──

describe("Integration — pipeline completo via JSON-RPC", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  before(async () => {
    server = await startServer(PORT);
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  for (const [key, target] of targets) {
    describe(target.label, () => {
      const connId = `integ-${key}`;

      it("connection.add", async () => {
        const res = await rpc("connection.add", {
          config: {
            id: connId,
            label: `Integration ${target.label}`,
            dialect: target.dialect,
            endpoint: target.endpoint,
            user: target.user,
          },
          password: target.password,
        });
        const result = res.result as { ok: boolean; connectionId: string };
        assert.equal(result.ok, true);
        assert.equal(result.connectionId, connId);
      });

      it("connection.test", async () => {
        const res = await rpc("connection.test", {
          config: {
            id: `${connId}-test`,
            label: "Test",
            dialect: target.dialect,
            endpoint: target.endpoint,
            user: target.user,
          },
          password: target.password,
        });
        const result = res.result as { ok: boolean; latencyMs: number; message?: string };
        assert.equal(result.ok, true, result.message);
        assert.ok(result.latencyMs >= 0);
      });

      it("metadata.introspect", async () => {
        const res = await rpc("metadata.introspect", { connectionId: connId });
        const db = res.result as { schemas: { name: string }[]; connectionId: string };
        assert.ok(db.schemas.length > 0, "no schemas");
        assert.equal(db.connectionId, connId);
      });

      it("metadata.listRelations", async () => {
        const res = await rpc("metadata.listRelations", { connectionId: connId });
        const result = res.result as {
          relations: {
            name: string;
            columns: { name: string; isPrimaryKey: boolean }[];
          }[];
        };
        assert.ok(result.relations.length >= 4, `expected 4+ relations, got ${result.relations.length}`);
        // Oracle retorna nomes em maiúsculas
        const names = result.relations.map((r) => r.name.toLowerCase());
        assert.ok(names.includes("customers"), `customers missing, got: ${names}`);
        assert.ok(names.includes("orders"), `orders missing`);

        const customers = result.relations.find((r) => r.name.toLowerCase() === "customers");
        assert.ok(customers, "customers not found");
        assert.ok(customers!.columns.length >= 4, "customers should have 4+ columns");

        const idCol = customers!.columns.find((c) => c.name.toLowerCase() === "id");
        assert.ok(idCol, "id column missing");
        assert.equal(idCol!.isPrimaryKey, true, "id should be PK");
      });

      it("query.run: SELECT literal", async () => {
        // Oracle não aceita `AS` em alias de coluna e exige FROM DUAL
        const sql = target.dialect === "oracle" ? 'SELECT 1 "one" FROM DUAL' : "SELECT 1 AS one";
        const res = await rpc("query.run", { connectionId: connId, sql, limit: 10 });
        const result = res.result as { rows: unknown[][]; elapsedMs: number };
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0]?.[0], 1);
        assert.ok(result.elapsedMs >= 0);
      });

      it("query.run: COUNT customers", async () => {
        const res = await rpc("query.run", { connectionId: connId, sql: "SELECT COUNT(*) FROM customers", limit: 10 });
        const result = res.result as { rows: unknown[][] };
        const count = Number(result.rows[0]?.[0]);
        assert.equal(count, 5, `expected 5, got ${count}`);
      });

      it("query.run: JOIN", async () => {
        const res = await rpc("query.run", {
          connectionId: connId,
          sql: "SELECT o.id, c.name, o.total FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id",
          limit: 100,
        });
        const result = res.result as { rows: unknown[][] };
        assert.equal(result.rows.length, 5);
        assert.equal(String(result.rows[0]?.[1]), "Alice Silva");
      });

      it("query.run: GROUP BY", async () => {
        const res = await rpc("query.run", {
          connectionId: connId,
          sql: `SELECT c.city, SUM(o.total) AS city_total
                FROM orders o JOIN customers c ON c.id = o.customer_id
                GROUP BY c.city ORDER BY city_total DESC`,
          limit: 100,
        });
        const result = res.result as { rows: unknown[][] };
        assert.ok(result.rows.length >= 2, "expected at least 2 cities");
      });

      it("query.run: subquery", async () => {
        const res = await rpc("query.run", {
          connectionId: connId,
          sql: `SELECT name,
                (SELECT COUNT(*) FROM orders WHERE customer_id = customers.id) AS order_count
                FROM customers ORDER BY name`,
          limit: 100,
        });
        const result = res.result as { rows: unknown[][] };
        assert.equal(result.rows.length, 5);
        const alice = result.rows.find((r) => String(r?.[0]) === "Alice Silva");
        assert.ok(alice, "Alice not found");
        assert.equal(Number(alice?.[1]), 2, "Alice should have 2 orders");
      });

      it("query.run: CASE", async () => {
        const res = await rpc("query.run", {
          connectionId: connId,
          sql: `SELECT name, price,
                CASE WHEN price > 1000 THEN 'high' ELSE 'low' END AS tier
                FROM products ORDER BY price DESC`,
          limit: 100,
        });
        const result = res.result as { rows: unknown[][] };
        assert.equal(result.rows.length, 5);
        assert.equal(String(result.rows[0]?.[2]), "high");
      });

      it("metadata.listFunctions", async () => {
        const res = await rpc("metadata.listFunctions", { connectionId: connId });
        const result = res.result as { functions: { name: string }[] };
        const fnNames = result.functions.map((f) => f.name.toLowerCase());
        assert.ok(
          fnNames.some((n) => n.includes("get_customer_total")),
          `get_customer_total missing, got: ${fnNames}`,
        );
      });

      it("metadata.listIndexes (orders)", async () => {
        const res = await rpc("metadata.listIndexes", { connectionId: connId, schema: target.schema, table: "orders" });
        const result = res.result as { indexes: { columns: string[] }[] };
        assert.ok(result.indexes.length >= 1, `expected 1+ indexes, got ${result.indexes.length}`);
        const allCols = result.indexes.flatMap((idx) => [...idx.columns]).map((c) => c.toLowerCase());
        assert.ok(
          allCols.some((c) => c === "customer_id"),
          `customer_id index missing, got: ${allCols}`,
        );
      });

      it("metadata.getDefinition (view)", async () => {
        const res = await rpc("metadata.getDefinition", {
          connectionId: connId,
          kind: "view",
          schema: target.schema,
          name: target.dialect === "oracle" ? "ORDER_SUMMARY" : "order_summary",
        });
        const result = res.result as { sql: string };
        assert.ok(result.sql.length > 0, "view definition empty");
        assert.ok(
          /orders|customers/i.test(result.sql),
          `view def doesn't reference orders/customers: ${result.sql.slice(0, 200)}`,
        );
      });

      it("metadata.getDefinition (function)", async () => {
        const res = await rpc("metadata.getDefinition", {
          connectionId: connId,
          kind: "function",
          schema: target.schema,
          name: target.dialect === "oracle" ? "GET_CUSTOMER_TOTAL" : "get_customer_total",
        });
        const result = res.result as { sql: string };
        assert.ok(result.sql.length > 0, "function definition empty");
      });

      it("completion.get: FROM clause", async () => {
        const res = await rpc("completion.get", {
          connectionId: connId,
          sql: "SELECT 1 FROM ",
          cursor: "SELECT 1 FROM ".length,
        });
        const result = res.result as { suggestions: { label: string }[] };
        const labels = result.suggestions.map((s) => s.label);
        assert.ok(labels.includes("customers"), `customers missing from completion, got: ${labels}`);
        assert.ok(labels.includes("orders"), `orders missing from completion`);
      });

      it("completion.get: column of table", async () => {
        const res = await rpc("completion.get", {
          connectionId: connId,
          sql: "SELECT c. FROM customers c",
          cursor: "SELECT c.".length,
        });
        const result = res.result as { suggestions: { label: string }[] };
        const labels = result.suggestions.map((s) => s.label);
        assert.ok(labels.includes("id") || labels.includes("ID"), `id column missing from completion, got: ${labels}`);
        assert.ok(labels.includes("name") || labels.includes("NAME"), `name column missing`);
      });

      const itOrSkip = cteCompletionAvailable ? it : it.skip;

      itOrSkip("completion.get: after CTE", async () => {
        const res = await rpc("completion.get", {
          connectionId: connId,
          sql: "WITH cte AS (SELECT id, name FROM customers) SELECT * FROM ",
          cursor: "WITH cte AS (SELECT id, name FROM customers) SELECT * FROM ".length,
        });
        const result = res.result as { suggestions: { label: string }[] };
        const labels = result.suggestions.map((s) => s.label);
        assert.ok(labels.includes("cte"), `cte missing from completion, got: ${labels}`);
      });

      it("connection.remove", async () => {
        const res = await rpc("connection.remove", { connectionId: connId });
        const result = res.result as { ok: boolean };
        assert.equal(result.ok, true);

        const listRes = await rpc("connection.list");
        const list = listRes.result as { configs: { id: string }[] };
        assert.ok(!list.configs.some((c) => c.id === connId), "connection should be removed");
      });
    });
  }
});
}
