import { Text, tokens } from "@fluentui/react-components";
import type { QueryResult } from "@omni-sql/ts-types";
import type { ConnectionEntry } from "../lib/backend";

export interface StatusBarProps {
  connection?: ConnectionEntry | null;
  result?: QueryResult | null;
  cursorPosition?: { line: number; column: number } | null;
  busyMsg?: string | null;
}

export function StatusBar({ connection, result, cursorPosition, busyMsg }: StatusBarProps) {
  const dialectLabels: Record<string, string> = {
    postgres: "PostgreSQL",
    mysql: "MySQL",
    mariadb: "MariaDB",
    sqlserver: "SQL Server",
    oracle: "Oracle",
    "jdbc-generic": "JDBC",
    odbc: "ODBC",
  };

  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "4px 12px",
        background: tokens.colorBrandBackground,
        color: tokens.colorNeutralForegroundOnBrand,
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
        fontSize: 12,
      }}
    >
      <Text size={200}>{connection?.label ?? "Sem conexão"}</Text>
      {connection && (
        <Text size={200} style={{ opacity: 0.85 }}>
          {dialectLabels[connection.dialect] ?? connection.dialect}
        </Text>
      )}
      {busyMsg && (
        <Text size={200} style={{ color: tokens.colorPaletteYellowForeground1 }}>
          {busyMsg}
        </Text>
      )}
      <div style={{ flex: 1 }} />
      {result && (
        <Text size={200}>
          {result.rows.length} linha(s) · {result.columns.length} coluna(s) · {result.elapsedMs}ms
        </Text>
      )}
      {cursorPosition && (
        <Text size={200}>
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </Text>
      )}
    </footer>
  );
}
