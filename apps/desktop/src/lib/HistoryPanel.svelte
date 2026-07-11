<script lang="ts" module>
  export interface HistoryEntry {
    id: string;
    sql: string;
    connectionId: string | null;
    connectionLabel: string;
    dialect: string | null;
    ranAt: number;
    ok: boolean;
    elapsedMs?: number;
    errorMessage?: string;
  }
</script>

<script lang="ts">
  import { dialectIcon } from "./dialect-icons";
  import type { ConnectionEntry } from "./backend";
  import X from "@lucide/svelte/icons/x";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  interface Props {
    open: boolean;
    entries: HistoryEntry[];
    onClose?: () => void;
    onSelect?: (entry: HistoryEntry) => void;
    onClear?: () => void;
  }
  let { open, entries, onClose, onSelect, onClear }: Props = $props();

  function fmtTime(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function onBackdropMouseDown(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose?.();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose?.();
  }
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
  <div class="backdrop" onmousedown={onBackdropMouseDown} role="dialog" aria-modal="true" tabindex="-1">
    <aside class="panel">
      <div class="panel-header">
        <span>Histórico de queries</span>
        <div class="panel-actions">
          <button class="icon" title="Limpar histórico" onclick={onClear} aria-label="Limpar histórico" disabled={entries.length === 0}><Trash2 size={13} /></button>
          <button class="icon" title="Fechar" onclick={onClose} aria-label="Fechar histórico"><X size={14} /></button>
        </div>
      </div>
      <div class="panel-body">
        {#if entries.length === 0}
          <p class="hint">Nenhuma query executada ainda.</p>
        {:else}
          {#each entries as entry (entry.id)}
            <button class="entry" onclick={() => onSelect?.(entry)}>
              <div class="entry-meta">
                {#if entry.dialect}
                  <span class="dialect-icon" aria-hidden="true">{dialectIcon(entry.dialect as ConnectionEntry["dialect"])}</span>
                {/if}
                <span class="conn">{entry.connectionLabel}</span>
                <span class="status" class:ok={entry.ok} class:err={!entry.ok}>{entry.ok ? "✓" : "✗"}</span>
                <span class="time">{fmtTime(entry.ranAt)}</span>
              </div>
              <div class="sql">{entry.sql.split("\n")[0]}</div>
            </button>
          {/each}
        {/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 50;
    display: flex;
    justify-content: flex-end;
  }
  .panel {
    width: 340px;
    max-width: 90vw;
    height: 100%;
    background: #252526;
    border-left: 1px solid #3c3c3c;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.4);
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid #333;
    font-size: 12px;
    color: #ccc;
  }
  .panel-actions {
    display: flex;
    gap: 4px;
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }
  .hint {
    color: #777;
    font-size: 12px;
    padding: 10px;
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    text-align: left;
    background: #2d2d30;
    border: 1px solid #3c3c3c;
    border-radius: 4px;
    padding: 6px 8px;
    margin-bottom: 6px;
    cursor: pointer;
    color: #ccc;
  }
  .entry:hover {
    background: #333;
  }
  .entry-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: #999;
  }
  .dialect-icon {
    font-size: 12px;
  }
  .conn {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status.ok {
    color: #89d185;
  }
  .status.err {
    color: #f48771;
  }
  .sql {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: #ddd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.icon {
    background: transparent;
    border: none;
    color: #aaa;
    cursor: pointer;
    padding: 3px;
    display: inline-flex;
  }
  button.icon:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
