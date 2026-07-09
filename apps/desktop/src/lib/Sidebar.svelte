<script lang="ts">
  import { backend, type RelationInfo } from "./backend";
  import type { FunctionDef, IndexInfo, ObjectDefinitionKind } from "@omni-sql/ts-types";
  import DatabaseIcon from "@lucide/svelte/icons/database";
  import Table2 from "@lucide/svelte/icons/table-2";
  import Eye from "@lucide/svelte/icons/eye";
  import SquareFunction from "@lucide/svelte/icons/square-function";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Link2 from "@lucide/svelte/icons/link-2";
  import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
  import { SvelteSet, SvelteMap } from "svelte/reactivity";

  interface Props {
    relations: RelationInfo[];
    functions: FunctionDef[];
    loading: boolean;
    connectionId: string | null;
    onInsert?: (text: string) => void;
    onRefresh?: () => void;
    onOpenInNewTab?: (title: string, sql: string) => void;
  }
  let { relations, functions, loading, connectionId, onInsert, onRefresh, onOpenInNewTab }: Props = $props();

  interface SchemaGroup {
    name: string;
    tables: RelationInfo[];
    views: RelationInfo[];
    functions: FunctionDef[];
  }

  const groups = $derived.by(() => {
    const map = new Map<string, SchemaGroup>();
    function ensure(name: string): SchemaGroup {
      let g = map.get(name);
      if (!g) {
        g = { name, tables: [], views: [], functions: [] };
        map.set(name, g);
      }
      return g;
    }
    for (const r of relations) {
      const g = ensure(r.schema);
      (r.kind === "view" ? g.views : g.tables).push(r);
    }
    for (const f of functions) {
      ensure(f.schema).functions.push(f);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  function insertQualified(schema: string, name: string) {
    onInsert?.(`${schema}.${name}`);
  }

  const MIN_WIDTH = 160;
  const MAX_WIDTH = 640;
  const DEFAULT_WIDTH = 220;
  const WIDTH_KEY = "omni-sql:sidebarWidth";

  function loadWidth(): number {
    try {
      const raw = localStorage.getItem(WIDTH_KEY);
      const n = raw !== null ? Number(raw) : NaN;
      return Number.isFinite(n) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  }

  let width = $state(loadWidth());
  let resizing = $state(false);

  const expanded = new SvelteSet<string>();

  function relationKey(schema: string, name: string) {
    return `${schema}.${name}`;
  }

  function toggleExpand(schema: string, name: string, withIndexes: boolean) {
    const key = relationKey(schema, name);
    if (expanded.has(key)) {
      expanded.delete(key);
    } else {
      expanded.add(key);
      if (withIndexes) void ensureIndexes(schema, name);
    }
  }

  interface IndexState {
    loading: boolean;
    error: string | null;
    indexes: IndexInfo[];
  }
  const indexCache = new SvelteMap<string, IndexState>();

  async function ensureIndexes(schema: string, table: string) {
    const key = relationKey(schema, table);
    if (indexCache.has(key) || !connectionId) return;
    indexCache.set(key, { loading: true, error: null, indexes: [] });
    try {
      const { indexes } = await backend.call<{ indexes: IndexInfo[] }>("metadata.listIndexes", {
        connectionId,
        schema,
        table,
      });
      indexCache.set(key, { loading: false, error: null, indexes: [...indexes] });
    } catch (e) {
      indexCache.set(key, { loading: false, error: (e as Error).message, indexes: [] });
    }
  }

  async function openDefinition(kind: ObjectDefinitionKind, schema: string, name: string) {
    if (!connectionId) return;
    const title = `${kind === "table" ? "DDL" : "Def"}: ${name}`;
    try {
      const { sql } = await backend.call<{ sql: string }>("metadata.getDefinition", {
        connectionId,
        kind,
        schema,
        name,
      });
      onOpenInNewTab?.(title, sql);
    } catch (e) {
      onOpenInNewTab?.(title, `-- Falha ao obter definição de ${schema}.${name}\n-- ${(e as Error).message}`);
    }
  }

  interface MenuItem {
    label: string;
    action: () => void;
  }
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  function openMenu(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 28 - 16);
    menu = { x, y, items };
  }
  function closeMenu() {
    menu = null;
  }
  $effect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onResizeStart(e: PointerEvent) {
    e.preventDefault();
    resizing = true;
    const startX = e.clientX;
    const startWidth = width;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const next = startWidth + (ev.clientX - startX);
      width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    }
    function onUp(ev: PointerEvent) {
      resizing = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(WIDTH_KEY, String(width));
      } catch {
        // localStorage indisponível (modo privado, quota) — largura só não persiste entre sessões.
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
</script>

{#snippet columnsSection(columns: RelationInfo["columns"])}
  <div class="sub-header"><span>Colunas ({columns.length})</span></div>
  <ul class="columns">
    {#each columns as c (c.name)}
      <li
        class="column"
        title={`${c.name}: ${c.dataType}${c.nullable ? "" : " NOT NULL"}${c.foreignKeyTo ? ` — FK → ${c.foreignKeyTo.schema}.${c.foreignKeyTo.table}.${c.foreignKeyTo.column}` : ""}`}
      >
        {#if c.isPrimaryKey}
          <KeyRound size={10} class="pk" />
        {:else if c.foreignKeyTo}
          <Link2 size={10} class="fk" />
        {:else}
          <span class="col-dot"></span>
        {/if}
        <span class="col-name">{c.name}</span>
        <span class="col-type">{c.dataType}</span>
      </li>
    {:else}
      <li class="column-empty">Sem colunas carregadas</li>
    {/each}
  </ul>
{/snippet}

{#snippet indexesSection(schema: string, table: string)}
  {@const state = indexCache.get(relationKey(schema, table))}
  <div class="sub-header">
    <span>Índices{state && !state.loading && !state.error ? ` (${state.indexes.length})` : ""}</span>
  </div>
  {#if !state || state.loading}
    <p class="sub-hint">Carregando...</p>
  {:else if state.error}
    <p class="sub-hint error">{state.error}</p>
  {:else if state.indexes.length === 0}
    <p class="sub-hint">Nenhum índice.</p>
  {:else}
    <ul class="columns">
      {#each state.indexes as idx (idx.name)}
        <li class="column" title={`${idx.name}: ${idx.columns.join(", ")}`}>
          {#if idx.primary}
            <KeyRound size={10} class="pk" />
          {:else}
            <span class="col-dot"></span>
          {/if}
          <span class="col-name">{idx.name}</span>
          <span class="col-type">{idx.unique ? "UNIQUE " : ""}({idx.columns.join(", ")})</span>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<aside class="sidebar" style={`width: ${width}px`}>
  <div class="sidebar-header">
    <span>Objetos</span>
    <button
      class="icon"
      title="Atualizar objetos do banco"
      onclick={onRefresh}
      disabled={loading}
      aria-label="Atualizar"
    ><RefreshCw size={13} class={loading ? "spin" : undefined} /></button>
  </div>
  <div class="sidebar-body">
    {#if groups.length === 0}
      <p class="hint">{loading ? "Carregando..." : "Nenhum objeto disponível."}</p>
    {/if}
    {#if groups.length > 0}
      {#each groups as g (g.name)}
        <details class="schema-group" open={groups.length <= 2}>
          <summary class="schema"><DatabaseIcon size={13} /> <span class="label">{g.name}</span></summary>
          {#if g.tables.length > 0}
            <details>
              <summary class="kind">Tabelas ({g.tables.length})</summary>
              {#each g.tables as t (t.name)}
                {@const key = relationKey(g.name, t.name)}
                {@const isOpen = expanded.has(key)}
                <div
                  class="obj-row"
                  role="presentation"
                  oncontextmenu={(e) =>
                    openMenu(e, [
                      { label: "Inserir no editor", action: () => insertQualified(g.name, t.name) },
                      { label: "Gerar DDL em nova aba", action: () => void openDefinition("table", g.name, t.name) },
                    ])}
                >
                  <button
                    class="obj"
                    class:open={isOpen}
                    onclick={() => toggleExpand(g.name, t.name, true)}
                    title={`${g.name}.${t.name}`}
                  >
                    <ChevronRight size={10} class="chev" />
                    <Table2 size={12} class="obj-icon" />
                    <span class="obj-name">{t.name}</span>
                  </button>
                  <button
                    class="obj-action"
                    onclick={() => insertQualified(g.name, t.name)}
                    title={`Inserir ${g.name}.${t.name} no editor`}
                    aria-label={`Inserir ${g.name}.${t.name} no editor`}
                  ><CornerDownLeft size={11} /></button>
                </div>
                {#if isOpen}
                  {@render columnsSection(t.columns)}
                  {@render indexesSection(g.name, t.name)}
                {/if}
              {/each}
            </details>
          {/if}
          {#if g.views.length > 0}
            <details>
              <summary class="kind">Views ({g.views.length})</summary>
              {#each g.views as v (v.name)}
                {@const key = relationKey(g.name, v.name)}
                {@const isOpen = expanded.has(key)}
                <div
                  class="obj-row"
                  role="presentation"
                  oncontextmenu={(e) =>
                    openMenu(e, [
                      { label: "Inserir no editor", action: () => insertQualified(g.name, v.name) },
                      {
                        label: "Ver definição em nova aba",
                        action: () => void openDefinition("view", g.name, v.name),
                      },
                    ])}
                >
                  <button
                    class="obj"
                    class:open={isOpen}
                    onclick={() => toggleExpand(g.name, v.name, false)}
                    title={`${g.name}.${v.name}`}
                  >
                    <ChevronRight size={10} class="chev" />
                    <Eye size={12} class="obj-icon" />
                    <span class="obj-name">{v.name}</span>
                  </button>
                  <button
                    class="obj-action"
                    onclick={() => insertQualified(g.name, v.name)}
                    title={`Inserir ${g.name}.${v.name} no editor`}
                    aria-label={`Inserir ${g.name}.${v.name} no editor`}
                  ><CornerDownLeft size={11} /></button>
                </div>
                {#if isOpen}
                  {@render columnsSection(v.columns)}
                {/if}
              {/each}
            </details>
          {/if}
          {#if g.functions.length > 0}
            <details>
              <summary class="kind">Funções ({g.functions.length})</summary>
              {#each g.functions as f (f.name)}
                <div
                  class="obj-row"
                  role="presentation"
                  oncontextmenu={(e) =>
                    openMenu(e, [
                      { label: "Inserir no editor", action: () => insertQualified(g.name, f.name) },
                      {
                        label: "Ver definição em nova aba",
                        action: () => void openDefinition("function", g.name, f.name),
                      },
                    ])}
                >
                  <button class="obj" onclick={() => insertQualified(g.name, f.name)} title={`${g.name}.${f.name}`}>
                    <SquareFunction size={12} class="obj-icon" />
                    <span class="obj-name">{f.name}</span>
                  </button>
                </div>
              {/each}
            </details>
          {/if}
        </details>
      {/each}
    {/if}
  </div>
  <div
    class="resize-handle"
    class:resizing
    role="separator"
    aria-orientation="vertical"
    aria-label="Redimensionar painel de objetos"
    onpointerdown={onResizeStart}
  ></div>
  {#if menu}
    <div
      class="menu-overlay"
      role="presentation"
      onpointerdown={closeMenu}
      oncontextmenu={(e) => {
        e.preventDefault();
        closeMenu();
      }}
    ></div>
    <ul class="context-menu" style={`left:${menu.x}px; top:${menu.y}px`}>
      {#each menu.items as item}
        <li>
          <button
            onclick={() => {
              item.action();
              closeMenu();
            }}
          >{item.label}</button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #202020;
    border-right: 1px solid #333;
    font-size: 12px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid #2a2a2a;
    color: #aaa;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .sidebar-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 6px;
  }
  .hint {
    color: #777;
    font-size: 11px;
    padding: 8px 4px;
  }
  summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    border-radius: 3px;
    color: #ccc;
    list-style: none;
    min-width: 0;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: #2a2a2a; }
  summary .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  summary.kind {
    margin-left: 14px;
    font-size: 11px;
    color: #999;
  }
  .obj-row {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: 24px;
  }
  .obj {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 3px 4px;
    background: none;
    border: none;
    color: #ccc;
    font-size: 11px;
    text-align: left;
    border-radius: 3px;
    cursor: pointer;
  }
  .obj:hover { background: #2a2a2a; }
  .obj :global(.chev) {
    flex-shrink: 0;
    color: #777;
    transition: transform 0.1s ease;
  }
  .obj.open :global(.chev) { transform: rotate(90deg); }
  .obj :global(.obj-icon) { flex-shrink: 0; }
  .obj-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .obj-action {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: none;
    border: none;
    color: #777;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0;
  }
  .obj-row:hover .obj-action,
  .obj-action:focus-visible {
    opacity: 1;
  }
  .obj-action:hover {
    background: #333;
    color: #ddd;
  }
  .sub-header {
    display: flex;
    align-items: center;
    margin-left: 48px;
    padding: 3px 4px 2px;
    color: #888;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .sub-hint {
    margin: 0 0 2px 48px;
    padding: 2px 4px;
    color: #666;
    font-size: 10.5px;
    font-style: italic;
  }
  .sub-hint.error { color: #d97070; }
  .columns {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .column {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 48px;
    padding: 2px 4px;
    color: #999;
    font-size: 10.5px;
    min-width: 0;
  }
  .column :global(.pk) {
    flex-shrink: 0;
    color: #d4a72c;
  }
  .column :global(.fk) {
    flex-shrink: 0;
    color: #6ea8fe;
  }
  .col-dot {
    flex-shrink: 0;
    width: 10px;
    display: inline-block;
  }
  .col-name {
    flex-shrink: 0;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #bbb;
  }
  .col-type {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #6f6f6f;
  }
  .column-empty {
    margin-left: 48px;
    padding: 2px 4px;
    color: #666;
    font-size: 10.5px;
    font-style: italic;
  }
  button.icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    color: #aaa;
    border-radius: 3px;
    cursor: pointer;
  }
  button.icon:hover { background: #2a2a2a; }
  button.icon:disabled { opacity: 0.5; cursor: default; }
  :global(.spin) { animation: sidebar-spin 0.8s linear infinite; }
  @keyframes sidebar-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .resize-handle {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
  }
  .resize-handle:hover,
  .resize-handle.resizing {
    background: #3a7bd5;
    opacity: 0.5;
  }
  .menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
  }
  .context-menu {
    position: fixed;
    z-index: 101;
    list-style: none;
    margin: 0;
    padding: 4px;
    min-width: 190px;
    background: #262626;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  .context-menu li button {
    display: block;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    color: #ddd;
    font-size: 12px;
    text-align: left;
    border-radius: 4px;
    cursor: pointer;
  }
  .context-menu li button:hover { background: #3a7bd5; color: #fff; }
</style>
