import { Toolbar as FluentToolbar, ToolbarButton, Spinner, tokens } from "@fluentui/react-components";
import {
  AddRegular,
  PlayRegular,
  StopRegular,
  DatabaseRegular,
  SettingsRegular,
  FolderOpenRegular,
  SaveRegular,
  PanelLeftContractRegular,
  HistoryRegular,
  EditRegular,
  DeleteRegular,
  ArrowSyncRegular,
  CheckmarkCircleRegular,
  CircleRegular,
  WrenchRegular,
} from "@fluentui/react-icons";
import type { ConnectionEntry } from "../lib/backend";

export interface ToolbarProps {
  connections: ConnectionEntry[];
  activeConnectionId: string | null;
  busyMsg?: string | null;
  running?: boolean;
  limit?: number;
  onAdd?: () => void;
  onAddConnection?: () => void;
  onEditConnection?: () => void;
  onRemoveConnection?: () => void;
  onRefreshMetadata?: () => void;
  onSelectConnection?: (id: string) => void;
  onRun?: () => void;
  onExplain?: () => void;
  onCancelRun?: () => void;
  onRunChoice?: (choice: "current" | "all") => void;
  onRunChoiceCancel?: () => void;
  pendingRunCount?: number | null;
  onLimitChange?: (limit: number) => void;
  onSave?: () => void;
  onOpen?: () => void;
  onOpenFormatSettings?: () => void;
  onToggleSidebar?: () => void;
  onToggleHistory?: () => void;
}

const LIMIT_OPTIONS = [10, 100, 500, 1000, 5000, 10000];

export function Toolbar({
  connections,
  activeConnectionId,
  busyMsg,
  running = false,
  limit = 1000,
  onAdd,
  onAddConnection,
  onEditConnection,
  onRemoveConnection,
  onRefreshMetadata,
  onSelectConnection,
  onRun,
  onExplain,
  onCancelRun,
  onRunChoice,
  onRunChoiceCancel,
  pendingRunCount = null,
  onLimitChange,
  onSave,
  onOpen,
  onOpenFormatSettings,
  onToggleSidebar,
  onToggleHistory,
}: ToolbarProps) {
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const metaSynced = !!activeConnection?.lastSyncedAt;

  return (
    <FluentToolbar style={{ padding: 8, gap: 8, alignItems: "center" }}>
      <select
        aria-label="Conexão ativa"
        value={activeConnectionId ?? ""}
        onChange={(e) => onSelectConnection?.(e.target.value)}
        style={{
          minWidth: 180,
          padding: "4px 8px",
          borderRadius: 4,
          border: `1px solid ${tokens.colorNeutralStroke1}`,
          background: tokens.colorNeutralBackground1,
          color: tokens.colorNeutralForeground1,
        }}
      >
        {connections.length === 0 && (
          <option value="" disabled>
            Nenhuma conexão cadastrada
          </option>
        )}
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>

      <span title={metaSynced ? "Metadados sincronizados" : "Metadados pendentes"}>
        {metaSynced ? (
          <CheckmarkCircleRegular style={{ color: tokens.colorPaletteGreenForeground1 }} />
        ) : (
          <CircleRegular style={{ color: tokens.colorNeutralForeground3 }} />
        )}
      </span>

      <ToolbarButton icon={<PanelLeftContractRegular />} onClick={onToggleSidebar} aria-label="Alternar sidebar" />

      <ToolbarButton icon={<AddRegular />} onClick={onAdd} aria-label="Nova aba" />
      <ToolbarButton icon={<DatabaseRegular />} onClick={onAddConnection} aria-label="Nova conexão" />
      <ToolbarButton icon={<EditRegular />} onClick={onEditConnection} disabled={!activeConnectionId} aria-label="Editar conexão" />
      <ToolbarButton icon={<DeleteRegular />} onClick={onRemoveConnection} disabled={!activeConnectionId} aria-label="Remover conexão" />
      <ToolbarButton icon={<ArrowSyncRegular />} onClick={onRefreshMetadata} disabled={!activeConnectionId || !!busyMsg} aria-label="Atualizar metadados" />

      {running ? (
        <ToolbarButton icon={<StopRegular />} onClick={onCancelRun} appearance="primary" style={{ backgroundColor: tokens.colorPaletteRedBackground1 }}>
          Cancelar
        </ToolbarButton>
      ) : (
        <ToolbarButton icon={<PlayRegular />} onClick={onRun} appearance="primary" disabled={!activeConnectionId}>
          Executar
        </ToolbarButton>
      )}

      <ToolbarButton icon={<WrenchRegular />} onClick={onExplain} disabled={!activeConnectionId || running} aria-label="Explicar query">
        EXPLAIN
      </ToolbarButton>

      <select
        aria-label="Limite de linhas"
        value={limit}
        onChange={(e) => onLimitChange?.(Number(e.target.value))}
        style={{
          padding: "4px 8px",
          borderRadius: 4,
          border: `1px solid ${tokens.colorNeutralStroke1}`,
          background: tokens.colorNeutralBackground1,
          color: tokens.colorNeutralForeground1,
        }}
      >
        {LIMIT_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt} linhas
          </option>
        ))}
      </select>

      <ToolbarButton icon={<FolderOpenRegular />} onClick={onOpen} aria-label="Abrir arquivo">
        Abrir
      </ToolbarButton>
      <ToolbarButton icon={<SaveRegular />} onClick={onSave} aria-label="Salvar aba">
        Salvar
      </ToolbarButton>
      <ToolbarButton icon={<SettingsRegular />} onClick={onOpenFormatSettings} aria-label="Formatador SQL" />
      <ToolbarButton icon={<HistoryRegular />} onClick={onToggleHistory} aria-label="Histórico" />

      <div style={{ flex: 1 }} />

      {busyMsg && <Spinner size="tiny" label={busyMsg} labelPosition="after" />}

      {pendingRunCount && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={onRunChoiceCancel}
          role="presentation"
        >
          <div
            style={{
              background: tokens.colorNeutralBackground1,
              border: `1px solid ${tokens.colorNeutralStroke1}`,
              borderRadius: 8,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 280,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600 }}>Esta aba tem várias instruções</div>
            <ToolbarButton onClick={() => onRunChoice?.("current")} appearance="primary">
              Rodar instrução atual
            </ToolbarButton>
            <ToolbarButton onClick={() => onRunChoice?.("all")}>Rodar todas ({pendingRunCount})</ToolbarButton>
            <ToolbarButton onClick={onRunChoiceCancel}>Cancelar</ToolbarButton>
          </div>
        </div>
      )}
    </FluentToolbar>
  );
}
