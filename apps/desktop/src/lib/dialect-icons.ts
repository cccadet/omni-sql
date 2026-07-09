import type { ConnectionEntry } from "./backend";

export const DIALECT_ICONS: Record<ConnectionEntry["dialect"], string> = {
  postgres: "🐘",
  mysql: "🐬",
  mariadb: "🦭",
  sqlserver: "🗄️",
  oracle: "🟠",
  "jdbc-generic": "🔌",
  odbc: "🔗",
};

export function dialectIcon(dialect: ConnectionEntry["dialect"]): string {
  return DIALECT_ICONS[dialect] ?? "🗄️";
}
