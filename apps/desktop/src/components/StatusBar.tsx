import { Text, tokens } from "@fluentui/react-components";
import {
  PlugDisconnectedRegular,
  PlugConnectedRegular,
  ClockRegular,
  DocumentRegular,
  CursorRegular,
} from "@fluentui/react-icons";
import type { QueryResult } from "@omni-sql/ts-types";
import type { ConnectionEntry } from "../lib/backend";
import { DialectIcon } from "./DialectIcon";

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
      className="omni-status-bar"
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
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {connection ? (
          <PlugConnectedRegular fontSize={12} />
        ) : (
          <PlugDisconnectedRegular fontSize={12} />
        )}
        <Text size={200}>{connection?.label ?? "Sem conexão"}</Text>
      </span>
      {connection && (
        <Text size={200} style={{ opacity: 0.85, display: "flex", alignItems: "center", gap: 4 }}>
          <DialectIcon dialect={connection.dialect} size={12} />
          {dialectLabels[connection.dialect] ?? connection.dialect}
        </Text>
      )}
      {busyMsg && (
        <Text size={200} style={{ color: tokens.colorPaletteYellowForeground1, display: "flex", alignItems: "center", gap: 4 }}>
          <ClockRegular fontSize={12} />
          {busyMsg}
        </Text>
      )}
      <div style={{ flex: 1 }} />
      {result && (
        <Text size={200} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <DocumentRegular fontSize={12} />
          {result.rows.length} linha(s) · {result.columns.length} coluna(s) · {result.elapsedMs}ms
        </Text>
      )}
      {cursorPosition && (
        <Text size={200} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <CursorRegular fontSize={12} />
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </Text>
      )}
    </footer>
  );
}
