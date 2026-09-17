import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";

interface ManagedProcess {
  id: "backend" | "jvm";
  pid: number | null;
  running: boolean;
}

export function BackgroundProcessesDialog({ open, onClose, language }: {
  open: boolean;
  onClose: () => void;
  language: string;
}) {
  const pt = language === "pt-BR";
  const [processes, setProcesses] = useState<ManagedProcess[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setProcesses(await invoke<ManagedProcess[]>("get_managed_processes"));
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(interval);
  }, [open, refresh]);

  const stop = async (id: ManagedProcess["id"]) => {
    const label = id === "backend" ? "Node backend" : "JVM sidecar";
    if (!window.confirm(pt
      ? `Encerrar ${label}? Os recursos que dependem dele ficarão indisponíveis até reiniciar o aplicativo.`
      : `Stop ${label}? Features that depend on it will be unavailable until the app restarts.`)) return;
    setBusy(true);
    try {
      await invoke("stop_managed_process", { id });
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    if (!window.confirm(pt
      ? "Reiniciar o omni-sql e seus serviços? As conexões de banco abertas precisarão ser reconectadas."
      : "Restart omni-sql and its services? Open database connections will need to reconnect.")) return;
    setBusy(true);
    try {
      await invoke("restart_managed_processes");
    } catch (cause) {
      setError(String(cause));
      setBusy(false);
    }
  };

  return <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface className="omni-standard-dialog">
      <DialogBody className="omni-dialog-body">
        <DialogTitle>{pt ? "Processos em segundo plano" : "Background processes"}</DialogTitle>
        <DialogContent>
          <p>{pt ? "Serviços iniciados e controlados pelo omni-sql:" : "Services started and controlled by omni-sql:"}</p>
          {processes.map((process) => <div key={process.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
            <span>{process.id === "backend" ? "Node backend" : "JVM sidecar"} — {process.running
              ? `${pt ? "Em execução" : "Running"} (PID ${process.pid})`
              : pt ? "Parado" : "Stopped"}</span>
            <Button disabled={!process.running || busy} onClick={() => void stop(process.id)}>{pt ? "Encerrar" : "Stop"}</Button>
          </div>)}
          <p>{pt
            ? "Launchers MCP abertos por clientes externos pertencem a esses clientes. Encerre-os no próprio cliente; eles não são controlados por este painel."
            : "MCP launchers opened by external clients belong to those clients. Stop them in the client; this panel does not control them."}</p>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
        <DialogActions className="omni-dialog-actions">
          <Button disabled={busy} onClick={() => void refresh()}>{pt ? "Atualizar" : "Refresh"}</Button>
          <Button disabled={busy} onClick={() => void restart()}>{pt ? "Reiniciar aplicativo e serviços" : "Restart app and services"}</Button>
          <Button appearance="primary" onClick={onClose}>{pt ? "Fechar" : "Close"}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
