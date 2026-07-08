<script lang="ts">
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";

  type SidecarState = "checking" | "ready" | "unavailable";

  const HEALTH_URL = "http://127.0.0.1:41921/health";
  const CHECK_FETCH_TIMEOUT_MS = 800;
  const POLL_INTERVAL_MS = 1500;
  const IDLE_POLL_INTERVAL_MS = 15000;
  const GIVE_UP_AFTER_MS = 20000;

  const LABEL: Record<SidecarState, string> = {
    checking: "Motor de sugestões avançadas (CTE/subquery): iniciando em segundo plano…",
    ready: "Motor de sugestões avançadas (CTE/subquery): pronto",
    unavailable:
      "Motor de sugestões avançadas (CTE/subquery): indisponível — autocomplete básico continua normal",
  };

  let state = $state<SidecarState>("checking");

  $effect(() => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
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

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<span class="sidecar-status" class:ready={state === "ready"} class:unavailable={state === "unavailable"} title={LABEL[state]}>
  {#if state === "checking"}
    <Loader2 size={13} class="spin" />
  {:else if state === "ready"}
    <CircleCheck size={13} />
  {:else}
    <CircleDashed size={13} />
  {/if}
</span>

<style>
  .sidecar-status {
    display: inline-flex;
    align-items: center;
    color: #9cdcfe;
    opacity: 0.7;
    cursor: default;
  }
  .sidecar-status.ready {
    color: #6a9955;
    opacity: 0.9;
  }
  .sidecar-status.unavailable {
    color: #666;
    opacity: 0.5;
  }
  .sidecar-status :global(.spin) {
    animation: sidecar-spin 1s linear infinite;
  }
  @keyframes sidecar-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
