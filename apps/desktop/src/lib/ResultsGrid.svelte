<script lang="ts">
  import type { QueryResult, RowEditability } from "@omni-sql/ts-types";
  import { typeIcon } from "./type-icons.svelte";
  import Check from "@lucide/svelte/icons/check";
  import X from "@lucide/svelte/icons/x";

  interface Props {
    result: QueryResult | null;
    error: string | null;
    running: boolean;
    /** Null quando não analisado ainda, ou quando a query não é editável. */
    editability?: RowEditability | null;
    onLoadMore?: () => void;
    /** Grava uma célula via `row.update`. Deve lançar em caso de falha. */
    onCellEdit?: (edit: { set: Record<string, unknown>; where: Record<string, unknown> }) => Promise<void>;
  }
  let { result, error, running, editability = null, onLoadMore, onCellEdit }: Props = $props();

  const MAX_CELL_CHARS = 200;

  let expanded = $state<{ column: string; text: string } | null>(null);

  // ─────────────────────────── Sort + seleção de linha (Fase 2)

  type SortDirection = "asc" | "desc" | null;
  let sortColumn = $state<string | null>(null);
  let sortDirection = $state<SortDirection>(null);
  let selectedRowIndex = $state<number | null>(null);

  // Reset sort/seleção quando muda a query.
  $effect(() => {
    result;
    sortColumn = null;
    sortDirection = null;
    selectedRowIndex = null;
  });

  const displayRows = $derived.by((): { row: unknown[]; originalIndex: number }[] => {
    if (!result) return [];
    const indexed = result.rows.map((row, originalIndex) => ({ row, originalIndex }));
    if (!sortColumn || !sortDirection) return indexed;
    const colIndex = result.columns.findIndex((c) => c.name === sortColumn);
    if (colIndex < 0) return indexed;
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return [...indexed].sort((a, b) => {
      const av = a.row[colIndex];
      const bv = b.row[colIndex];
      // NULLs sempre por último, independente da direção.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return 1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * multiplier;
      }
      if (typeof av === "bigint" && typeof bv === "bigint") {
        return Number(av - bv) * multiplier;
      }
      if (av instanceof Date && bv instanceof Date) {
        return (av.getTime() - bv.getTime()) * multiplier;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * multiplier;
    });
  });

  function toggleSort(column: string) {
    if (sortColumn !== column) {
      sortColumn = column;
      sortDirection = "asc";
    } else if (sortDirection === "asc") {
      sortDirection = "desc";
    } else {
      sortColumn = null;
      sortDirection = null;
    }
  }

  function selectRow(index: number | null) {
    selectedRowIndex = index;
  }

  function onGridKeydown(e: KeyboardEvent) {
    if (selectedRowIndex === null) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectRow(Math.min(selectedRowIndex + 1, displayRows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectRow(Math.max(selectedRowIndex - 1, 0));
    }
  }

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

  function onOverlayKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") closeExpanded();
  }

  // ─────────────────────────── Edição inline (duplo clique)

  // Índice, em `result.columns`, de cada coluna de PK — `null` se a query
  // não é editável OU se alguma coluna de PK não veio no resultset (sem
  // isso não dá pra montar o WHERE, então a linha inteira fica read-only).
  const pkColumnIndexes = $derived.by((): number[] | null => {
    if (!editability?.editable || !result) return null;
    const idx: number[] = [];
    for (const pk of editability.pkColumns) {
      const i = result.columns.findIndex((c) => c.name === pk);
      if (i < 0) return null;
      idx.push(i);
    }
    return idx;
  });

  function sourceColumnFor(colIndex: number): string | null {
    if (!editability?.editable || !result) return null;
    if (editability.selectStar) return result.columns[colIndex]?.name ?? null;
    return editability.columns[colIndex]?.sourceColumn ?? null;
  }

  function isCellEditable(colIndex: number): boolean {
    return pkColumnIndexes !== null && sourceColumnFor(colIndex) !== null;
  }

  let editingCell = $state<{ row: number; col: number } | null>(null);
  let editValue = $state("");
  let savingCell = $state<{ row: number; col: number } | null>(null);
  let cellError = $state<{ row: number; col: number; message: string } | null>(null);

  // Nova query (novo `result`) invalida qualquer edição/erro pendente da
  // anterior — não usa deep-watch, só a troca de referência de `result`.
  $effect(() => {
    result;
    editingCell = null;
    savingCell = null;
    cellError = null;
  });

  function isEditing(row: number, col: number): boolean {
    return editingCell?.row === row && editingCell?.col === col;
  }
  function isSaving(row: number, col: number): boolean {
    return savingCell?.row === row && savingCell?.col === col;
  }
  function errorFor(row: number, col: number): string | null {
    return cellError?.row === row && cellError?.col === col ? cellError.message : null;
  }

  function startEdit(rowIndex: number, colIndex: number, cell: unknown) {
    if (!isCellEditable(colIndex) || isSaving(rowIndex, colIndex)) return;
    cellError = null;
    editingCell = { row: rowIndex, col: colIndex };
    editValue = cell === null ? "" : cellText(cell);
  }

  function cancelEdit() {
    editingCell = null;
  }

  function onEditKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  // Célula em branco vira `NULL` — simplificação deliberada (não dá pra
  // distinguir "string vazia" de NULL num `<input>` de texto simples).
  async function commitEdit() {
    if (!editingCell || !result || !pkColumnIndexes || !editability) {
      editingCell = null;
      return;
    }
    const { row: rowIndex, col: colIndex } = editingCell;
    const sourceColumn = sourceColumnFor(colIndex);
    const row = result.rows[rowIndex];
    if (!sourceColumn || !row) {
      editingCell = null;
      return;
    }
    const previous = row[colIndex];
    const originalText = previous === null ? "" : cellText(previous);
    editingCell = null;
    if (editValue === originalText) return; // sem mudança visível

    const nextValue: unknown = editValue === "" ? null : editValue;
    const where: Record<string, unknown> = {};
    editability.pkColumns.forEach((pk, i) => {
      where[pk] = row[pkColumnIndexes[i]!];
    });

    savingCell = { row: rowIndex, col: colIndex };
    try {
      await onCellEdit?.({ set: { [sourceColumn]: nextValue }, where });
      row[colIndex] = nextValue;
    } catch (e) {
      cellError = { row: rowIndex, col: colIndex, message: (e as Error).message };
    } finally {
      savingCell = null;
    }
  }

  function autofocus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<svelte:window onkeydown={onOverlayKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="results" tabindex="-1" aria-label="Resultados da consulta" onkeydown={onGridKeydown}>
  <header class="results-header">
    <span>Resultados</span>
    {#if result}
      <span class="meta">
        {result.rows.length} linha(s) · {result.columns.length} coluna(s)
        · {result.elapsedMs}ms
      </span>
      {#if editability?.editable}
        <span class="meta editable-badge" title="Duplo clique numa célula para editar">
          editável ({editability.table?.schema}.{editability.table?.name})
        </span>
      {/if}
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
              {@const active = sortColumn === c.name}
              {@const dir = active ? sortDirection : null}
              <th
                class:sorted={active}
                class:sort-asc={dir === "asc"}
                class:sort-desc={dir === "desc"}
                onclick={() => toggleSort(c.name)}
                title={active ? `Ordenado ${dir === "asc" ? "crescente" : "decrescente"} (clique para limpar)` : "Ordenar"}
              >
                <span class="th-content">
                  {c.name}
                  <span class="type" title={c.dataType}
                    ><TypeIcon size={13} strokeWidth={2} /></span
                  >
                  {#if dir}
                    <span class="sort-indicator" aria-hidden="true">{dir === "asc" ? "▲" : "▼"}</span>
                  {/if}
                </span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each displayRows as { row, originalIndex }, rowIndex}
            <tr
              class:selected={selectedRowIndex === rowIndex}
              onclick={() => selectRow(rowIndex)}
            >
              {#each row as cell, i}
                <td
                  class:editable={isCellEditable(i)}
                  class:cell-error={errorFor(originalIndex, i) !== null}
                  title={errorFor(originalIndex, i) ?? undefined}
                  ondblclick={() => startEdit(originalIndex, i, cell)}
                >
                  {#if isEditing(originalIndex, i)}
                    <div class="cell-edit">
                      <input
                        class="cell-input"
                        bind:value={editValue}
                        onkeydown={onEditKeydown}
                        onblur={cancelEdit}
                        use:autofocus
                      />
                      <button
                        class="cell-confirm"
                        title="Confirmar (Enter)"
                        aria-label="Confirmar"
                        onmousedown={(e) => e.preventDefault()}
                        onclick={commitEdit}
                      ><Check size={13} strokeWidth={2.5} /></button>
                      <button
                        class="cell-cancel"
                        title="Cancelar (Esc)"
                        aria-label="Cancelar"
                        onmousedown={(e) => e.preventDefault()}
                        onclick={cancelEdit}
                      ><X size={13} strokeWidth={2.5} /></button>
                    </div>
                  {:else if isSaving(originalIndex, i)}
                    <span class="cell-saving">{cellText(cell)}</span>
                  {:else if cell === null}
                    <span class="null">NULL</span>
                  {:else}
                    {@const text = cellText(cell)}
                    {#if text.length > MAX_CELL_CHARS}
                      <span class="cell-truncated">{text.slice(0, MAX_CELL_CHARS)}…</span>
                      <button
                        class="expand"
                        title="Ver texto completo"
                        aria-label="Ver texto completo"
                        onclick={() => openExpanded(result.columns[i]?.name ?? "", cell)}
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
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Escape") {
          closeExpanded();
        }
      }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
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
  .editable-badge { color: #6a9955; }
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
    cursor: pointer;
    user-select: none;
  }
  th:hover { background: #37373d; }
  th.sorted { background: #3c3c42; }
  th.sorted:hover { background: #45454c; }
  .th-content {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .sort-indicator {
    color: #9cdcfe;
    font-size: 10px;
    margin-left: 2px;
  }
  .type {
    display: inline-flex;
    align-items: center;
    color: #6a9955;
    margin-left: 6px;
    vertical-align: middle;
  }
  td { color: #ccc; }
  tbody tr { cursor: pointer; }
  tbody tr:hover td { background: rgba(255, 255, 255, 0.04); }
  tbody tr.selected td { background: rgba(0, 122, 204, 0.18); }
  tbody tr.selected:hover td { background: rgba(0, 122, 204, 0.25); }
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

  td.editable { cursor: text; }
  td.editable:hover { background: rgba(255, 255, 255, 0.05); }
  td.cell-error { outline: 1px solid #f48771; outline-offset: -1px; }
  .cell-saving { opacity: 0.5; font-style: italic; }
  .cell-edit {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: -1px;
  }
  .cell-input {
    flex: 1;
    min-width: 60px;
    box-sizing: border-box;
    padding: 0;
    border: 1px solid #007acc;
    border-radius: 2px;
    background: #1e1e1e;
    color: #ccc;
    font: inherit;
    outline: none;
  }
  .cell-confirm, .cell-cancel {
    flex: none;
    display: inline-flex;
    align-items: center;
    padding: 2px;
    border: 1px solid #3c3c3c;
    border-radius: 2px;
    background: #2d2d30;
    cursor: pointer;
  }
  .cell-confirm { color: #6a9955; }
  .cell-confirm:hover { background: #2d3d2d; }
  .cell-cancel { color: #f48771; }
  .cell-cancel:hover { background: #3d2d2d; }

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
