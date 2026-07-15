<script lang="ts">
  import type { QueryResult } from "@omni-sql/ts-types";
  import type { ConnectionEntry } from "./backend";
  import DialectIcon from "./DialectIcon.svelte";

  interface Props {
    connection: ConnectionEntry | null;
    result: QueryResult | null;
    cursorPosition: { line: number; column: number } | null;
    busyMsg: string | null;
  }
  let { connection, result, cursorPosition, busyMsg }: Props = $props();

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
</script>

<footer class="status-bar">
  <div class="status-group connection">
    {#if connection}
      <DialectIcon dialect={connection.dialect} size={13} />
      <span class="connection-label" title={connection.label}>{connection.label}</span>
      <span class="badge" class:synced={connection.lastSyncedAt}>
        {connection.lastSyncedAt ? "conectado" : "não sincronizado"}
      </span>
      <span class="dialect">{dialectLabel(connection.dialect)}</span>
    {:else}
      <span class="connection-label muted">Sem conexão</span>
    {/if}
  </div>

  {#if busyMsg}
    <span class="busy" title={busyMsg}>{busyMsg}</span>
  {/if}

  <div class="spacer"></div>

  <div class="status-group results">
    {#if result}
      <span title="{result.rows.length} linha(s) · {result.columns.length} coluna(s)">
        {result.rows.length} linha(s) · {result.columns.length} coluna(s)
      </span>
      <span class="muted">{result.elapsedMs}ms</span>
    {/if}
  </div>

  <div class="status-group cursor">
    {#if cursorPosition}
      <span>Ln {cursorPosition.line}, Col {cursorPosition.column}</span>
    {/if}
  </div>
</footer>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    height: 24px;
    background: #007acc;
    color: #fff;
    font-size: 11px;
    border-top: 1px solid #005a9e;
    flex-shrink: 0;
  }
  .status-group {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .connection {
    flex-shrink: 0;
  }
  .connection-label {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.2);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge.synced {
    background: rgba(137, 209, 133, 0.25);
    color: #d6f5d3;
  }
  .dialect {
    opacity: 0.85;
  }
  .busy {
    color: #ffe08a;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .results {
    gap: 10px;
    color: rgba(255, 255, 255, 0.9);
  }
  .cursor {
    flex-shrink: 0;
    min-width: 90px;
    text-align: right;
  }
  .muted {
    opacity: 0.7;
  }
</style>
