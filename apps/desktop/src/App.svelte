<script lang="ts">
  import Editor from "./lib/Editor.svelte";
  import ResultsGrid from "./lib/ResultsGrid.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import TabBar from "./lib/TabBar.svelte";
  import ConnectionDialog from "./lib/ConnectionDialog.svelte";
  import { backend, type ConnectionEntry } from "./lib/backend";
  import { basenameNoExt, pickOpenPath, pickSavePath, readSqlFile, writeSqlFile } from "./lib/file-io";
  import type { QueryResult, ConnectionConfig, RowEditability } from "@omni-sql/ts-types";
  import type { Suggestion } from "@omni-sql/autocomplete-engine";

  const SESSION_KEY = "omni-sql:session";

  interface QueryTab {
    id: string;
    title: string;
    sql: string;
    queryLimit: number;
    fontFamily: string;
    connectionId: string | null;
    filePath: string | null;
    savedSql: string | null;
    result: QueryResult | null;
    error: string | null;
    running: boolean;
    /** Null enquanto não analisado, ou quando a query não é editável. */
    editability: RowEditability | null;
  }

  interface PersistedTab {
    id: string;
    title: string;
    sql: string;
    queryLimit: number;
    fontFamily: string;
    connectionId: string | null;
    filePath: string | null;
  }

  const DEFAULT_FONT_FAMILY = "ui-monospace, monospace";

  interface PersistedSession {
    tabs?: PersistedTab[];
    activeTabId?: string | null;
    activeConnectionId?: string | null;
  }

  function loadSession(): PersistedSession {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function makeTabId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function makeTab(partial?: Partial<PersistedTab>): QueryTab {
    return {
      id: partial?.id ?? makeTabId(),
      title: partial?.title ?? "Query",
      sql: partial?.sql ?? "SELECT 1",
      queryLimit: partial?.queryLimit ?? 1000,
      fontFamily: partial?.fontFamily ?? DEFAULT_FONT_FAMILY,
      connectionId: partial?.connectionId ?? null,
      filePath: partial?.filePath ?? null,
      savedSql: null,
      result: null,
      error: null,
      running: false,
      editability: null,
    };
  }

  const restored = loadSession();
  // Sessões antigas guardavam uma única conexão global; usamos como valor
  // inicial para abas migradas que ainda não têm connectionId próprio.
  const legacyConnectionId = restored.activeConnectionId ?? null;

  let tabs = $state<QueryTab[]>(
    restored.tabs && restored.tabs.length > 0
      ? restored.tabs.map((t) => makeTab({ ...t, connectionId: t.connectionId ?? legacyConnectionId }))
      : [makeTab({ title: "Query 1", connectionId: legacyConnectionId })],
  );
  let activeTabId = $state<string>(
    restored.activeTabId && tabs.some((t) => t.id === restored.activeTabId)
      ? restored.activeTabId
      : tabs[0]!.id,
  );
  let tabCounter = tabs.length;

  const activeIndex = $derived(tabs.findIndex((t) => t.id === activeTabId));
  const activeConnectionId = $derived(activeIndex >= 0 ? tabs[activeIndex]!.connectionId : null);

  let connections = $state<ConnectionEntry[]>([]);
  let busyMsg = $state<string | null>(null);
  let dialogOpen = $state(false);
  let editingConfig = $state<ConnectionConfig | null>(null);

  let booted = false;

  function sanitizeTabConnections() {
    for (const t of tabs) {
      if (t.connectionId && !connections.some((c) => c.id === t.connectionId)) {
        t.connectionId = null;
      }
    }
  }

  function assignDefaultConnections() {
    if (connections.length === 0) return;
    for (const t of tabs) {
      if (!t.connectionId) t.connectionId = connections[0]!.id;
    }
  }

  async function loadConnections() {
    const list = await backend.call<{ configs: ConnectionEntry[] }>("connection.list", {});
    connections = list.configs;
    sanitizeTabConnections();
  }

  async function ensureDemoConnection() {
    if (connections.length === 0) {
      busyMsg = "Criando conexão demo…";
      const cfg = {
        id: "demo",
        label: "Demo (in-memory)",
        dialect: "postgres" as const,
        endpoint: "memory://local",
        user: "anon",
      };
      await backend.call("connection.add", { config: cfg });
      await loadConnections();
    }
  }

  async function introspectConnection(connectionId: string | null) {
    if (!connectionId) return;
    busyMsg = "Introspecção…";
    try {
      await backend.call("metadata.introspect", { connectionId });
      await loadConnections();
      if (activeIndex >= 0) tabs[activeIndex]!.error = null;
    } catch (e) {
      if (activeIndex >= 0) {
        tabs[activeIndex]!.error = `Falha ao atualizar metadados: ${(e as Error).message}`;
      }
    } finally {
      busyMsg = null;
    }
  }

  function introspectActive() {
    return introspectConnection(activeConnectionId);
  }

  async function onBoot() {
    try {
      await loadConnections();
      await ensureDemoConnection();
      assignDefaultConnections();
      await introspectActive();
    } catch (e) {
      busyMsg = null;
      if (activeIndex >= 0) tabs[activeIndex]!.error = `Falha no boot: ${(e as Error).message}`;
    }
  }

  async function onRun() {
    const idx = activeIndex;
    if (idx < 0) return;
    const tab = tabs[idx]!;
    if (!tab.connectionId) return;
    tab.running = true;
    tab.error = null;
    tab.editability = null;
    try {
      tab.result = await backend.call<QueryResult>("query.run", {
        connectionId: tab.connectionId,
        sql: tab.sql,
        limit: tab.queryLimit,
      });
      // Best-effort: se o sidecar/metadata-cache falhar, a grade só fica
      // read-only — nunca deve invalidar o resultado que já rodou.
      tab.editability = await backend
        .call<RowEditability>("query.analyzeEditability", {
          connectionId: tab.connectionId,
          sql: tab.sql,
        })
        .catch(() => null);
    } catch (e) {
      tab.error = (e as Error).message;
      tab.result = null;
    } finally {
      tab.running = false;
    }
  }

  /** Callback da grade de resultados para gravar uma célula editada via `row.update`. */
  async function onCellEdit(edit: { set: Record<string, unknown>; where: Record<string, unknown> }): Promise<void> {
    const tab = tabs[activeIndex];
    const table = tab?.editability?.table;
    if (!tab?.connectionId || !table) throw new Error("sem tabela resolvida para edição");
    await backend.call("row.update", {
      connectionId: tab.connectionId,
      table,
      set: edit.set,
      where: edit.where,
    });
  }

  function onLimitChange(newLimit: number) {
    if (activeIndex < 0) return;
    tabs[activeIndex]!.queryLimit = newLimit;
  }

  function onFontChange(newFontFamily: string) {
    if (activeIndex < 0) return;
    tabs[activeIndex]!.fontFamily = newFontFamily;
  }

  async function onLoadMore() {
    if (activeIndex < 0) return;
    const tab = tabs[activeIndex]!;
    tab.queryLimit += tab.queryLimit;
    await onRun();
  }

  async function onAutocomplete(cursor: number): Promise<Suggestion[]> {
    if (activeIndex < 0) return [];
    const tab = tabs[activeIndex]!;
    if (!tab.connectionId) return [];
    const r = await backend.call<{ suggestions: Suggestion[] }>("completion.get", {
      connectionId: tab.connectionId,
      sql: tab.sql,
      cursor,
    });
    return r.suggestions;
  }

  function onAddTab() {
    tabCounter += 1;
    const inheritedConnectionId =
      activeIndex >= 0 ? tabs[activeIndex]!.connectionId : (connections[0]?.id ?? null);
    const tab = makeTab({ title: `Query ${tabCounter}`, connectionId: inheritedConnectionId });
    tabs.push(tab);
    activeTabId = tab.id;
  }

  function onCloseTab(id: string) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const wasActive = activeTabId === id;
    tabs.splice(idx, 1);
    if (tabs.length === 0) {
      tabCounter += 1;
      tabs.push(makeTab({ title: `Query ${tabCounter}`, connectionId: connections[0]?.id ?? null }));
    }
    if (wasActive) {
      const nextIdx = Math.min(idx, tabs.length - 1);
      activeTabId = tabs[nextIdx]!.id;
    }
  }

  function onSelectTab(id: string) {
    activeTabId = id;
  }

  function onRenameTab(id: string, title: string) {
    const tab = tabs.find((t) => t.id === id);
    if (tab) tab.title = title;
  }

  async function onSaveTabAs() {
    if (activeIndex < 0) return;
    const tab = tabs[activeIndex]!;
    const path = await pickSavePath(tab.title);
    if (!path) return;
    try {
      await writeSqlFile(path, tab.sql);
      tab.filePath = path;
      tab.title = basenameNoExt(path);
      tab.savedSql = tab.sql;
      tab.error = null;
    } catch (e) {
      tab.error = `Falha ao salvar arquivo: ${(e as Error).message}`;
    }
  }

  async function onSaveTab() {
    if (activeIndex < 0) return;
    const tab = tabs[activeIndex]!;
    if (!tab.filePath) {
      await onSaveTabAs();
      return;
    }
    try {
      await writeSqlFile(tab.filePath, tab.sql);
      tab.savedSql = tab.sql;
      tab.error = null;
    } catch (e) {
      tab.error = `Falha ao salvar arquivo: ${(e as Error).message}`;
    }
  }

  async function onOpenFile() {
    const path = await pickOpenPath();
    if (!path) return;
    try {
      const contents = await readSqlFile(path);
      const inheritedConnectionId =
        activeIndex >= 0 ? tabs[activeIndex]!.connectionId : (connections[0]?.id ?? null);
      const tab = makeTab({
        title: basenameNoExt(path),
        sql: contents,
        filePath: path,
        connectionId: inheritedConnectionId,
      });
      tab.savedSql = contents;
      tabs.push(tab);
      activeTabId = tab.id;
    } catch (e) {
      if (activeIndex >= 0) tabs[activeIndex]!.error = `Falha ao abrir arquivo: ${(e as Error).message}`;
    }
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key.toLowerCase() === "t") {
      e.preventDefault();
      onAddTab();
    } else if (e.key.toLowerCase() === "w") {
      e.preventDefault();
      onCloseTab(activeTabId);
    } else if (e.key.toLowerCase() === "s" && e.shiftKey) {
      e.preventDefault();
      void onSaveTabAs();
    } else if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      void onSaveTab();
    } else if (e.key.toLowerCase() === "o") {
      e.preventDefault();
      void onOpenFile();
    }
  }

  async function onSelectConnection(id: string) {
    if (activeIndex < 0) return;
    tabs[activeIndex]!.connectionId = id;
    await introspectActive();
  }

  function onAddConnection() {
    editingConfig = null;
    dialogOpen = true;
  }

  function onEditConnection(id: string) {
    const c = connections.find((x) => x.id === id);
    if (!c) return;
    editingConfig = {
      id: c.id,
      label: c.label,
      dialect: c.dialect,
      endpoint: c.endpoint,
      user: c.user,
      options: c.options,
    };
    dialogOpen = true;
  }

  async function onRemoveConnection(id: string) {
    try {
      await backend.call("connection.remove", { connectionId: id });
      // loadConnections() já limpa connectionId das abas que apontavam para
      // a conexão removida (sanitizeTabConnections).
      await loadConnections();
      if (activeIndex >= 0 && !tabs[activeIndex]!.connectionId && connections.length > 0) {
        tabs[activeIndex]!.connectionId = connections[0]!.id;
        await introspectActive();
      }
    } catch (e) {
      if (activeIndex >= 0) tabs[activeIndex]!.error = `Falha ao remover: ${(e as Error).message}`;
    }
  }

  async function onConnectionSaved() {
    dialogOpen = false;
    await loadConnections();
    if (activeIndex >= 0 && !tabs[activeIndex]!.connectionId && connections.length > 0) {
      tabs[activeIndex]!.connectionId = connections[0]!.id;
    }
    await introspectActive();
  }

  $effect(() => {
    if (!booted) {
      booted = true;
      void onBoot();
    }
  });

  $effect(() => {
    const snapshot: PersistedSession = {
      tabs: tabs.map((t) => ({
        id: t.id,
        title: t.title,
        sql: t.sql,
        queryLimit: t.queryLimit,
        fontFamily: t.fontFamily,
        connectionId: t.connectionId,
        filePath: t.filePath,
      })),
      activeTabId,
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
    } catch {
      // localStorage indisponível/cheio — sessão simplesmente não é restaurada.
    }
  });
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<main class="app">
  <Toolbar
    {connections}
    {activeConnectionId}
    {busyMsg}
    running={tabs[activeIndex]?.running ?? false}
    onRun={onRun}
    onSelectConnection={onSelectConnection}
    onAdd={onAddConnection}
    onEdit={onEditConnection}
    onRemove={onRemoveConnection}
    onRefreshMetadata={introspectActive}
    limit={tabs[activeIndex]?.queryLimit ?? 1000}
    onLimitChange={onLimitChange}
    fontFamily={tabs[activeIndex]?.fontFamily ?? DEFAULT_FONT_FAMILY}
    onFontChange={onFontChange}
    onSave={onSaveTab}
    onOpen={onOpenFile}
  />

  <TabBar
    tabs={tabs.map((t) => ({
      id: t.id,
      title: t.title,
      dirty: t.filePath != null && t.sql !== t.savedSql,
    }))}
    {activeTabId}
    onSelect={onSelectTab}
    onClose={onCloseTab}
    onAdd={onAddTab}
    onRename={onRenameTab}
  />

  {#if activeIndex >= 0}
    <section class="editor-pane">
      <Editor
        bind:value={tabs[activeIndex]!.sql}
        fontFamily={tabs[activeIndex]!.fontFamily}
        onAutocomplete={onAutocomplete}
        onRun={onRun}
      />
    </section>

    <section class="results-pane">
      <ResultsGrid
        result={tabs[activeIndex]!.result}
        error={tabs[activeIndex]!.error}
        running={tabs[activeIndex]!.running}
        editability={tabs[activeIndex]!.editability}
        onLoadMore={onLoadMore}
        onCellEdit={onCellEdit}
      />
    </section>
  {/if}
</main>

<ConnectionDialog
  open={dialogOpen}
  editing={editingConfig}
  onClose={() => (dialogOpen = false)}
  onSaved={onConnectionSaved}
/>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    height: 100%;
    background: #1e1e1e;
    color: #ddd;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  :global(#app) { height: 100vh; display: flex; }
  .app {
    display: grid;
    grid-template-rows: auto auto 1fr 1fr;
    height: 100%;
    width: 100%;
  }
  .editor-pane, .results-pane {
    min-height: 0;
    overflow: hidden;
    border-top: 1px solid #2a2a2a;
  }
</style>
