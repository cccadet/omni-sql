import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Tab, TabList, Text, tokens } from "@fluentui/react-components";
import { ArrowClockwiseRegular, ChevronDownRegular, ChevronUpRegular, CopyRegular, PlugConnectedRegular } from "@fluentui/react-icons";
import { invoke } from "@tauri-apps/api/core";
import type { McpHistoryEntry, McpHistoryResult, McpStatusResult } from "@omni-sql/ts-types";
import { backend } from "../lib/backend";
import { useLanguage } from "../i18n";
import type { McpVisualState } from "./StatusBar";

interface McpLauncherConfig { command: string; args: string[]; endpoint?: string }

export function createCopilotVsCodeMcpConfig(config: Pick<McpLauncherConfig, "command" | "args">): string {
  return JSON.stringify({ servers: { "omni-sql": { command: config.command, args: config.args } } }, null, 2);
}

interface McpStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: McpVisualState;
  status?: McpStatusResult | null;
  error?: string | null;
}

export function McpStatusDialog({ open, onOpenChange, state, status, error }: McpStatusDialogProps) {
  const { t } = useLanguage();
  const [section, setSection] = useState<"configuration" | "activity">("configuration");
  const [client, setClient] = useState<"copilot" | "stdio" | "http">("copilot");
  const [config, setConfig] = useState<McpLauncherConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly McpHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const label = state === "connected" ? t("mcpConnected") : state === "error" ? t("mcpError") : state === "listening" ? t("mcpListening") : t("mcpInactive");
  const color = state === "connected" ? tokens.colorPaletteGreenForeground1 : state === "error" ? tokens.colorPaletteRedForeground1 : state === "listening" ? tokens.colorPaletteYellowForeground1 : tokens.colorNeutralForeground2;
  const connected = state === "connected" || status?.uiConnected === true;
  const endpoint = safeHttpEndpoint(config?.endpoint);

  const loadHistory = () => {
    setHistoryError(null);
    setHistoryLoading(true);
    void backend.call<McpHistoryResult>("mcp.history", undefined)
      .then((result) => setHistory(result.entries))
      .catch((reason: unknown) => { setHistory(null); setHistoryError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => setHistoryLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setSection("configuration");
    setConfig(null);
    setConfigError(null);
    setHistory(null);
    setHistoryError(null);
    setExpanded(new Set());
    void invoke<McpLauncherConfig>("get_mcp_launcher_config")
      .then((value) => { setConfig(value); setClient(safeHttpEndpoint(value.endpoint) ? "http" : "copilot"); })
      .catch((reason: unknown) => setConfigError(reason instanceof Error ? reason.message : String(reason)));
  }, [open]);

  const selectSection = (value: "configuration" | "activity") => {
    setSection(value);
    if (value === "activity" && history === null && !historyLoading) loadHistory();
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className="omni-standard-dialog omni-mcp-status-dialog">
        <DialogBody className="omni-dialog-body">
          <DialogTitle>{t("mcpStatusTitle")}</DialogTitle>
          <DialogContent className="omni-mcp-dialog-content">
            <section className="omni-mcp-summary" aria-label={label}>
              <span className="omni-mcp-summary-icon" style={{ color }}><PlugConnectedRegular /></span>
              <div className="omni-mcp-summary-copy">
                <Text weight="semibold" style={{ color }}>{label}</Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                  {connected ? `${t("mcpActiveClient")} · ${t("mcpQueue")}: ${status?.queueSize ?? 0}` : t("mcpNoClient")}
                </Text>
              </div>
              <span className="omni-mcp-status-dot" style={{ background: color }} />
            </section>

            {(error || configError) && <div className="omni-mcp-error" role="alert">{error ?? configError}</div>}

            <TabList selectedValue={section} onTabSelect={(_, data) => selectSection(data.value as "configuration" | "activity")} aria-label={t("mcpStatusTitle")}>
              <Tab value="configuration">{t("mcpConfigurationTab")}</Tab>
              <Tab value="activity">{t("mcpActivityTab")}</Tab>
            </TabList>

            {section === "configuration" && (
              <div className="omni-mcp-section">
                <div>
                  <Text weight="semibold">{t("configureClient")}</Text>
                  <Text block size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("mcpStartFirst")}</Text>
                </div>
                {config ? (
                  <>
                    <TabList size="small" selectedValue={client} onTabSelect={(_, data) => setClient(data.value as typeof client)} aria-label={t("configureClient")}>
                      {!endpoint && <Tab value="copilot">{t("mcpCopilotVsCodeConfig")}</Tab>}
                      {endpoint && <Tab value="http">HTTP</Tab>}
                      <Tab value="stdio">{t("mcpStdioTab")}</Tab>
                    </TabList>
                    {client === "copilot" && <McpValue value={createCopilotVsCodeMcpConfig(config)} copyLabel={t("copyCopilotVsCodeConfig")} copiedLabel={t("copied")} multiline help={t("mcpCopilotVsCodeHelp")} />}
                    {client === "http" && endpoint && <McpValue label={t("mcpHttpEndpoint")} value={endpoint} copyLabel={t("copyEndpoint")} copiedLabel={t("copied")} />}
                    {client === "stdio" && <div className="omni-mcp-stdio-list">
                      <McpValue label={t("mcpCommand")} value={config.command} copyLabel={t("copyCommand")} copiedLabel={t("copied")} />
                      {config.args.map((argument, index) => <McpValue key={`${index}-${argument}`} label={`${t("mcpArgument")} ${index + 1}`} value={argument} copyLabel={`${t("copyArgument")} ${index + 1}`} copiedLabel={t("copied")} />)}
                    </div>}
                  </>
                ) : !configError && <div className="omni-empty-state">{t("loading")}</div>}
              </div>
            )}

            {section === "activity" && (
              <div className="omni-mcp-section">
                <div className="omni-mcp-section-heading">
                  <div><Text weight="semibold">{t("mcpRecentRequests")}</Text><Text block size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("mcpActivityHelp")}</Text></div>
                  <Button appearance="subtle" size="small" icon={<ArrowClockwiseRegular />} aria-label={t("mcpHistoryRefresh")} title={t("mcpHistoryRefresh")} onClick={loadHistory} disabled={historyLoading} />
                </div>
                {historyLoading && history === null && <div className="omni-empty-state">{t("loading")}</div>}
                {historyError && <div className="omni-mcp-error" role="alert">{historyError}</div>}
                {!historyLoading && !historyError && (history ?? []).length === 0 && <div className="omni-empty-state">{t("mcpHistoryEmpty")}</div>}
                <div className="omni-mcp-history">
                  {(history ?? []).map((entry) => <HistoryEntry key={entry.id} entry={entry} expanded={expanded.has(entry.id)} onToggle={() => setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(entry.id)) next.delete(entry.id);
                    else next.add(entry.id);
                    return next;
                  })} />)}
                </div>
              </div>
            )}
          </DialogContent>
          <DialogActions className="omni-dialog-actions"><Button appearance="secondary" onClick={() => onOpenChange(false)}>{t("close")}</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function HistoryEntry({ entry, expanded, onToggle }: { entry: McpHistoryEntry; expanded: boolean; onToggle: () => void }) {
  const { t } = useLanguage();
  const statusLabel = entry.status === "completed" ? t("success") : entry.status === "error" ? t("failure") : t("mcpHistoryPending");
  const statusColor = entry.status === "completed" ? tokens.colorPaletteGreenForeground1 : entry.status === "error" ? tokens.colorPaletteRedForeground1 : tokens.colorPaletteYellowForeground1;
  return <article className="omni-mcp-history-item">
    <div className="omni-mcp-history-heading"><Text size={200} className="omni-mcp-history-time">{new Date(entry.receivedAt).toLocaleTimeString()}</Text><Text weight="semibold" className="omni-mcp-history-tool">{entry.tool}</Text><Text size={200} style={{ color: statusColor }}>{statusLabel}</Text></div>
    <Text size={200} className="omni-mcp-history-rationale">{entry.rationale}</Text>
    <button type="button" className="omni-mcp-sql-toggle" onClick={onToggle} aria-expanded={expanded}>{expanded ? <ChevronUpRegular /> : <ChevronDownRegular />} {expanded ? t("mcpHideSql") : t("mcpShowSql")}</button>
    {expanded && <pre className="omni-mcp-history-sql">{entry.sql}</pre>}
    {entry.errorMessage && <Text size={200} style={{ color: tokens.colorPaletteRedForeground1, overflowWrap: "anywhere" }}>{entry.errorMessage}</Text>}
  </article>;
}

function McpValue({ label, value, copyLabel, copiedLabel, multiline, help }: { label?: string; value: string; copyLabel: string; copiedLabel: string; multiline?: boolean; help?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { if (!navigator.clipboard?.writeText) return; try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* do not report false success */ } };
  return <div className="omni-mcp-config-card">
    <div className="omni-mcp-config-heading">
      <div>{label && <Text weight="semibold">{label}</Text>}{help && <Text block size={200} style={{ color: tokens.colorNeutralForeground2 }}>{help}</Text>}</div>
      <Button appearance="secondary" size="small" icon={<CopyRegular />} onClick={() => void copy()}>{copied ? copiedLabel : copyLabel}</Button>
    </div>
    {multiline ? <pre className="omni-mcp-config-value">{value}</pre> : <code className="omni-mcp-config-value">{value}</code>}
  </div>;
}

function safeHttpEndpoint(value?: string): string | null { if (!value) return null; try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? `${url.origin}${url.pathname || "/"}` : null; } catch { return null; } }
