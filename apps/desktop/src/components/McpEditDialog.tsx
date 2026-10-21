import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
  tokens,
} from "@fluentui/react-components";
import { useMemo } from "react";
import { useLanguage } from "../i18n";
import { diffLines, type DiffLine } from "../lib/line-diff";

export interface McpEditProposal {
  tabId: string;
  kind?: "execute";
  connectionId?: string;
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
  onApply,
  onReject,
}: {
  proposal: McpEditProposal | null;
  onApply: () => void;
  onReject: () => void;
}) {
  const { t } = useLanguage();
  const diff = useMemo(() => proposal && proposal.kind !== "execute" ? diffLines(proposal.originalSql, proposal.proposedSql) : null, [proposal]);
  const removed = diff?.filter((line) => line.kind === "removed").length ?? 0;
  const added = diff?.filter((line) => line.kind === "added").length ?? 0;
  return (
    <Dialog open={proposal !== null} onOpenChange={(_, data) => !data.open && onReject()}>
      <DialogSurface className="omni-standard-dialog omni-mcp-edit-dialog">
        <DialogBody className="omni-dialog-body omni-mcp-edit-dialog-body">
          <DialogTitle style={{ flexShrink: 0 }}><span aria-hidden className="omni-mcp-origin-badge">{t("mcpFromClient")}</span> {t(proposal?.kind === "execute" ? "mcpExecuteTitle" : "mcpEditTitle")}</DialogTitle>
          <DialogContent className="omni-mcp-edit-dialog-content">
            <Text>{proposal?.kind === "execute" ? t("mcpExecuteWarning") : `${t("mcpEditRationale")}: ${proposal?.rationale}`}</Text>
            {proposal?.kind === "execute" && <Text>{t("activeConnection")}: {proposal.connectionLabel} · {t("mcpRowLimit")}: {proposal.limit}</Text>}
            <div className="omni-mcp-edit-grid">
              {diff ? <>
                <DiffPane label={t("mcpOriginalSql")} lines={diff.filter((line) => line.kind !== "added")} />
                <DiffPane label={t("mcpProposedSql")} lines={diff.filter((line) => line.kind !== "removed")} accent />
              </> : <SqlPreview label={t("mcpProposedSql")} value={proposal?.proposedSql ?? ""} accent />}
            </div>
          </DialogContent>
          <DialogActions className="omni-dialog-actions omni-mcp-edit-actions" style={{ flexShrink: 0 }}>
            {diff && <Text className="omni-mcp-edit-hint">{t("mcpDiffSummary").replace("{removed}", String(removed)).replace("{added}", String(added))} · {t("mcpNothingRunsUntilApply")} {t("mcpUndoHint")}</Text>}
            <span className="omni-dialog-actions-spacer" />
            <Button appearance="secondary" onClick={onReject}>{t("reject")}</Button>
            <Button appearance="primary" onClick={onApply}>{t(proposal?.kind === "execute" ? "run" : "applyEdit")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function DiffPane({ label, lines, accent = false }: { label: string; lines: readonly DiffLine[]; accent?: boolean }) {
  return (
    <section className="omni-mcp-diff-pane" aria-label={label}>
      <Text weight="semibold" className={accent ? "omni-mcp-diff-label is-accent" : "omni-mcp-diff-label"}>{label}</Text>
      <pre className={accent ? "omni-mcp-diff is-accent" : "omni-mcp-diff"}>
        {lines.map((line, index) => <span key={index} className={`omni-mcp-diff-line is-${line.kind}`}>{line.text || " "}</span>)}
      </pre>
    </section>
  );
}

function SqlPreview({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <Text weight="semibold">{label}</Text>
      <textarea
        aria-label={label}
        readOnly
        value={value}
        style={{
          minHeight: 220,
          width: "100%",
          resize: "vertical",
          boxSizing: "border-box",
          padding: 10,
          color: tokens.colorNeutralForeground1,
          background: tokens.colorNeutralBackground3,
          border: `1px solid ${accent ? tokens.colorBrandStroke1 : tokens.colorNeutralStroke1}`,
          borderRadius: 4,
          font: "12px ui-monospace, monospace",
        }}
      />
    </label>
  );
}
