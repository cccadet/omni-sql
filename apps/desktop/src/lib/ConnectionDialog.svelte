<script lang="ts">
  import type { ConnectionConfig } from "@omni-sql/ts-types";
  import { backend } from "./backend";

  interface Props {
    open: boolean;
    editing?: ConnectionConfig | null;
    onClose: () => void;
    onSaved: () => void;
  }
  let { open, editing = null, onClose, onSaved }: Props = $props();

  type Mode = "postgres" | "oracle" | "demo";

  function defaultPortFor(m: Mode): string {
    return m === "oracle" ? "1521" : "5432";
  }
  function defaultDatabaseFor(m: Mode): string {
    return m === "oracle" ? "orcl" : "postgres";
  }

  let mode = $state<Mode>("postgres");
  let label = $state("");
  let id = $state("");
  let host = $state("");
  let port = $state("5432");
  let database = $state("postgres");
  let user = $state("");
  let password = $state("");
  let ssl = $state(false);
  let busy = $state(false);
  let testResult = $state<{ ok: boolean; latencyMs: number; message?: string } | null>(null);
  let error = $state<string | null>(null);
  let availableSchemas = $state<string[] | null>(null);
  let selectedSchemas = $state<Set<string>>(new Set());
  let schemasLoading = $state(false);

  $effect(() => {
    if (open) {
      const editingDialect = editing?.dialect;
      const isKnown = editingDialect === "postgres" || editingDialect === "oracle";
      mode = isKnown ? editingDialect : "demo";
      label = editing?.label ?? "";
      id = editing?.id ?? "";
      user = editing?.user ?? "";
      password = "";
      ssl = editing?.options?.ssl === true || editing?.options?.ssl === "require";
      if (isKnown) {
        const parts = parseEndpoint(editing!.endpoint, defaultPortFor(mode));
        host = parts.host;
        port = parts.port;
        database = parts.database;
      } else {
        host = "";
        port = "5432";
        database = "postgres";
      }
      testResult = null;
      error = null;
      busy = false;
      availableSchemas = null;
      selectedSchemas = new Set(editing?.schemas ?? []);
      if (isKnown && editing?.schemas && editing.schemas.length > 0) {
        void loadSchemas();
      }
    }
  });

  function parseEndpoint(
    endpoint: string,
    defaultPort = "5432",
  ): { host: string; port: string; database: string } {
    // Expects "host:port/database"
    const [hostPort, db] = endpoint.split("/");
    const [h, p] = hostPort?.split(":") ?? ["", ""];
    return { host: h ?? "", port: p ?? defaultPort, database: db ?? "postgres" };
  }

  function onModeChange(e: Event): void {
    const next = (e.currentTarget as HTMLSelectElement).value as Mode;
    const isDefaultPort = port === "" || port === defaultPortFor("postgres") || port === defaultPortFor("oracle");
    const isDefaultDatabase = database === "" || database === defaultDatabaseFor("postgres") || database === defaultDatabaseFor("oracle");
    mode = next;
    if (next === "demo") return;
    if (isDefaultPort) port = defaultPortFor(next);
    if (isDefaultDatabase) database = defaultDatabaseFor(next);
  }

  function buildEndpoint(): string {
    return `${host}:${port}/${database}`;
  }

  function generateId(): string {
    return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async function onTest(e: Event) {
    e.preventDefault();
    if (mode === "demo") return;
    busy = true;
    testResult = null;
    error = null;
    try {
      const cfg: ConnectionConfig = {
        id: id || generateId(),
        label: label || `${host}/${database}`,
        dialect: mode,
        endpoint: buildEndpoint(),
        user,
        options: ssl ? { ssl: "require" } : undefined,
      };
      testResult = await backend.call("connection.test", { config: cfg, password });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function toggleSchema(name: string) {
    const next = new Set(selectedSchemas);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    selectedSchemas = next;
  }

  async function loadSchemas() {
    if (mode === "demo") return;
    schemasLoading = true;
    error = null;
    try {
      const cfg: ConnectionConfig = {
        id: id || generateId(),
        label: label || `${host}/${database}`,
        dialect: mode,
        endpoint: buildEndpoint(),
        user,
        options: ssl ? { ssl: "require" } : undefined,
      };
      const res = await backend.call<{ schemas: string[] }>("connection.listSchemas", { config: cfg, password });
      availableSchemas = [...res.schemas];
    } catch (e) {
      error = (e as Error).message;
    } finally {
      schemasLoading = false;
    }
  }

  function onLoadSchemasClick(e: Event) {
    e.preventDefault();
    void loadSchemas();
  }

  async function onSave(e: Event) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      const cfg: ConnectionConfig =
        mode === "demo"
          ? {
              id: id || "demo",
              label: label || "Demo (in-memory)",
              dialect: "postgres",
              endpoint: "memory://local",
              user: user || "anon",
            }
          : {
              id: id || generateId(),
              label: label || `${host}/${database}`,
              dialect: mode,
              endpoint: buildEndpoint(),
              user,
              options: ssl ? { ssl: "require" } : undefined,
              schemas: selectedSchemas.size > 0 ? [...selectedSchemas] : undefined,
            };
      await backend.call("connection.add", { config: cfg, password });
      onSaved();
    } catch (e) {
      error = (e as Error).message;
      busy = false;
    }
  }

  let mouseDownOnBackdrop = $state(false);

  function onBackdropMouseDown(e: MouseEvent) {
    mouseDownOnBackdrop = e.target === e.currentTarget;
  }
  function onBackdropMouseUp(e: MouseEvent) {
    if (mouseDownOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
    mouseDownOnBackdrop = false;
  }
  function onBackdropKey(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

{#if open}
  <div class="backdrop" onmousedown={onBackdropMouseDown} onmouseup={onBackdropMouseUp} onkeydown={onBackdropKey} role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="conn-title">
    <form class="dialog" onsubmit={onSave}>
      <h2 id="conn-title">{editing ? "Editar conexão" : "Nova conexão"}</h2>

      <label>
        <span>Tipo</span>
        <select value={mode} onchange={onModeChange} disabled={busy}>
          <option value="postgres">PostgreSQL</option>
          <option value="oracle">Oracle</option>
          <option value="demo">Demo (in-memory)</option>
        </select>
      </label>

      <label>
        <span>Nome</span>
        <input type="text" bind:value={label} placeholder="Minha conexão" disabled={busy} required />
      </label>

      {#if mode === "postgres" || mode === "oracle"}
        <div class="row">
          <label class="grow">
            <span>Host</span>
            <input type="text" bind:value={host} placeholder="127.0.0.1" disabled={busy} required />
          </label>
          <label>
            <span>Porta</span>
            <input type="text" bind:value={port} placeholder={defaultPortFor(mode)} disabled={busy} required />
          </label>
        </div>

        <label>
          <span>{mode === "oracle" ? "Service name / SID" : "Database"}</span>
          <input type="text" bind:value={database} placeholder={defaultDatabaseFor(mode)} disabled={busy} required />
        </label>

        <label>
          <span>Usuário</span>
          <input type="text" bind:value={user} placeholder={mode === "oracle" ? "system" : "postgres"} disabled={busy} required />
        </label>

        <label>
          <span>Senha</span>
          <input type="password" bind:value={password} placeholder="••••••" disabled={busy} />
        </label>

        <label class="inline">
          <input type="checkbox" bind:checked={ssl} disabled={busy} />
          <span>SSL require</span>
        </label>

        <div class="schemas-section">
          <div class="schemas-header">
            <span>Schemas a indexar</span>
            <button
              type="button"
              class="link"
              onclick={onLoadSchemasClick}
              disabled={busy || schemasLoading || !host || !user}
            >{schemasLoading ? "Carregando…" : "Carregar schemas"}</button>
          </div>
          {#if availableSchemas === null}
            <p class="hint">Sem seleção: todos os schemas serão indexados.</p>
          {:else if availableSchemas.length === 0}
            <p class="hint">Nenhum schema encontrado.</p>
          {:else}
            <div class="schemas-actions">
              <button type="button" class="link" onclick={() => (selectedSchemas = new Set(availableSchemas))}>Selecionar todos</button>
              <button type="button" class="link" onclick={() => (selectedSchemas = new Set())}>Selecionar nenhum</button>
            </div>
            <div class="schemas-list">
              {#each availableSchemas as s}
                <label class="inline schema-item">
                  <input type="checkbox" checked={selectedSchemas.has(s)} onchange={() => toggleSchema(s)} />
                  <span>{s}</span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if error}
        <div class="error">{error}</div>
      {/if}

      {#if testResult}
        <div class={testResult.ok ? "success" : "warn"}>
          {testResult.ok
            ? `Conectado em ${testResult.latencyMs}ms`
            : `Falha: ${testResult.message ?? "desconhecida"}`}
        </div>
      {/if}

      <div class="actions">
        {#if mode === "postgres" || mode === "oracle"}
          <button type="button" onclick={onTest} disabled={busy || !host || !user}>
            {busy ? "Testando…" : "Testar conexão"}
          </button>
        {/if}
        <div class="spacer"></div>
        <button type="button" class="secondary" onclick={onClose} disabled={busy}>Cancelar</button>
        <button type="submit" disabled={busy || ((mode === "postgres" || mode === "oracle") && (!host || !user))}>
          {busy ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .dialog {
    background: #252526;
    border: 1px solid #3c3c3c;
    border-radius: 8px;
    padding: 20px;
    width: 420px;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  }
  h2 {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 600;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #ccc;
  }
  label.inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .row {
    display: flex;
    gap: 12px;
  }
  .grow {
    flex: 1;
  }
  input, select {
    background: #1e1e1e;
    color: #ddd;
    border: 1px solid #3c3c3c;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 13px;
  }
  input:focus, select:focus {
    outline: none;
    border-color: #0e639c;
  }
  input:disabled, select:disabled {
    opacity: 0.6;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }
  .spacer {
    flex: 1;
  }
  button {
    background: #0e639c;
    color: #fff;
    border: none;
    padding: 7px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  button.secondary {
    background: #3c3c3c;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .schemas-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: #1e1e1e;
    border: 1px solid #3c3c3c;
    border-radius: 4px;
  }
  .schemas-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: #ccc;
  }
  .schemas-actions {
    display: flex;
    gap: 10px;
  }
  .schemas-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 140px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .schema-item {
    font-size: 12px;
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: #888;
  }
  button.link {
    background: transparent;
    color: #4fa3e0;
    padding: 0;
    font-weight: 400;
    font-size: 12px;
    text-decoration: underline;
  }
  button.link:disabled {
    color: #666;
    text-decoration: none;
  }
  .error {
    color: #f48771;
    font-size: 12px;
  }
  .success {
    color: #89d185;
    font-size: 12px;
  }
  .warn {
    color: #f48771;
    font-size: 12px;
  }
</style>
