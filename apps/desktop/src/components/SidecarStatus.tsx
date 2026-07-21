import { useEffect, useState } from "react";
import { tokens } from "@fluentui/react-components";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

type SidecarState = "checking" | "ready" | "unavailable";

const SIDECAR_STATUS_EVENT = "sidecar-status";

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
    let unlisten: (() => void) | null = null;
    let receivedEvent = false;

    void listen<string>(SIDECAR_STATUS_EVENT, (event) => {
      if (cancelled) return;
      receivedEvent = true;
      const status: SidecarState = event.payload === "checking" || event.payload === "ready" || event.payload === "unavailable"
        ? event.payload
        : "unavailable";
      setState(status);
    }).then((resolvedUnlisten) => {
      if (cancelled) {
        resolvedUnlisten();
      } else {
        // Keep the handle so cleanup also covers listeners that resolve early.
        unlisten = resolvedUnlisten;

        // The sidecar can become ready before React mounts. Read the persisted
        // status only after the live listener has been installed, and do not
        // overwrite a status received while the command was in flight.
        void invoke<string>("get_sidecar_status").then((currentStatus) => {
          if (cancelled || receivedEvent) return;
          const status: SidecarState = currentStatus === "checking" || currentStatus === "ready" || currentStatus === "unavailable"
            ? currentStatus
            : "unavailable";
          setState(status);
        }).catch(() => {
          if (!cancelled && !receivedEvent) setState("unavailable");
        });
      }
    }).catch(() => {
      // The web preview has no Tauri event bridge; it must never appear ready.
      if (!cancelled) setState("unavailable");
    });

    return () => {
      cancelled = true;
      unlisten?.();
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
