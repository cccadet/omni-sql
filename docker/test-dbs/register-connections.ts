/**
 * Cadastra as conexões dos bancos de teste no backend já iniciado.
 *
 * Uso:
 *   pnpm -w run seed:test-connections
 *   pnpm -w run seed:test-connections -- pg mysql
 *   OMNI_SQL_BACKEND_URL=http://127.0.0.1:41920/rpc pnpm -w run seed:test-connections
 */

import type { ConnectionConfig } from "@omni-sql/ts-types";

interface Target {
  readonly key: string;
  readonly passwordEnv: string;
  readonly password: string;
  readonly config: ConnectionConfig;
}

interface RpcResponse<T = unknown> {
  readonly result?: T;
  readonly error?: { readonly code: number; readonly message: string };
}

const backendUrl = process.env.OMNI_SQL_BACKEND_URL ?? "http://127.0.0.1:41920/rpc";

const targets: readonly Target[] = [
  {
    key: "pg",
    passwordEnv: "OMNI_SQL_TEST_PG_PASSWORD",
    password: "omni",
    config: {
      id: "test-pg",
      label: "Test PostgreSQL",
      dialect: "postgres",
      endpoint: "127.0.0.1:5432/omni_test",
      user: "omni",
    },
  },
  {
    key: "mysql",
    passwordEnv: "OMNI_SQL_TEST_MYSQL_PASSWORD",
    password: "omni",
    config: {
      id: "test-mysql",
      label: "Test MySQL",
      dialect: "mysql",
      endpoint: "127.0.0.1:3306/omni_test",
      user: "omni",
    },
  },
  {
    key: "mssql",
    passwordEnv: "OMNI_SQL_TEST_MSSQL_PASSWORD",
    password: "Omni!2024",
    config: {
      id: "test-mssql",
      label: "Test SQL Server",
      dialect: "sqlserver",
      endpoint: "127.0.0.1:1433/omni_test",
      user: "sa",
    },
  },
  {
    key: "oracle",
    passwordEnv: "OMNI_SQL_TEST_ORACLE_PASSWORD",
    password: "omni",
    config: {
      id: "test-oracle",
      label: "Test Oracle XE",
      dialect: "oracle",
      endpoint: "127.0.0.1:1521/XEPDB1",
      user: "OMNI",
    },
  },
];

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(backendUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: method, method, ...(params === undefined ? {} : { params }) }),
    });
  } catch (error) {
    throw new Error(`não foi possível acessar ${backendUrl}: ${(error as Error).message}`);
  }

  const body = (await response.json()) as RpcResponse<T>;
  if (body.error) throw new Error(`${method} (${body.error.code}): ${body.error.message}`);
  if (!response.ok || body.result === undefined) {
    throw new Error(`${method}: resposta HTTP ${response.status} sem resultado`);
  }
  return body.result;
}

const requested = process.argv.slice(2).filter((arg) => arg !== "--");
if (requested.includes("--help") || requested.includes("-h")) {
  console.log("Uso: pnpm -w run seed:test-connections [pg] [mysql] [mssql] [oracle]");
  console.log(`Backend: ${backendUrl}`);
  process.exit(0);
}

const selected = requested.length === 0
  ? targets
  : targets.filter((target) => requested.includes(target.key));
const unknown = requested.filter((key) => !targets.some((target) => target.key === key));
if (unknown.length > 0 || selected.length === 0) {
  throw new Error(`dialeto(s) inválido(s): ${unknown.join(", ") || requested.join(", ")}. Use pg, mysql, mssql ou oracle.`);
}

for (const target of selected) {
  const password = process.env[target.passwordEnv] ?? target.password;
  await rpc("connection.add", { config: target.config, password });
  console.log(`✓ ${target.key}: ${target.config.id} cadastrado/atualizado`);
}

const list = await rpc<{ configs: readonly Pick<ConnectionConfig, "id" | "label" | "dialect">[] }>("connection.list");
const registered = new Set(list.configs.map((config) => config.id));
console.log(`\nConexões persistidas (${list.configs.length}):`);
for (const config of list.configs) {
  console.log(`- ${config.id} — ${config.label} (${config.dialect})`);
}

const missing = selected.filter((target) => !registered.has(target.config.id));
if (missing.length > 0) {
  throw new Error(`cadastro não confirmado para: ${missing.map((target) => target.key).join(", ")}`);
}
