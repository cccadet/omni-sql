<script lang="ts">
  import type { QueryResult } from "@omni-sql/ts-types";

  interface Props {
    result: QueryResult | null;
    error: string | null;
    running: boolean;
  }
  let { result, error, running }: Props = $props();
</script>

<section class="results">
  <header class="results-header">
    <span>Resultados</span>
    {#if result}
      <span class="meta">
        {result.rows.length} linha(s) · {result.columns.length} coluna(s)
        {#if result.rowsMoreAvailable} · mais linhas disponíveis{/if}
        · {result.elapsedMs}ms
      </span>
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
              <th>{c.name}<span class="type">{c.dataType}</span></th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each result.rows as row}
            <tr>
              {#each row as cell}
                <td>
                  {#if cell === null}
                    <span class="null">NULL</span>
                  {:else}
                    {String(cell)}
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

<style>
  .results {
    display: flex;
    flex-direction: column;
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
    color: #6a9955;
    margin-left: 6px;
    font-weight: 400;
    font-size: 11px;
  }
  td { color: #ccc; }
  .null { color: #569cd6; font-style: italic; }
  .empty { padding: 24px; color: #666; font-size: 13px; }
  .error { padding: 16px; color: #f48771; font-family: ui-monospace, monospace; }
</style>