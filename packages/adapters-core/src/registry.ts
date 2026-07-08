import type { ConnectionConfig } from "@omni-sql/ts-types";
import type { Adapter, AdapterFactory } from "./index.ts";
import { InMemoryAdapter } from "./in-memory.ts";

/**
 * Registro de fábricas por dialeto. Em Fase 2 adicionamos `pg` real; Fase 4
 * adiciona MySQL/SQLServer/Oracle; Fase 6 JDBC genérico; Fase 7 ODBC.
 */
const factories = new Map<ConnectionConfig["dialect"], AdapterFactory>();

function register(dialect: ConnectionConfig["dialect"], factory: AdapterFactory): void {
  factories.set(dialect, factory);
}

/** Fase 0: InMemoryAdapter responde por dialetos não implementados como fallback. */
function inMemoryFactory(config: ConnectionConfig): Adapter {
  return new InMemoryAdapter(config);
}

export function registerAdapter(dialect: ConnectionConfig["dialect"], factory: AdapterFactory): void {
  factories.set(dialect, factory);
}

export function resolveAdapter(config: ConnectionConfig): Adapter {
  const factory = factories.get(config.dialect) ?? inMemoryFactory;
  return factory(config);
}

// Bootstrap default registry — Fase 0 só tem in-memory; fases subsequentes
// chamam registerAdapter("postgres", pgFactory) antes de resolveAdapter.
export function bootstrapDefaultRegistry(): void {
  for (const dialect of [
    "postgres", "mysql", "mariadb", "sqlserver", "oracle", "jdbc-generic", "odbc",
  ] as const) {
    if (!factories.has(dialect)) {
      register(dialect, inMemoryFactory);
    }
  }
}

export { InMemoryAdapter };