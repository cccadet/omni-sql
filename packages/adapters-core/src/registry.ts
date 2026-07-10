import type { ConnectionConfig } from "@omni-sql/ts-types";
import type { Adapter, AdapterFactory } from "./index.ts";

/**
 * Registro de fábricas por dialeto. Em Fase 2 adicionamos `pg` real; Fase 4
 * adiciona MySQL/SQLServer/Oracle; Fase 6 JDBC genérico; Fase 7 ODBC.
 */
const factories = new Map<ConnectionConfig["dialect"], AdapterFactory>();

export function registerAdapter(dialect: ConnectionConfig["dialect"], factory: AdapterFactory): void {
  factories.set(dialect, factory);
}

export function resolveAdapter(config: ConnectionConfig, password?: string): Adapter {
  const factory = factories.get(config.dialect);
  if (!factory) {
    throw new Error(`adapter not registered for dialect: ${config.dialect}`);
  }
  return factory(config, password);
}
