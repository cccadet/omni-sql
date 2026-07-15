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
  import DialectIcon from "./DialectIcon.svelte";
  import X from "@lucide/svelte/icons/x";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Search from "@lucide/svelte/icons/search";
  import Check from "@lucide/svelte/icons/check";

  interface Props {
    open: boolean;
    entries: HistoryEntry[];
    onClose?: () => void;
    onSelect?: (entry: HistoryEntry) => void;
    onClear?: () => void;
  }
  let { open, entries, onClose, onSelect, onClear }: Props = $props();

  let searchText = $state("");
  let statusFilter = $state<"all" | "ok" | "err">("all");
  let connectionFilter = $state<string>("__all__");
  let searchInput = $state<HTMLInputElement | null>(null);

  const uniqueConnections = $derived.by(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      const key = e.connectionId ?? e.connectionLabel;
      if (!map.has(key)) {
        map.set(key, e.connectionLabel);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });

  const normalizedSearch = $derived(searchText.trim().toLowerCase());

  const filteredEntries = $derived.by(() => {
    return entries.filter((e) => {
      if (statusFilter === "ok" && !e.ok) return false;
      if (statusFilter === "err" && e.ok) return false;
      if (connectionFilter !== "__all__") {
        const key = e.connectionId ?? e.connectionLabel;
        if (key !== connectionFilter) return false;
      }
      if (normalizedSearch) {
        const haystack = `${e.sql}\n${e.connectionLabel}\n${e.dialect ?? ""}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });
  });

  function fmtTime(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function onBackdropMouseDown(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose?.();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose?.();
  }

  function highlightSql(sql: string, query: string): { text: string; mark: boolean }[] {
    const line = sql.split("\n")[0] ?? "";
    if (!query) return [{ text: line, mark: false }];
    const q = query.toLowerCase();
    const segments: { text: string; mark: boolean }[] = [];
    let remaining = line;
    while (remaining.length > 0) {
      const idx = remaining.toLowerCase().indexOf(q);
      if (idx < 0) {
        segments.push({ text: remaining, mark: false });
        break;
      }
      if (idx > 0) segments.push({ text: remaining.slice(0, idx), mark: false });
      segments.push({ text: remaining.slice(idx, idx + q.length), mark: true });
      remaining = remaining.slice(idx + q.length);
    }
    return segments;
  }

  function resetFilters() {
    searchText = "";
    statusFilter = "all";
    connectionFilter = "__all__";
    searchInput?.focus();
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

      <div class="filters">
        <div class="search-wrapper">
          <Search size={12} class="search-icon" />
          <input
            type="text"
            class="search-input"
            placeholder="Buscar no histórico..."
            bind:value={searchText}
            bind:this={searchInput}
          />
          {#if searchText}
            <button class="search-clear" onclick={() => { searchText = ""; searchInput?.focus(); }} aria-label="Limpar busca">
              <X size={11} />
            </button>
          {/if}
        </div>

        <div class="filter-row">
          <select class="filter-select" bind:value={connectionFilter} aria-label="Filtrar por conexão">
            <option value="__all__">Todas as conexões</option>
            {#each uniqueConnections as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>

          <div class="status-chips" role="group" aria-label="Filtrar por status">
            <button class="chip" class:active={statusFilter === "all"} onclick={() => (statusFilter = "all")}>Todas</button>
            <button class="chip" class:active={statusFilter === "ok"} onclick={() => (statusFilter = "ok")}><Check size={10} /> Sucesso</button>
            <button class="chip err" class:active={statusFilter === "err"} onclick={() => (statusFilter = "err")}><X size={10} /> Erro</button>
          </div>
        </div>
      </div>

      <div class="panel-body">
        <div class="result-count">{filteredEntries.length} resultado(s)</div>
        {#if filteredEntries.length === 0}
          <p class="hint">
            {#if entries.length === 0}
              Nenhuma query executada ainda.
            {:else}
              Nenhuma entrada corresponde aos filtros.
              <button class="link" onclick={resetFilters}>Limpar filtros</button>
            {/if}
          </p>
        {:else}
          {#each filteredEntries as entry (entry.id)}
            <button class="entry" onclick={() => onSelect?.(entry)}>
              <div class="entry-meta">
                {#if entry.dialect}
                  <DialectIcon dialect={entry.dialect} size={12} />
                {/if}
                <span class="conn">{entry.connectionLabel}</span>
                <span class="status" class:ok={entry.ok} class:err={!entry.ok}>{entry.ok ? "✓" : "✗"}</span>
                <span class="time">{fmtTime(entry.ranAt)}</span>
              </div>
              <div class="sql">
                {#each highlightSql(entry.sql, normalizedSearch) as segment, idx (idx)}
                  {#if segment.mark}
                    <mark>{segment.text}</mark>
                  {:else}
                    {segment.text}
                  {/if}
                {/each}
              </div>
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
    width: 380px;
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
  .filters {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border-bottom: 1px solid #2a2a2a;
    flex-shrink: 0;
  }
  .search-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }
  .search-wrapper :global(.search-icon) {
    position: absolute;
    left: 8px;
    color: #666;
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    padding: 5px 24px 5px 24px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #ccc;
    font-size: 11px;
    outline: none;
  }
  .search-input::placeholder { color: #666; }
  .search-input:focus { border-color: #007acc; }
  .search-clear {
    position: absolute;
    right: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    border-radius: 3px;
  }
  .search-clear:hover { background: #3a3a3a; color: #ccc; }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .filter-select {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #ccc;
    font-size: 11px;
    outline: none;
  }
  .filter-select:focus { border-color: #007acc; }
  .status-chips {
    display: flex;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 3px 7px;
    background: #333;
    border: 1px solid #444;
    border-radius: 12px;
    color: #aaa;
    font-size: 10px;
    cursor: pointer;
  }
  .chip:hover { background: #3a3a3a; }
  .chip.active {
    background: #007acc;
    border-color: #007acc;
    color: #fff;
  }
  .chip.err.active {
    background: #c75450;
    border-color: #c75450;
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }
  .result-count {
    color: #888;
    font-size: 10px;
    padding: 2px 4px 6px;
  }
  .hint {
    color: #777;
    font-size: 12px;
    padding: 10px;
  }
  .link {
    background: none;
    border: none;
    color: #4fc1ff;
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
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
  .sql mark {
    background: #264f78;
    color: #fff;
    border-radius: 2px;
    padding: 0 1px;
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
