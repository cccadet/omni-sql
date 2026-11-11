import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
} from "@fluentui/react-components";
import { useMemo } from "react";
import { analyzeReadOnlySql } from "@omni-sql/autocomplete-engine";
import { connectionMcpAccess } from "@omni-sql/ts-types";
import { useLanguage } from "../i18n";
import type { ConnectionEntry } from "../lib/backend";
import { DIALECT_LABELS } from "../lib/dialect-labels";
import { useEnvironments } from "../lib/environments";
import { diffLines, type DiffLine } from "../lib/line-diff";
import { useColorizedSqlLines } from "../lib/sql-colorizer";
import { EnvironmentBadge, environmentName, findConnectionEnvironment } from "./Environments";

export interface McpEditProposal {
  tabId: string;
  tabTitle?: string;
  kind?: "execute";
  /** Execution target; starts as the suggested or active connection and follows the user's pick. */
  connectionId?: string;
  /** Set when the MCP client chose the connection instead of defaulting to the active one. */
  suggestedConnectionId?: string;
  connectionLabel?: string;
  limit?: number;
  originalSql: string;
  proposedSql: string;
  rationale: string;
  expiresAt?: number;
  revision: number;
}

export function McpEditDialog({
  proposal,
  connections = [],
  activeConnectionId = null,
  onSelectConnection,
  onApply,
  onReject,
}: {
  proposal: McpEditProposal | null;
  connections?: readonly ConnectionEntry[];
  activeConnectionId?: string | null;
  onSelectConnection?: (connectionId: string) => void;
  onApply: () => void;
  onReject: () => void;
}) {
  const { t } = useLanguage();
  const isExecute = proposal?.kind === "execute";
  const diff = useMemo(() => proposal && !isExecute ? diffLines(proposal.originalSql, proposal.proposedSql) : null, [proposal, isExecute]);
  const removed = diff?.filter((line) => line.kind === "removed").length ?? 0;
  const added = diff?.filter((line) => line.kind === "added").length ?? 0;
  const proposedLines = useMemo(() => (proposal?.proposedSql ?? "").split(/\r?\n/u).map((text): DiffLine => ({ kind: "same", text })), [proposal?.proposedSql]);
  const target = isExecute ? <ExecutionTarget proposal={proposal} connections={connections} activeConnectionId={activeConnectionId} onSelectConnection={onSelectConnection} /> : null;
  const blocked = isExecute && executionBlocked(proposal, connections);
  return (
    <Dialog open={proposal !== null} onOpenChange={(_, data) => !data.open && onReject()}>
      <DialogSurface className="omni-standard-dialog omni-mcp-edit-dialog">
        <DialogBody className="omni-dialog-body omni-mcp-edit-dialog-body">
          <DialogTitle style={{ flexShrink: 0 }}><span aria-hidden className="omni-mcp-origin-badge">{t("mcpFromClient")}</span> {t(isExecute ? "mcpExecuteTitle" : "mcpEditTitle")}</DialogTitle>
          <DialogContent className="omni-mcp-edit-dialog-content">
            <Text>{isExecute ? t("mcpExecuteWarning") : `${t("mcpEditRationale")}: ${proposal?.rationale}`}</Text>
            {!isExecute && (proposal?.tabTitle || proposal?.connectionLabel) && <div className="omni-mcp-edit-meta">
              {proposal.tabTitle && <span>{t("mcpEditTab")}: {proposal.tabTitle}</span>}
              {proposal.connectionLabel && <span>{t("activeConnection")}: {proposal.connectionLabel}</span>}
            </div>}
            {target}
            <div className={diff ? "omni-mcp-edit-grid" : "omni-mcp-edit-grid is-single"}>
              {diff ? <>
                <DiffPane label={t("mcpOriginalSql")} sql={proposal?.originalSql ?? ""} lines={diff.filter((line) => line.kind !== "added")} />
                <DiffPane label={t("mcpProposedSql")} sql={proposal?.proposedSql ?? ""} lines={diff.filter((line) => line.kind !== "removed")} accent />
              </> : <DiffPane label={t("mcpProposedSql")} sql={proposal?.proposedSql ?? ""} lines={proposedLines} accent />}
            </div>
          </DialogContent>
          <DialogActions className="omni-dialog-actions omni-mcp-edit-actions" style={{ flexShrink: 0 }}>
            {diff && <Text className="omni-mcp-edit-hint">{t("mcpDiffSummary").replace("{removed}", String(removed)).replace("{added}", String(added))} · {t("mcpNothingRunsUntilApply")} {t("mcpUndoHint")}</Text>}
            <span className="omni-dialog-actions-spacer" />
            <Button appearance="secondary" onClick={onReject}>{t("reject")}</Button>
            <Button appearance="primary" disabled={blocked} onClick={onApply}>{t(isExecute ? "run" : "applyEdit")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function selectedConnection(proposal: McpEditProposal, connections: readonly ConnectionEntry[]): ConnectionEntry | undefined {
  return connections.find((connection) => connection.id === proposal.connectionId);
}

/** Read-only connections cannot run writes; a missing or disabled connection cannot run at all. */
function executionBlocked(proposal: McpEditProposal, connections: readonly ConnectionEntry[]): boolean {
  const connection = selectedConnection(proposal, connections);
  if (!connection) return true;
  const access = connectionMcpAccess(connection);
  return access === "off" || (access === "read" && !analyzeReadOnlySql(proposal.proposedSql, connection.dialect).readOnly);
}

function ExecutionTarget({
  proposal,
  connections,
  activeConnectionId,
  onSelectConnection,
}: {
  proposal: McpEditProposal;
  connections: readonly ConnectionEntry[];
  activeConnectionId: string | null;
  onSelectConnection: ((connectionId: string) => void) | undefined;
}) {
  const { t } = useLanguage();
  const environments = useEnvironments();
  const options = connections.filter((connection) => connectionMcpAccess(connection) !== "off");
  const selected = selectedConnection(proposal, options);
  const environment = selected ? findConnectionEnvironment(selected, environments) : null;
  const access = selected ? connectionMcpAccess(selected) : null;
  const readOnlyBlocked = selected && access === "read" && !analyzeReadOnlySql(proposal.proposedSql, selected.dialect).readOnly;
  const optionText = (connection: ConnectionEntry) => {
    const env = findConnectionEnvironment(connection, environments);
    const parts = [`${connection.label} (${DIALECT_LABELS[connection.dialect] ?? connection.dialect})`];
    if (env) parts.push(environmentName(env, t) || env.id);
    if (connectionMcpAccess(connection) === "read") parts.push(t("mcpAccessRead"));
    return parts.join(" · ");
  };
  return (
    <div className="omni-mcp-target">
      <div className="omni-mcp-target-row">
        <Field label={t("mcpTargetConnection")} className="omni-mcp-target-field">
          <Select value={proposal.connectionId ?? ""} onChange={(_, data) => onSelectConnection?.(data.value)}>
            {!selected && <option value={proposal.connectionId ?? ""} disabled>{proposal.connectionId}</option>}
            {options.map((connection) => <option key={connection.id} value={connection.id}>{optionText(connection)}</option>)}
          </Select>
        </Field>
        <div className="omni-mcp-target-meta">
          {selected && <EnvironmentBadge connection={selected} />}
          <Text size={200}>{t("mcpRowLimit")}: {proposal.limit}</Text>
        </div>
      </div>
      {proposal.suggestedConnectionId && proposal.suggestedConnectionId === proposal.connectionId && <Text size={200} className="omni-mcp-target-note">{t("mcpConnectionSuggested")}</Text>}
      {selected && selected.id !== activeConnectionId && <MessageBar intent="warning"><MessageBarBody>{t("mcpConnectionNotActive")}</MessageBarBody></MessageBar>}
      {environment?.id === "production" && <MessageBar intent="error"><MessageBarBody>{t("mcpProductionWarning")}</MessageBarBody></MessageBar>}
      {readOnlyBlocked && <MessageBar intent="error"><MessageBarBody>{t("mcpReadOnlyBlocked")}</MessageBarBody></MessageBar>}
    </div>
  );
}

function DiffPane({ label, sql, lines, accent = false }: { label: string; sql: string; lines: readonly DiffLine[]; accent?: boolean }) {
  const colorized = useColorizedSqlLines(sql, lines.length);
  return (
    <section className="omni-mcp-diff-pane" aria-label={label}>
      <Text weight="semibold" className={accent ? "omni-mcp-diff-label is-accent" : "omni-mcp-diff-label"}>{label}</Text>
      <pre className={accent ? "omni-mcp-diff is-accent" : "omni-mcp-diff"} data-colorized={colorized ? "true" : undefined}>
        {lines.map((line, index) => {
          const html = colorized?.[index];
          // Monaco escapes the SQL text it renders; plain text is the fallback until it is ready.
          return html !== undefined && line.text
            ? <span key={index} className={`omni-mcp-diff-line is-${line.kind}`} dangerouslySetInnerHTML={{ __html: html }} />
            : <span key={index} className={`omni-mcp-diff-line is-${line.kind}`}>{line.text || " "}</span>;
        })}
      </pre>
    </section>
  );
}
