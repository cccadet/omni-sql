import { useEffect, useState } from "react";
import { tokens } from "@fluentui/react-components";

type SidecarState = "checking" | "ready" | "unavailable";

const HEALTH_URL = "http://127.0.0.1:41921/health";
const CHECK_TIMEOUT_MS = 800;
const POLL_INTERVAL_MS = 1500;
const IDLE_POLL_INTERVAL_MS = 15000;
const GIVE_UP_AFTER_MS = 20000;

const LABEL: Record<SidecarState, string> = {
  checking: "Busca inteligente: iniciando em segundo plano…",
  ready: "Busca inteligente: ativa (sugestões avançadas de CTE/subquery)",
  unavailable: "Busca inteligente: indisponível — autocomplete básico continua normal",
};

export function SidecarStatus() {
  const [state, setState] = useState<SidecarState>("checking");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function check() {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
        const res = await fetch(HEALTH_URL, { signal: controller.signal });
        clearTimeout(id);
        if (res.ok) {
          if (!cancelled) setState("ready");
          return;
        }
      } catch {
        // sidecar ainda não respondeu; segue tentando em background.
      }
      if (cancelled) return;
      const gaveUp = Date.now() - startedAt > GIVE_UP_AFTER_MS;
      setState(gaveUp ? "unavailable" : "checking");
      timer = setTimeout(check, gaveUp ? IDLE_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
    }

    void check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [retryKey]);

  const retry = () => {
    setState("checking");
    setRetryKey((k) => k + 1);
  };

  const color = state === "ready" ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground3;
  const opacity = state === "checking" ? 0.7 : 1;
  const cursor = state === "unavailable" ? "pointer" : "default";

  return (
    <span
      title={LABEL[state]}
      onClick={state === "unavailable" ? retry : undefined}
      style={{ display: "inline-flex", alignItems: "center", opacity, color, cursor }}
      aria-label={LABEL[state]}
    >
      <svg
        width={15}
        height={15}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      </svg>
    </span>
  );
}
