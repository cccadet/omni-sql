<script lang="ts">
  import Editor from "./lib/Editor.svelte";
  import ResultsGrid from "./lib/ResultsGrid.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import { backend, type ConnectionEntry } from "./lib/backend";
  import type { QueryResult } from "@omni-sql/ts-types";
  import type { Suggestion } from "@omni-sql/autocomplete-engine";

  let sql = $state("SELECT 1");
  let result = $state<QueryResult | null>(null);
  let error = $state<string | null>(null);
  let running = $state(false);
  let connections = $state<ConnectionEntry[]>([]);
  let activeConnectionId = $state<string | null>(null);
  let busyMsg = $state<string | null>(null);

  let booted = false;

  async function ensureConnection() {
    if (connections.length === 0) {
      busyMsg = "Criando conexão in-memory…";
      const cfg = {
        id: "demo",
        label: "Demo (in-memory)",
        dialect: "postgres" as const,
        endpoint: "memory://local",
        user: "anon",
      };
      await backend.call("connection.add", { config: cfg });
      const list = await backend.call<{ configs: ConnectionEntry[] }>("connection.list", {});
      connections = list.configs;
      activeConnectionId = "demo";
      busyMsg = "Introspecção…";
      await backend.call("metadata.introspect", { connectionId: "demo" });
      busyMsg = null;
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
    await ensureConnection();
    if (!activeConnectionId) return [];
    const r = await backend.call<{ suggestions: Suggestion[] }>("completion.get", {
      connectionId: activeConnectionId,
      sql,
      cursor,
    });
    return r.suggestions;
  }

  async function onBoot() {
    try {
      await ensureConnection();
    } catch (e) {
      busyMsg = null;
      error = `Falha no boot: ${(e as Error).message}`;
    }
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
    onSelectConnection={(id) => (activeConnectionId = id)}
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