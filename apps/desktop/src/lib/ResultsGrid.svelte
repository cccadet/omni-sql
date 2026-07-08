<script lang="ts">
  import type { QueryResult } from "@omni-sql/ts-types";
  import Hash from "@lucide/svelte/icons/hash";
  import CaseSensitive from "@lucide/svelte/icons/case-sensitive";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ToggleLeft from "@lucide/svelte/icons/toggle-left";
  import Braces from "@lucide/svelte/icons/braces";
  import Fingerprint from "@lucide/svelte/icons/fingerprint";
  import Binary from "@lucide/svelte/icons/binary";
  import CircleHelp from "@lucide/svelte/icons/circle-help";

  interface Props {
    result: QueryResult | null;
    error: string | null;
    running: boolean;
    onLoadMore?: () => void;
  }
  let { result, error, running, onLoadMore }: Props = $props();

  const MAX_CELL_CHARS = 200;

  let expanded = $state<{ column: string; text: string } | null>(null);

  function cellText(cell: unknown): string {
    if (cell === null) return "";
    if (typeof cell === "object") return JSON.stringify(cell);
    return String(cell);
  }

  function openExpanded(column: string, cell: unknown) {
    const text =
      cell !== null && typeof cell === "object" ? JSON.stringify(cell, null, 2) : cellText(cell);
    expanded = { column, text };
  }

  function closeExpanded() {
    expanded = null;
  }

  function typeIcon(dataType: string) {
    const t = dataType.toLowerCase();
    if (/^oid:|unknown/.test(t)) return CircleHelp;
    if (/uuid/.test(t)) return Fingerprint;
    if (/bool/.test(t)) return ToggleLeft;
    if (/json/.test(t)) return Braces;
    if (/bytea|blob|raw|binary/.test(t)) return Binary;
    if (/timestamp|^date|^time/.test(t)) return Calendar;
    if (/int|number|numeric|real|double|float|decimal/.test(t)) return Hash;
    return CaseSensitive;
  }

  function onOverlayKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeExpanded();
  }
</script>

<svelte:window onkeydown={onOverlayKeydown} />

<section class="results">
  <header class="results-header">
    <span>Resultados</span>
    {#if result}
      <span class="meta">
        {result.rows.length} linha(s) · {result.columns.length} coluna(s)
        · {result.elapsedMs}ms
      </span>
      {#if result.rowsMoreAvailable}
        <button
          class="load-more"
          disabled={running}
          onclick={() => onLoadMore?.()}
          title="Executa a consulta novamente com um limite maior de linhas"
        >
          Carregar mais linhas
        </button>
      {/if}
    {/if}
  </header>

  {#if error}
    <div class="error">{error}</div>
  {:else if running && !result}
    <div class="empty">Executando…</div>
  {:else if !result}
    <div class="empty">Pressione Ctrl/⌘+Enter para executar a query.</div>
  {:else}
    <div class="grid-scroll">
      <table>
        <thead>
          <tr>
            {#each result.columns as c}
              {@const TypeIcon = typeIcon(c.dataType)}
              <th
                >{c.name}<span class="type" title={c.dataType}
                  ><TypeIcon size={13} strokeWidth={2} /></span
                ></th
              >
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each result.rows as row}
            <tr>
              {#each row as cell, i}
                <td>
                  {#if cell === null}
                    <span class="null">NULL</span>
                  {:else}
                    {@const text = cellText(cell)}
                    {#if text.length > MAX_CELL_CHARS}
                      <span class="cell-truncated">{text.slice(0, MAX_CELL_CHARS)}…</span>
                      <button
                        class="expand"
                        title="Ver texto completo"
                        aria-label="Ver texto completo"
                        onclick={() => openExpanded(result.columns[i].name, cell)}
                      >⤢</button>
                    {:else}
                      {text}
                    {/if}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

{#if expanded}
  <div class="modal-overlay" onclick={closeExpanded} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <header class="modal-header">
        <span>{expanded.column}</span>
        <button class="modal-close" onclick={closeExpanded} aria-label="Fechar">✕</button>
      </header>
      <pre class="modal-body">{expanded.text}</pre>
    </div>
  </div>
{/if}

<style>
  .results {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #1e1e1e;
  }
  .results-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: #252526;
    border-bottom: 1px solid #333;
    font-size: 12px;
    color: #9cdcfe;
  }
  .meta { color: #888; font-family: ui-monospace, monospace; }
  .load-more {
    margin-left: auto;
    padding: 3px 10px;
    border: 1px solid #3c3c3c;
    border-radius: 4px;
    background: #2d2d30;
    color: #9cdcfe;
    cursor: pointer;
    font-size: 12px;
  }
  .load-more:hover:not(:disabled) { background: #37373d; }
  .load-more:disabled { opacity: 0.5; cursor: default; }
  .grid-scroll {
    overflow: auto;
    flex: 1;
    min-height: 0;
  }
  table {
    border-collapse: collapse;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    width: max-content;
  }
  th, td {
    padding: 4px 10px;
    border-bottom: 1px solid #2a2a2a;
    border-right: 1px solid #2a2a2a;
    white-space: nowrap;
    text-align: left;
  }
  th {
    background: #2d2d30;
    color: #ddd;
    font-weight: 600;
    position: sticky;
    top: 0;
  }
  .type {
    display: inline-flex;
    align-items: center;
    color: #6a9955;
    margin-left: 6px;
    vertical-align: middle;
  }
  td { color: #ccc; }
  .null { color: #569cd6; font-style: italic; }
  .empty { padding: 24px; color: #666; font-size: 13px; }
  .error { padding: 16px; color: #f48771; font-family: ui-monospace, monospace; }

  .cell-truncated { color: #ccc; }
  .expand {
    margin-left: 6px;
    padding: 0 4px;
    border: none;
    background: transparent;
    color: #9cdcfe;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    vertical-align: middle;
  }
  .expand:hover { color: #fff; }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    display: flex;
    flex-direction: column;
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 6px;
    width: min(800px, 90vw);
    max-height: 80vh;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #2d2d30;
    color: #ddd;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 1px solid #333;
    border-radius: 6px 6px 0 0;
  }
  .modal-close {
    border: none;
    background: transparent;
    color: #ccc;
    cursor: pointer;
    font-size: 13px;
    padding: 2px 6px;
  }
  .modal-close:hover { color: #fff; }
  .modal-body {
    margin: 0;
    padding: 12px;
    overflow: auto;
    color: #ccc;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
  }
</style>