<script lang="ts">
  import type { ConnectionEntry } from "./backend";

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
    fontFamily: string;
    onFontChange?: (fontFamily: string) => void;
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
    fontFamily,
    onFontChange,
  }: Props = $props();

  const LIMIT_OPTIONS = [10, 100, 500, 1000, 5000, 10000];

  const FONT_OPTIONS: Array<{ label: string; value: string }> = [
    { label: "Padrão", value: "ui-monospace, monospace" },
    { label: "Cascadia Code", value: "'Cascadia Code', ui-monospace, monospace" },
    { label: "Fira Code", value: "'Fira Code', ui-monospace, monospace" },
    { label: "JetBrains Mono", value: "'JetBrains Mono', ui-monospace, monospace" },
    { label: "Consolas", value: "Consolas, ui-monospace, monospace" },
    { label: "Menlo", value: "Menlo, ui-monospace, monospace" },
    { label: "Courier New", value: "'Courier New', monospace" },
  ];

  const DIALECT_ICONS: Record<ConnectionEntry["dialect"], string> = {
    postgres: "🐘",
    mysql: "🐬",
    mariadb: "🦭",
    sqlserver: "🗄️",
    oracle: "🟠",
    "jdbc-generic": "🔌",
    odbc: "🔗",
  };

  function dialectIcon(dialect: ConnectionEntry["dialect"]): string {
    return DIALECT_ICONS[dialect] ?? "🗄️";
  }

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
  <select aria-label="Conexão ativa" value={activeConnectionId ?? ""} onchange={onSelect}>
    {#if connections.length === 0}
      <option value="" disabled>Nenhuma conexão cadastrada</option>
    {/if}
    {#each connections as c}
      <option value={c.id}>{dialectIcon(c.dialect)} {c.label}</option>
    {/each}
  </select>

  {#if activeConnection}
    <span class="meta-status" title={metaStatus.label}>{metaStatus.icon}</span>
    <button
      class="icon"
      title="Atualizar metadados (tabelas/colunas)"
      onclick={onRefreshMetadataClick}
      disabled={!activeConnectionId || !!busyMsg}
      aria-label="Atualizar metadados"
    >⟳</button>
  {/if}

  <button class="icon" title="Nova conexão" onclick={onAdd} aria-label="Nova conexão">+</button>
  <button class="icon" title="Editar conexão" onclick={onEditClick} disabled={!activeConnectionId} aria-label="Editar conexão">✎</button>
  <button class="icon danger" title="Remover conexão" onclick={onRemoveClick} disabled={!activeConnectionId} aria-label="Remover conexão">−</button>

  <button onclick={onRunClick} disabled={running || !activeConnectionId}>
    {running ? "Executando…" : "Executar"}
  </button>

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

  <select
    class="font-select"
    title="Fonte do editor (por aba)"
    aria-label="Fonte do editor"
    value={fontFamily}
    onchange={(e) => onFontChange?.(e.currentTarget.value)}
  >
    {#each FONT_OPTIONS as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>

  <kbd>Ctrl/⌘+Enter</kbd>

  {#if busyMsg}
    <span class="busy">{busyMsg}</span>
  {/if}
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: #252526;
    border-bottom: 1px solid #333;
    font-size: 12px;
  }
  select {
    background: #2d2d30;
    color: #ddd;
    border: 1px solid #3c3c3c;
    padding: 4px 8px;
    border-radius: 4px;
    min-width: 220px;
  }
  select.limit-select {
    min-width: unset;
    width: auto;
  }
  select.font-select {
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
  button.icon {
    padding: 6px 10px;
    background: #2d2d30;
    border: 1px solid #3c3c3c;
    font-size: 14px;
    line-height: 1;
  }
  button.danger {
    color: #f48771;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  kbd {
    background: #2d2d30;
    border: 1px solid #3c3c3c;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    opacity: 0.7;
  }
  .busy { color: #9cdcfe; margin-left: auto; }
  .meta-status {
    font-size: 12px;
    line-height: 1;
    cursor: default;
    opacity: 0.9;
  }
</style>
