<script lang="ts">
  import Editor from "./lib/Editor.svelte";
  import ResultsGrid from "./lib/ResultsGrid.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import ConnectionDialog from "./lib/ConnectionDialog.svelte";
  import { backend, type ConnectionEntry } from "./lib/backend";
  import type { QueryResult, ConnectionConfig } from "@omni-sql/ts-types";
  import type { Suggestion } from "@omni-sql/autocomplete-engine";

  let sql = $state("SELECT 1");
  let result = $state<QueryResult | null>(null);
  let error = $state<string | null>(null);
  let running = $state(false);
  let connections = $state<ConnectionEntry[]>([]);
  let activeConnectionId = $state<string | null>(null);
  let busyMsg = $state<string | null>(null);
  let dialogOpen = $state(false);
  let editingConfig = $state<ConnectionConfig | null>(null);

  let booted = false;

  async function loadConnections() {
    const list = await backend.call<{ configs: ConnectionEntry[] }>("connection.list", {});
    connections = list.configs;
    if (connections.length > 0 && !activeConnectionId) {
      activeConnectionId = connections[0]!.id;
    }
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
      activeConnectionId = "demo";
    }
  }

  async function introspectActive() {
    if (!activeConnectionId) return;
    busyMsg = "Introspecção…";
    try {
      await backend.call("metadata.introspect", { connectionId: activeConnectionId });
    } finally {
      busyMsg = null;
    }
  }

  async function onBoot() {
    try {
      await loadConnections();
      await ensureDemoConnection();
      await introspectActive();
    } catch (e) {
      busyMsg = null;
      error = `Falha no boot: ${(e as Error).message}`;
    }
  }

  async function onRun() {
    if (!activeConnectionId) return;
    running = true;
    error = null;
    try {
      result = await backend.call<QueryResult>("query.run", {
        connectionId: activeConnectionId,
        sql,
        limit: 1000,
      });
    } catch (e) {
      error = (e as Error).message;
      result = null;
    } finally {
      running = false;
    }
  }

  async function onAutocomplete(cursor: number): Promise<Suggestion[]> {
    if (!activeConnectionId) return [];
    const r = await backend.call<{ suggestions: Suggestion[] }>("completion.get", {
      connectionId: activeConnectionId,
      sql,
      cursor,
    });
    return r.suggestions;
  }

  async function onSelectConnection(id: string) {
    activeConnectionId = id;
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
      await loadConnections();
      if (activeConnectionId === id) {
        activeConnectionId = connections[0]?.id ?? null;
        await introspectActive();
      }
    } catch (e) {
      error = `Falha ao remover: ${(e as Error).message}`;
    }
  }

  async function onConnectionSaved() {
    dialogOpen = false;
    await loadConnections();
    if (!activeConnectionId && connections.length > 0) {
      activeConnectionId = connections[0]!.id;
    }
    await introspectActive();
  }

  $effect(() => {
    if (!booted) {
      booted = true;
      void onBoot();
    }
  });
</script>

<main class="app">
  <Toolbar
    {connections}
    {activeConnectionId}
    {busyMsg}
    {running}
    onRun={onRun}
    onSelectConnection={onSelectConnection}
    onAdd={onAddConnection}
    onEdit={onEditConnection}
    onRemove={onRemoveConnection}
  />

  <section class="editor-pane">
    <Editor
      bind:value={sql}
      onAutocomplete={onAutocomplete}
      onRun={onRun}
    />
  </section>

  <section class="results-pane">
    <ResultsGrid {result} {error} {running} />
  </section>
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
    grid-template-rows: auto 1fr 1fr;
    height: 100%;
    width: 100%;
  }
  .editor-pane, .results-pane {
    min-height: 0;
    overflow: hidden;
    border-top: 1px solid #2a2a2a;
  }
</style>
