import type { ConnectionEntry } from "./backend";
import type { DialectId } from "@omni-sql/ts-types";

export const DIALECT_ICONS: Record<DialectId, string> = {
  postgres: "🐘",
  mysql: "🐬",
  mariadb: "🦭",
  sqlserver: "🗄️",
  oracle: "🟠",
  "jdbc-generic": "🔌",
  odbc: "🔗",
};

export function dialectIcon(dialect: ConnectionEntry["dialect"] | string | undefined): string {
  if (!dialect) return "🗄️";
  return DIALECT_ICONS[dialect as DialectId] ?? "🗄️";
}
