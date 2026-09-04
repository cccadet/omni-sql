import { useState } from "react";
import { Text, tokens } from "@fluentui/react-components";
import {
  PlugDisconnectedRegular,
  PlugConnectedRegular,
  ClockRegular,
  DocumentRegular,
  CursorRegular,
  PlugConnectedRegular as McpIcon,
} from "@fluentui/react-icons";
import type { QueryResult } from "@omni-sql/ts-types";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ConnectionEntry } from "../lib/backend";
import type { McpStatusResult } from "@omni-sql/ts-types";
import { DialectIcon } from "./DialectIcon";
import { useLanguage } from "../i18n";
import { McpStatusDialog } from "./McpStatusDialog";
export { createCopilotVsCodeMcpConfig } from "./McpStatusDialog";

export type ConnectionHealth = "unknown" | "verifying" | "online" | "offline";

export interface UpdateInfo {
  available: boolean;
  version?: string;
  releaseUrl?: string;
}

function displayUpdateVersion(version?: string): string {
  if (!version) return "";
  return ` ${version.startsWith("v") ? version : `v${version}`}`;
}

export type UpdateCheckStatus =
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "available"; version: string }
  | { state: "error"; message: string };

export type McpVisualState = "inactive" | "listening" | "connected" | "error";

export interface StatusBarProps {
  connection?: ConnectionEntry | null;
  result?: QueryResult | null;
  cursorPosition?: { line: number; column: number } | null;
  busyMsg?: string | null;
  health?: ConnectionHealth;
  update?: UpdateInfo | null;
  updateStatus?: UpdateCheckStatus | null;
  mcpState?: McpVisualState;
  mcpStatus?: McpStatusResult | null;
  mcpError?: string | null;
}

export function StatusBar({ connection, result, cursorPosition, busyMsg, health = "unknown", update, updateStatus, mcpState = "inactive", mcpStatus, mcpError }: StatusBarProps) {
  const { t } = useLanguage();
  const [mcpOpen, setMcpOpen] = useState(false);
  const dialectLabels: Record<string, string> = {
    postgres: "PostgreSQL",
    mysql: "MySQL",
    mariadb: "MariaDB",
    sqlserver: "SQL Server",
    oracle: "Oracle",
    "jdbc-generic": "JDBC",
    odbc: "ODBC",
  };
  const healthLabel = !connection ? t("noResults") : health === "verifying" ? t("loading") : health === "online" ? t("success") : health === "offline" ? t("failure") : t("error");
  const healthColor = health === "offline" ? tokens.colorPaletteRedForeground1 : health === "online" ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteYellowForeground1;
  const mcpLabel = mcpState === "connected" ? t("mcpConnected") : mcpState === "error" ? t("mcpError") : mcpState === "listening" ? t("mcpListening") : t("mcpInactive");
  const mcpColor = mcpState === "connected" ? tokens.colorPaletteGreenForeground1 : mcpState === "error" ? tokens.colorPaletteRedForeground1 : mcpState === "listening" ? tokens.colorPaletteYellowForeground1 : tokens.colorNeutralForeground2;

  return (
    <footer className="omni-status-bar">
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {connection && health === "online" ? (
          <PlugConnectedRegular fontSize={12} />
        ) : (
          <PlugDisconnectedRegular fontSize={12} />
        )}
        <Text size={200}>{connection?.label ?? t("noResults")}</Text>
      </span>
      {connection && <Text size={200} style={{ color: healthColor }}>{healthLabel}</Text>}
      {connection && (
        <Text size={200} style={{ opacity: 0.85, display: "flex", alignItems: "center", gap: 4 }}>
          <DialectIcon dialect={connection.dialect} size={12} />
          {dialectLabels[connection.dialect] ?? connection.dialect}
        </Text>
      )}
      <button
        type="button"
        aria-label={`${t("mcp")}: ${mcpLabel}`}
        onClick={() => setMcpOpen(true)}
        style={{ display: "flex", alignItems: "center", gap: 5, border: 0, padding: "2px 5px", borderRadius: 4, background: "transparent", color: mcpColor, cursor: "pointer", font: "inherit" }}
        title={mcpLabel}
      >
        <McpIcon fontSize={13} />
        <Text size={200}>{t("mcp")}</Text>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: mcpColor }} />
      </button>
      {busyMsg && (
        <Text size={200} style={{ color: tokens.colorPaletteYellowForeground1, display: "flex", alignItems: "center", gap: 4 }}>
          <ClockRegular fontSize={12} />
          {busyMsg}
        </Text>
      )}
      <div style={{ flex: 1 }} />
      {updateStatus?.state === "checking" && (
        <Text size={200} role="status" aria-live="polite">{t("checkingForUpdates")}</Text>
      )}
      {updateStatus?.state === "up-to-date" && (
        <Text size={200} role="status" aria-live="polite">{t("upToDate")}</Text>
      )}
      {updateStatus?.state === "error" && (
        <Text size={200} role="status" aria-live="polite" style={{ color: tokens.colorPaletteRedForeground1 }}>
          {updateStatus.message}
        </Text>
      )}
      {update?.available && (
        <button
          type="button"
          aria-label={t("updateAvailable").replace("{version}", displayUpdateVersion(update.version))}
          onClick={() => {
            if (!update.releaseUrl) return;
            try {
              const url = new URL(update.releaseUrl);
              if (url.protocol !== "https:") return;
              if (!window.confirm(t("openReleasePrompt").replace("{version}", update.version ?? ""))) return;
              void openUrl(url.toString()).catch(() => {
                // Ignore opener failures.
              });
            } catch {
              // Ignore malformed release URLs.
            }
          }}
          style={{
            padding: "2px 6px",
            border: `1px solid ${tokens.colorBrandStroke1}`,
            borderRadius: 3,
            background: "transparent",
            color: tokens.colorBrandForeground1,
            cursor: update.releaseUrl ? "pointer" : "default",
            font: "inherit",
          }}
        >
          {t("updateAvailable").replace("{version}", displayUpdateVersion(update.version))}
        </button>
      )}
      {result && (
        <Text size={200} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <DocumentRegular fontSize={12} />
          {result.rows.length} {t("rowCount")} · {result.columns.length} {t("columnCount")} · {result.elapsedMs}ms
        </Text>
      )}
      {cursorPosition && (
        <Text size={200} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <CursorRegular fontSize={12} />
          {t("line")} {cursorPosition.line}, {t("column")} {cursorPosition.column}
        </Text>
      )}
      <McpStatusDialog open={mcpOpen} onOpenChange={setMcpOpen} state={mcpState} status={mcpStatus} error={mcpError} />
    </footer>
  );
}
