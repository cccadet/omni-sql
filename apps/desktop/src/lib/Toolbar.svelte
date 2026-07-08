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
  }: Props = $props();

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
</script>

<header class="toolbar">
  <select aria-label="Conexão ativa" value={activeConnectionId ?? ""} onchange={onSelect}>
    {#each connections as c}
      <option value={c.id}>{c.label} — {c.dialect}</option>
    {/each}
  </select>

  <button class="icon" title="Nova conexão" onclick={onAdd} aria-label="Nova conexão">+</button>
  <button class="icon" title="Editar conexão" onclick={onEditClick} disabled={!activeConnectionId} aria-label="Editar conexão">✎</button>
  <button class="icon danger" title="Remover conexão" onclick={onRemoveClick} disabled={!activeConnectionId} aria-label="Remover conexão">−</button>

  <button onclick={onRunClick} disabled={running || !activeConnectionId}>
    {running ? "Executando…" : "Executar"}
  </button>

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
</style>
