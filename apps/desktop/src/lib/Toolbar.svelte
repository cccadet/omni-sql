<script lang="ts">
  import type { ConnectionEntry } from "./backend";
  import { dialectIcon } from "./dialect-icons";
  import SidecarStatus from "./SidecarStatus.svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Plus from "@lucide/svelte/icons/plus";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Play from "@lucide/svelte/icons/play";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Save from "@lucide/svelte/icons/save";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import History from "@lucide/svelte/icons/history";

  interface Props {
    connections: ConnectionEntry[];
    activeConnectionId: string | null;
    busyMsg: string | null;
    running: boolean;
    onRun?: () => void;
    onSelectConnection?: (id: string) => void;
    onAdd?: () => void;
    onEdit?: (id: string) => void;
    onRemove?: (id: string) => void;
    onRefreshMetadata?: (id: string) => void;
    limit: number;
    onLimitChange?: (limit: number) => void;
    onSave?: () => void;
    onOpen?: () => void;
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
    onSelectConnection,
    onAdd,
    onEdit,
    onRemove,
    onRefreshMetadata,
    limit,
    onLimitChange,
    onSave,
    onOpen,
    sidebarOpen = true,
    onToggleSidebar,
    historyOpen = false,
    onToggleHistory,
  }: Props = $props();

  const LIMIT_OPTIONS = [10, 100, 500, 1000, 5000, 10000];

  function formatMetaStatus(entry: ConnectionEntry | undefined): {
    icon: string;
    label: string;
  } {
    if (!entry) return { icon: "", label: "" };
    if (entry.lastSyncedAt) {
      const d = new Date(entry.lastSyncedAt);
      return {
        icon: "🟢",
        label: `Metadados sincronizados em ${d.toLocaleString()}`,
      };
    }
    return {
      icon: "⚪",
      label: "Metadados ainda não lidos — autocomplete de tabelas indisponível",
    };
  }

  function onRunClick(e: Event) {
    e.preventDefault();
    onRun?.();
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
        <span class="dialect-icon" aria-hidden="true">{dialectIcon(activeConnection.dialect)}</span>
        <span class="meta-status" title={metaStatus.label}>{metaStatus.icon}</span>
      {/if}
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
      <button
        class="run"
        title="Executar query (Ctrl/⌘+Enter)"
        onclick={onRunClick}
        disabled={running || !activeConnectionId}
      >
        {#if running}
          <Loader2 size={14} class="spin" /> Executando…
        {:else}
          <Play size={14} /> Executar
        {/if}
      </button>
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
    </div>
  </div>

  <div class="spacer"></div>

  {#if busyMsg}
    <span class="busy">{busyMsg}</span>
  {/if}

  <button
    class="icon toggle"
    class:active={sidebarOpen}
    title="Objetos do banco"
    aria-label="Alternar painel de objetos do banco"
    onclick={onToggleSidebar}
  ><PanelLeft size={15} /></button>

  <button
    class="icon toggle"
    class:active={historyOpen}
    title="Histórico de queries"
    aria-label="Alternar histórico de queries"
    onclick={onToggleHistory}
  ><History size={15} /></button>

  <SidecarStatus />
</header>

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
  }
  button.run {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  button.icon {
    padding: 6px 8px;
    background: #2d2d30;
    border: 1px solid #3c3c3c;
    line-height: 1;
    display: inline-flex;
    align-items: center;
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
  .dialect-icon {
    font-size: 14px;
    line-height: 1;
  }
  .meta-status {
    font-size: 12px;
    line-height: 1;
    cursor: default;
    opacity: 0.9;
  }
  :global(.spin) {
    animation: toolbar-spin 1s linear infinite;
  }
  @keyframes toolbar-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
