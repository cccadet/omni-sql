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

  type Mode = "postgres" | "demo";

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

  $effect(() => {
    if (open) {
      const isPostgres = editing?.dialect === "postgres";
      mode = isPostgres ? "postgres" : "demo";
      label = editing?.label ?? "";
      id = editing?.id ?? "";
      user = editing?.user ?? "";
      password = "";
      ssl = editing?.options?.ssl === true || editing?.options?.ssl === "require";
      if (isPostgres) {
        const parts = parseEndpoint(editing!.endpoint);
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
    }
  });

  function parseEndpoint(endpoint: string): { host: string; port: string; database: string } {
    // Expects "host:port/database"
    const [hostPort, db] = endpoint.split("/");
    const [h, p] = hostPort?.split(":") ?? ["", ""];
    return { host: h ?? "", port: p ?? "5432", database: db ?? "postgres" };
  }

  function buildEndpoint(): string {
    return `${host}:${port}/${database}`;
  }

  function generateId(): string {
    return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async function onTest(e: Event) {
    e.preventDefault();
    if (mode !== "postgres") return;
    busy = true;
    testResult = null;
    error = null;
    try {
      const cfg: ConnectionConfig = {
        id: id || generateId(),
        label: label || `${host}/${database}`,
        dialect: "postgres",
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
              dialect: "postgres",
              endpoint: buildEndpoint(),
              user,
              options: ssl ? { ssl: "require" } : undefined,
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
        <select bind:value={mode} disabled={busy}>
          <option value="postgres">PostgreSQL</option>
          <option value="demo">Demo (in-memory)</option>
        </select>
      </label>

      <label>
        <span>Nome</span>
        <input type="text" bind:value={label} placeholder="Minha conexão" disabled={busy} required />
      </label>

      {#if mode === "postgres"}
        <div class="row">
          <label class="grow">
            <span>Host</span>
            <input type="text" bind:value={host} placeholder="127.0.0.1" disabled={busy} required />
          </label>
          <label>
            <span>Porta</span>
            <input type="text" bind:value={port} placeholder="5432" disabled={busy} required />
          </label>
        </div>

        <label>
          <span>Database</span>
          <input type="text" bind:value={database} placeholder="postgres" disabled={busy} required />
        </label>

        <label>
          <span>Usuário</span>
          <input type="text" bind:value={user} placeholder="postgres" disabled={busy} required />
        </label>

        <label>
          <span>Senha</span>
          <input type="password" bind:value={password} placeholder="••••••" disabled={busy} />
        </label>

        <label class="inline">
          <input type="checkbox" bind:checked={ssl} disabled={busy} />
          <span>SSL require</span>
        </label>
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
        {#if mode === "postgres"}
          <button type="button" onclick={onTest} disabled={busy || !host || !user}>
            {busy ? "Testando…" : "Testar conexão"}
          </button>
        {/if}
        <div class="spacer"></div>
        <button type="button" class="secondary" onclick={onClose} disabled={busy}>Cancelar</button>
        <button type="submit" disabled={busy || (mode === "postgres" && (!host || !user))}>
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
