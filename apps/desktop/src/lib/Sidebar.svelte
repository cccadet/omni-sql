<script lang="ts">
  import { backend, type RelationInfo, type ConnectionEntry } from "./backend";
  import type { FunctionDef, IndexInfo, ObjectDefinitionKind } from "@omni-sql/ts-types";
  import { typeIcon } from "./type-icons.svelte";
  import DialectIcon from "./DialectIcon.svelte";
  import DatabaseIcon from "@lucide/svelte/icons/database";
  import Table2 from "@lucide/svelte/icons/table-2";
  import Eye from "@lucide/svelte/icons/eye";
  import SquareFunction from "@lucide/svelte/icons/square-function";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Link2 from "@lucide/svelte/icons/link-2";
  import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import { SvelteSet, SvelteMap } from "svelte/reactivity";

  interface Props {
    relations: RelationInfo[];
    functions: FunctionDef[];
    loading: boolean;
    connectionId: string | null;
    connection: ConnectionEntry | null;
    onInsert?: (text: string) => void;
    onRefresh?: () => void;
    onOpenInNewTab?: (title: string, sql: string) => void;
  }
  let { relations, functions, loading, connectionId, connection, onInsert, onRefresh, onOpenInNewTab }: Props = $props();

  const dialectLabels: Record<string, string> = {
    postgres: "PostgreSQL",
    mysql: "MySQL",
    mariadb: "MariaDB",
    sqlserver: "SQL Server",
    oracle: "Oracle",
    "jdbc-generic": "JDBC",
    odbc: "ODBC",
  };

  function dialectLabel(dialect: string): string {
    return dialectLabels[dialect] ?? dialect;
  }

  interface SchemaGroup {
    name: string;
    tables: RelationInfo[];
    views: RelationInfo[];
    functions: FunctionDef[];
  }

  let searchQuery = $state("");
  const searchInput = $state<{ el: HTMLInputElement | null }>({ el: null });

  function matchesSearch(text: string, query: string): boolean {
    if (!query) return true;
    return text.toLowerCase().includes(query.toLowerCase());
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

    const query = searchQuery.trim();
    if (!query) return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));

    const filtered: SchemaGroup[] = [];
    for (const g of map.values()) {
      const filteredTables = g.tables.filter((t) => {
        if (matchesSearch(t.name, query)) return true;
        return t.columns.some((c) => matchesSearch(c.name, query));
      });
      const filteredViews = g.views.filter((v) => {
        if (matchesSearch(v.name, query)) return true;
        return v.columns.some((c) => matchesSearch(c.name, query));
      });
      const filteredFunctions = g.functions.filter((f) => matchesSearch(f.name, query));
      if (filteredTables.length > 0 || filteredViews.length > 0 || filteredFunctions.length > 0) {
        filtered.push({ name: g.name, tables: filteredTables, views: filteredViews, functions: filteredFunctions });
      }
    }
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
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
  const expandedBySearch = new SvelteSet<string>();

  function relationKey(schema: string, name: string) {
    return `${schema}.${name}`;
  }

  function isNodeExpanded(schema: string, name: string): boolean {
    const key = relationKey(schema, name);
    return expanded.has(key) || expandedBySearch.has(key);
  }

  function toggleExpand(schema: string, name: string, withIndexes: boolean) {
    const key = relationKey(schema, name);
    if (expanded.has(key)) {
      expanded.delete(key);
    } else {
      expanded.add(key);
      expandedBySearch.delete(key);
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

  $effect(() => {
    const query = searchQuery.trim();
    if (!query) {
      expandedBySearch.clear();
      return;
    }
    expandedBySearch.clear();
    for (const g of groups) {
      const schemaKey = `schema:${g.name}`;
      expandedBySearch.add(schemaKey);
      for (const t of g.tables) {
        const tableKey = relationKey(g.name, t.name);
        expandedBySearch.add(tableKey);
      }
      for (const v of g.views) {
        const viewKey = relationKey(g.name, v.name);
        expandedBySearch.add(viewKey);
      }
    }
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

{#snippet columnsSection(columns: RelationInfo["columns"], searchFilter?: string)}
  <div class="sub-header"><span>Colunas ({columns.length})</span></div>
  <ul class="columns">
    {#each columns as c (c.name)}
      {@const matches = !searchFilter || matchesSearch(c.name, searchFilter) || matchesSearch(c.dataType, searchFilter)}
      <li
        class="column"
        class:highlight={searchFilter && matches}
        title={`${c.name}: ${c.dataType}${c.nullable ? "" : " NOT NULL"}${c.foreignKeyTo ? ` — FK → ${c.foreignKeyTo.schema}.${c.foreignKeyTo.table}.${c.foreignKeyTo.column}` : ""}`}
      >
        {#if c.isPrimaryKey}
          <KeyRound size={10} class="pk" />
          <span class="badge badge-pk">PK</span>
        {:else if c.foreignKeyTo}
          <Link2 size={10} class="fk" />
          <span class="badge badge-fk">FK</span>
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
    {#if connection}
      <div class="connection-chip" title={`${connection.label} · ${dialectLabel(connection.dialect)}`}>
        <DialectIcon dialect={connection.dialect} size={13} />
        <span class="connection-label">{connection.label}</span>
        <span class="connection-status" class:synced={connection.lastSyncedAt}>
          {connection.lastSyncedAt ? "conectado" : "não sincronizado"}
        </span>
      </div>
    {:else}
      <span>Objetos</span>
    {/if}
    <div class="header-actions">
      <button
        class="icon"
        title="Atualizar objetos do banco"
        onclick={onRefresh}
        disabled={loading}
        aria-label="Atualizar"
      ><RefreshCw size={13} class={loading ? "spin" : undefined} /></button>
    </div>
  </div>
  <div class="search-wrapper">
    <Search size={12} class="search-icon" />
    <input
      class="search-input"
      type="text"
      placeholder="Buscar tabelas, colunas..."
      bind:value={searchQuery}
      bind:this={searchInput.el}
    />
    {#if searchQuery}
      <button class="search-clear" onclick={() => { searchQuery = ""; searchInput.el?.focus(); }} aria-label="Limpar busca">
        <X size={11} />
      </button>
    {/if}
  </div>
  <div class="sidebar-body">
    {#if groups.length === 0}
      <p class="hint">{loading ? "Carregando..." : searchQuery ? "Nenhum resultado encontrado." : "Nenhum objeto disponível."}</p>
    {/if}
    {#if groups.length > 0}
      {#each groups as g (g.name)}
        {@const schemaKey = `schema:${g.name}`}
        {@const isSchemaOpen = searchQuery ? true : expandedBySearch.has(schemaKey)}
        <details class="schema-group" open={isSchemaOpen}>
          <summary class="schema"><DatabaseIcon size={13} /> <span class="label">{g.name}</span></summary>
          {#if g.tables.length > 0}
            <details open={searchQuery ? g.tables.length > 0 : undefined}>
              <summary class="kind">Tabelas ({g.tables.length})</summary>
              {#each g.tables as t (t.name)}
                {@const key = relationKey(g.name, t.name)}
                {@const isOpen = isNodeExpanded(g.name, t.name)}
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
                  {@render columnsSection(t.columns, searchQuery)}
                  {@render indexesSection(g.name, t.name)}
                {/if}
              {/each}
            </details>
          {/if}
          {#if g.views.length > 0}
            <details open={searchQuery ? g.views.length > 0 : undefined}>
              <summary class="kind">Views ({g.views.length})</summary>
              {#each g.views as v (v.name)}
                {@const key = relationKey(g.name, v.name)}
                {@const isOpen = isNodeExpanded(g.name, v.name)}
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
                  {@render columnsSection(v.columns, searchQuery)}
                {/if}
              {/each}
            </details>
          {/if}
          {#if g.functions.length > 0}
            <details open={searchQuery ? g.functions.length > 0 : undefined}>
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
  .header-actions {
    display: flex;
    gap: 2px;
  }
  .connection-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: #ccc;
    text-transform: none;
    letter-spacing: 0;
    font-size: 12px;
  }
  .connection-chip :global(.dialect-icon) {
    flex-shrink: 0;
  }
  .connection-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: 110px;
  }
  .connection-status {
    flex-shrink: 0;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
    color: #aaa;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .connection-status.synced {
    background: rgba(137, 209, 133, 0.18);
    color: #89d185;
  }
  .search-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    padding: 6px 8px;
    border-bottom: 1px solid #2a2a2a;
    flex-shrink: 0;
  }
  .search-wrapper :global(.search-icon) {
    position: absolute;
    left: 16px;
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
    right: 14px;
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
  summary { transition: background-color 0.08s ease; }
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
  .obj { transition: background-color 0.08s ease; }
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
    transition: opacity 0.1s ease, background-color 0.08s ease, color 0.08s ease;
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
  .column.highlight {
    background: rgba(0, 122, 204, 0.15);
    border-radius: 3px;
  }
  .column :global(.pk) {
    flex-shrink: 0;
    color: #d4a72c;
  }
  .column :global(.fk) {
    flex-shrink: 0;
    color: #6ea8fe;
  }
  .badge {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    line-height: 14px;
    text-transform: uppercase;
  }
  .badge-pk {
    background: rgba(212, 167, 44, 0.2);
    color: #d4a72c;
  }
  .badge-fk {
    background: rgba(110, 168, 254, 0.2);
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
    transition: background-color 0.08s ease, color 0.08s ease;
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
