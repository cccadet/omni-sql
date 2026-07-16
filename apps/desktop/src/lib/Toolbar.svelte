<script lang="ts">
  import type { ConnectionEntry } from "./backend";
  import DialectIcon from "./DialectIcon.svelte";
  import SidecarStatus from "./SidecarStatus.svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Plus from "@lucide/svelte/icons/plus";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Play from "@lucide/svelte/icons/play";
  import CircleStop from "@lucide/svelte/icons/circle-stop";
  import Save from "@lucide/svelte/icons/save";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import History from "@lucide/svelte/icons/history";
  import Settings from "@lucide/svelte/icons/settings";
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";

  interface Props {
    connections: ConnectionEntry[];
    activeConnectionId: string | null;
    busyMsg: string | null;
    running: boolean;
    onRun?: () => void;
    onCancelRun?: () => void;
    /** Não nulo quando há várias instruções na aba e nenhuma seleção — mostra o menu de escolha. */
    pendingRunCount?: number | null;
    onRunChoice?: (choice: "current" | "all") => void;
    onRunChoiceCancel?: () => void;
    onSelectConnection?: (id: string) => void;
    onAdd?: () => void;
    onEdit?: (id: string) => void;
    onRemove?: (id: string) => void;
    onRefreshMetadata?: (id: string) => void;
    limit: number;
    onLimitChange?: (limit: number) => void;
    onSave?: () => void;
    onOpen?: () => void;
    onOpenFormatSettings?: () => void;
    sidebarOpen?: boolean;
    onToggleSidebar?: () => void;
    historyOpen?: boolean;
    onToggleHistory?: () => void;
  }
  let {
    connections,
    activeConnectionId,
    busyMsg,
    running,
    onRun,
    onCancelRun,
    pendingRunCount = null,
    onRunChoice,
    onRunChoiceCancel,
    onSelectConnection,
    onAdd,
    onEdit,
    onRemove,
    onRefreshMetadata,
    limit,
    onLimitChange,
    onSave,
    onOpen,
    onOpenFormatSettings,
    sidebarOpen = true,
    onToggleSidebar,
    historyOpen = false,
    onToggleHistory,
  }: Props = $props();

  const LIMIT_OPTIONS = [10, 100, 500, 1000, 5000, 10000];

  function formatMetaStatus(entry: ConnectionEntry | undefined): {
    synced: boolean;
    label: string;
  } {
    if (!entry) return { synced: false, label: "" };
    if (entry.lastSyncedAt) {
      const d = new Date(entry.lastSyncedAt);
      return {
        synced: true,
        label: `Metadados sincronizados em ${d.toLocaleString()}`,
      };
    }
    return {
      synced: false,
      label: "Metadados ainda não lidos — autocomplete de tabelas indisponível",
    };
  }

  function onRunClick(e: Event) {
    e.preventDefault();
    onRun?.();
  }
  function onRunMenuKeydown(e: KeyboardEvent) {
    if (pendingRunCount && e.key === "Escape") {
      e.preventDefault();
      onRunChoiceCancel?.();
    }
  }
  /** Foca "Rodar instrução atual" ao abrir o modal — um Enter já confirma. */
  function autofocusButton(node: HTMLButtonElement) {
    node.focus();
  }
  function onSelect(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    onSelectConnection?.(v);
  }
  function onEditClick(e: Event) {
    e.preventDefault();
    if (activeConnectionId) onEdit?.(activeConnectionId);
  }
  function onRemoveClick(e: Event) {
    e.preventDefault();
    if (activeConnectionId && confirm("Remover conexão selecionada?")) {
      onRemove?.(activeConnectionId);
    }
  }
  function onRefreshMetadataClick(e: Event) {
    e.preventDefault();
    if (activeConnectionId) onRefreshMetadata?.(activeConnectionId);
  }

  const activeConnection = $derived(
    connections.find((c) => c.id === activeConnectionId),
  );
  const metaStatus = $derived(formatMetaStatus(activeConnection));
</script>

<svelte:window onkeydown={onRunMenuKeydown} />

<header class="toolbar">
  <div class="group">
    <span class="group-label">Conexão</span>
    <div class="group-controls">
      <select aria-label="Conexão ativa" value={activeConnectionId ?? ""} onchange={onSelect}>
        {#if connections.length === 0}
          <option value="" disabled>Nenhuma conexão cadastrada</option>
        {/if}
        {#each connections as c}
          <option value={c.id}>{c.label}</option>
        {/each}
      </select>
      {#if activeConnection}
        <DialectIcon dialect={activeConnection.dialect} size={14} />
        <span class="meta-status" title={metaStatus.label}>
          {#if metaStatus.synced}
            <CheckCircle2 size={13} class="meta-synced" />
          {:else}
            <CircleDashed size={13} class="meta-pending" />
          {/if}
        </span>
      {/if}
      <button
        class="icon toggle"
        class:active={sidebarOpen}
        title="Objetos do banco"
        aria-label="Alternar painel de objetos do banco"
        onclick={onToggleSidebar}
      ><PanelLeft size={15} /></button>
    </div>
  </div>

  <div class="divider"></div>

  <div class="group">
    <span class="group-label">Fonte</span>
    <div class="group-controls">
      <button
        class="icon"
        title="Atualizar metadados (tabelas/colunas)"
        onclick={onRefreshMetadataClick}
        disabled={!activeConnectionId || !!busyMsg}
        aria-label="Atualizar metadados"
      ><RefreshCw size={14} /></button>
      <button class="icon" title="Nova conexão" onclick={onAdd} aria-label="Nova conexão"><Plus size={14} /></button>
      <button class="icon" title="Editar conexão" onclick={onEditClick} disabled={!activeConnectionId} aria-label="Editar conexão"><Pencil size={14} /></button>
      <button class="icon danger" title="Remover conexão" onclick={onRemoveClick} disabled={!activeConnectionId} aria-label="Remover conexão"><Trash2 size={14} /></button>
    </div>
  </div>

  <div class="divider"></div>

  <div class="group">
    <span class="group-label">Execução</span>
    <div class="group-controls">
      {#if running}
        <button class="run cancel" title="Cancelar execução" onclick={onCancelRun}>
          <CircleStop size={14} /> Cancelar
        </button>
      {:else}
        <button
          class="run"
          title="Executar query (Ctrl/⌘+Enter)"
          onclick={onRunClick}
          disabled={!activeConnectionId}
        >
          <Play size={14} /> Executar
        </button>
      {/if}
    </div>
  </div>

  <div class="divider"></div>

  <div class="group">
    <span class="group-label">Limite</span>
    <div class="group-controls">
      <select
        class="limit-select"
        title="Limite de linhas"
        aria-label="Limite de linhas"
        value={limit}
        onchange={(e) => onLimitChange?.(Number(e.currentTarget.value))}
      >
        {#each LIMIT_OPTIONS as opt}
          <option value={opt}>{opt} linhas</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="divider"></div>

  <div class="group">
    <span class="group-label">Editor</span>
    <div class="group-controls">
      <button class="icon labeled" title="Salvar aba (.sql) — Ctrl/⌘+S" onclick={onSave} aria-label="Salvar aba"><Save size={14} /> Salvar</button>
      <button class="icon labeled" title="Abrir arquivo .sql — Ctrl/⌘+O" onclick={onOpen} aria-label="Abrir arquivo"><FolderOpen size={14} /> Abrir</button>
      <button class="icon" title="Configurar formatador SQL" onclick={onOpenFormatSettings} aria-label="Configurar formatador SQL"><Settings size={14} /></button>
    </div>
  </div>

  <div class="spacer"></div>

  {#if busyMsg}
    <span class="busy">{busyMsg}</span>
  {/if}

  <button
    class="icon toggle"
    class:active={historyOpen}
    title="Histórico de queries"
    aria-label="Alternar histórico de queries"
    onclick={onToggleHistory}
  ><History size={15} /></button>

  <SidecarStatus />
</header>

{#if pendingRunCount}
  <div class="run-menu-backdrop" onclick={() => onRunChoiceCancel?.()} role="presentation">
    <div
      class="run-menu"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Escape") {
          onRunChoiceCancel?.();
        }
      }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <header class="run-menu-header">Esta aba tem várias instruções</header>
      <div class="run-menu-body">
        <button
          type="button"
          class="run-menu-option primary"
          use:autofocusButton
          onclick={() => onRunChoice?.("current")}
        >
          Rodar instrução atual
        </button>
        <button type="button" class="run-menu-option" onclick={() => onRunChoice?.("all")}>
          Rodar todas ({pendingRunCount})
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding: 6px 12px;
    background: #252526;
    border-bottom: 1px solid #333;
    font-size: 12px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .group:has(.run) {
    margin-left: 6px;
  }
  .group-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #888;
    padding-left: 1px;
  }
  .group-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .divider {
    align-self: stretch;
    width: 1px;
    background: #3c3c3c;
    margin-bottom: 2px;
  }
  select {
    background-color: #2d2d30;
    color: #ddd;
    border: 1px solid #3c3c3c;
    padding: 4px 24px 4px 8px;
    border-radius: 4px;
    min-width: 200px;
    /* No Windows o <select> nativo desenha via UxTheme (GDI monocromático) e
       ignora até font-family para emoji — appearance:none devolve o
       desenho do texto ao próprio Chromium (aí sim com glifo colorido). A
       seta precisa ser recriada manualmente pois some junto com o chrome nativo. */
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0L5 6L10 0Z' fill='%23ddd'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
  }
  select.limit-select {
    min-width: unset;
    width: auto;
  }
  button {
    background: #0e639c;
    color: #fff;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    transition: background-color 0.1s ease, transform 0.05s ease;
  }
  button.run {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
  }
  button.run.cancel {
    background: #a1260d;
  }
  button.run.cancel:hover {
    background: #c42b0f;
  }
  .run-menu-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .run-menu {
    display: flex;
    flex-direction: column;
    width: min(340px, 90vw);
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .run-menu-header {
    padding: 10px 14px;
    background: #2d2d30;
    border-bottom: 1px solid #333;
    font-size: 13px;
    font-weight: 600;
    color: #ddd;
  }
  .run-menu-body {
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 4px;
  }
  .run-menu-option {
    background: transparent;
    color: #ddd;
    font-weight: 400;
    text-align: left;
    border-radius: 4px;
    padding: 10px 12px;
  }
  .run-menu-option:hover {
    background: #094771;
  }
  .run-menu-option.primary {
    background: #0e639c;
    color: #fff;
    font-weight: 600;
  }
  .run-menu-option.primary:hover {
    background: #1177bb;
  }
  button.icon {
    padding: 6px 8px;
    background: #2d2d30;
    border: 1px solid #3c3c3c;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    transition: background-color 0.1s ease, border-color 0.1s ease;
  }
  button.icon.labeled {
    gap: 5px;
    font-weight: 400;
  }
  button.icon.toggle.active {
    background: #0e639c;
    border-color: #0e639c;
  }
  button.danger {
    color: #f48771;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .spacer { flex: 1; }
  .busy { color: #9cdcfe; }
  .meta-status {
    display: inline-flex;
    align-items: center;
    cursor: default;
  }
  .meta-status :global(.meta-synced) {
    color: #89d185;
  }
  .meta-status :global(.meta-pending) {
    color: #666;
  }
  :global(.spin) {
    animation: toolbar-spin 1s linear infinite;
  }
  @keyframes toolbar-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
