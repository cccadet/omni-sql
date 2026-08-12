import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Text, tokens } from "@fluentui/react-components";
import {
  PlugDisconnectedRegular,
  PlugConnectedRegular,
  ClockRegular,
  DocumentRegular,
  CursorRegular,
  PlugConnectedRegular as McpIcon,
  CopyRegular,
} from "@fluentui/react-icons";
import { invoke } from "@tauri-apps/api/core";
import type { QueryResult } from "@omni-sql/ts-types";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ConnectionEntry } from "../lib/backend";
import type { McpStatusResult } from "@omni-sql/ts-types";
import { DialectIcon } from "./DialectIcon";
import { useLanguage } from "../i18n";

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

interface McpLauncherConfig {
  command: string;
  args: string[];
  endpoint?: string;
}

export function createCopilotVsCodeMcpConfig(config: Pick<McpLauncherConfig, "command" | "args">): string {
  return JSON.stringify({
    servers: {
      "omni-sql": {
        command: config.command,
        args: config.args,
      },
    },
  }, null, 2);
}

function McpCopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard failure must not be presented as success.
    }
  };

  return (
    <Button
      appearance="subtle"
      size="small"
      icon={<CopyRegular />}
      aria-label={copied ? `${label} — ${copiedLabel}` : label}
      title={copied ? copiedLabel : label}
      onClick={() => void copy()}
    />
  );
}

export function StatusBar({ connection, result, cursorPosition, busyMsg, health = "unknown", update, updateStatus, mcpState = "inactive", mcpStatus, mcpError }: StatusBarProps) {
  const { t } = useLanguage();
  const [mcpOpen, setMcpOpen] = useState(false);
  const [config, setConfig] = useState<McpLauncherConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
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
  const mcpColor = mcpState === "connected" ? tokens.colorPaletteGreenForeground1 : mcpState === "error" ? tokens.colorPaletteRedForeground1 : mcpState === "listening" ? tokens.colorPaletteYellowForeground1 : tokens.colorNeutralForegroundOnBrand;
  const mcpClientConnected = mcpState === "connected" || mcpStatus?.uiConnected === true;
  const httpEndpoint = safeHttpEndpoint(config?.endpoint);

  const openMcp = () => {
    setMcpOpen(true);
    setConfig(null);
    setConfigError(null);
    void invoke<McpLauncherConfig>("get_mcp_launcher_config")
      .then(setConfig)
      .catch((error: unknown) => {
        setConfig(null);
        setConfigError(error instanceof Error ? error.message : String(error));
      });
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
        onClick={openMcp}
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
            border: `1px solid ${tokens.colorNeutralStrokeOnBrand}`,
            borderRadius: 3,
            background: "transparent",
            color: tokens.colorNeutralForegroundOnBrand,
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
      <Dialog open={mcpOpen} onOpenChange={(_, data) => setMcpOpen(data.open)}>
        <DialogSurface style={{ width: "min(620px, calc(100vw - 24px))", maxHeight: "calc(100vh - 24px)", display: "flex", flexDirection: "column" }}>
          <DialogBody style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <DialogTitle style={{ flexShrink: 0 }}>{t("mcpStatusTitle")}</DialogTitle>
            <DialogContent style={{ display: "grid", gap: 12, overflowY: "auto", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <Text weight="semibold" style={{ color: mcpColor, minWidth: 0, overflowWrap: "anywhere" }}>{mcpLabel}</Text>
              </div>
              {mcpClientConnected ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Text style={{ minWidth: 0, overflowWrap: "anywhere" }}>{t("mcpActiveClient")} · {t("mcpQueue")}: {mcpStatus?.queueSize ?? 0}</Text>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Text style={{ minWidth: 0, overflowWrap: "anywhere" }}>{t("mcpNoClient")}</Text>
                </div>
              )}
              <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("mcpStatusHelp")}</Text>
              <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("mcpStartFirst")}</Text>
              {(mcpError || configError) && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Text style={{ color: tokens.colorPaletteRedForeground1, minWidth: 0, overflowWrap: "anywhere" }}>{mcpError ?? configError}</Text>
                </div>
              )}
              {config && (
                <div style={{ display: "grid", gap: 6 }}>
                  <Text weight="semibold">{t("configureClient")}</Text>
                  {httpEndpoint ? (
                    <McpValue label={t("mcpHttpEndpoint")} value={httpEndpoint} copyLabel={t("copyEndpoint")} copiedLabel={t("copied")} />
                  ) : (
                    <>
                      <McpValue label={t("mcpCommand")} value={config.command} copyLabel={t("copyCommand")} copiedLabel={t("copied")} />
                      {config.args.map((arg, index) => (
                        <McpValue key={`${index}-${arg}`} label={`${t("mcpArgument")} ${index + 1}`} value={arg} copyLabel={`${t("copyArgument")} ${index + 1}`} copiedLabel={t("copied")} />
                      ))}
                      <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("mcpCopilotVsCodeHelp")}</Text>
                      <McpValue
                        label={t("mcpCopilotVsCodeConfig")}
                        value={createCopilotVsCodeMcpConfig(config)}
                        copyLabel={t("copyCopilotVsCodeConfig")}
                        copiedLabel={t("copied")}
                      />
                    </>
                  )}
                </div>
              )}
            </DialogContent>
            <DialogActions style={{ flexShrink: 0 }}>
              <Button appearance="secondary" onClick={() => setMcpOpen(false)}>{t("cancel")}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </footer>
  );
}

function McpValue({ label, value, copyLabel, copiedLabel }: { label: string; value: string; copyLabel: string; copiedLabel: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: 8, minWidth: 0 }}>
      <Text size={200} weight="semibold" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{label}</Text>
      <code style={{ minWidth: 0, overflowWrap: "anywhere", padding: "6px 8px", color: tokens.colorNeutralForeground1, background: tokens.colorNeutralBackground3, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: 4 }}>{value}</code>
      <McpCopyButton value={value} label={copyLabel} copiedLabel={copiedLabel} />
    </div>
  );
}

function safeHttpEndpoint(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return `${url.origin}${url.pathname || "/"}`;
  } catch {
    return null;
  }
}
