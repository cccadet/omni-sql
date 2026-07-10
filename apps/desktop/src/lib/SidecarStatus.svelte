<script lang="ts">
  type SidecarState = "checking" | "ready" | "unavailable";

  const HEALTH_URL = "http://127.0.0.1:41921/health";
  const CHECK_FETCH_TIMEOUT_MS = 800;
  const POLL_INTERVAL_MS = 1500;
  const IDLE_POLL_INTERVAL_MS = 15000;
  const GIVE_UP_AFTER_MS = 20000;

  const LABEL: Record<SidecarState, string> = {
    checking: "Busca inteligente: iniciando em segundo plano…",
    ready: "Busca inteligente: ativa (sugestões avançadas de CTE/subquery)",
    unavailable: "Busca inteligente: indisponível — autocomplete básico continua normal",
  };

  let state = $state<SidecarState>("checking");
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  async function check() {
    if (cancelled) return;
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(CHECK_FETCH_TIMEOUT_MS) });
      if (res.ok) {
        state = "ready";
        return;
      }
    } catch {
      // sidecar ainda não respondeu; segue tentando em background.
    }
    if (cancelled) return;
    const gaveUp = Date.now() - startedAt > GIVE_UP_AFTER_MS;
    state = gaveUp ? "unavailable" : "checking";
    timer = setTimeout(check, gaveUp ? IDLE_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
  }

  /** Reinicia o ciclo de tentativas imediatamente — usado pelo botão "Tentar reconectar". */
  function retry() {
    clearTimeout(timer);
    startedAt = Date.now();
    state = "checking";
    void check();
  }

  $effect(() => {
    cancelled = false;
    startedAt = Date.now();
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<span class="sidecar-status {state}">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
  </svg>
  <div class="popover">
    <p>{LABEL[state]}</p>
    {#if state === "unavailable"}
      <button type="button" onclick={retry}>Tentar reconectar</button>
    {/if}
  </div>
</span>

<style>
  .sidecar-status {
    position: relative;
    display: inline-flex;
    align-items: center;
    opacity: 0.5;
    color: #888;
    cursor: default;
  }
  .sidecar-status.checking {
    opacity: 0.7;
    animation: sidecar-pulse 1.4s ease-in-out infinite;
  }
  .sidecar-status.ready {
    opacity: 1;
    color: #c586c0;
  }
  .sidecar-status .popover {
    display: none;
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    z-index: 20;
    width: 220px;
    background: #2d2d30;
    border: 1px solid #3c3c3c;
    border-radius: 4px;
    padding: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .sidecar-status:hover .popover,
  .sidecar-status:focus-within .popover {
    display: block;
  }
  .popover p {
    margin: 0 0 6px 0;
    font-size: 11px;
    color: #ccc;
    line-height: 1.4;
  }
  .popover button {
    width: 100%;
    background: #0e639c;
    color: #fff;
    border: none;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
  }
  @keyframes sidecar-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.8; }
  }
</style>
