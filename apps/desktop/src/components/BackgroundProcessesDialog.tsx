import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { dictionaries, type Language, type TranslationKey } from "../i18n";

interface ManagedProcess {
  id: "backend" | "jvm";
  pid: number | null;
  running: boolean;
}

export function BackgroundProcessesDialog({ open, onClose, language }: {
  open: boolean;
  onClose: () => void;
  language: Language;
}) {
  const t = (key: TranslationKey) => dictionaries[language][key];
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
    if (!window.confirm(t("stopProcessConfirm").replace("{label}", label))) return;
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
    if (!window.confirm(t("restartServicesConfirm"))) return;
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
        <DialogTitle>{t("backgroundProcesses")}</DialogTitle>
        <DialogContent>
          <p>{t("backgroundServices")}</p>
          {processes.map((process) => <div key={process.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
            <span>{process.id === "backend" ? "Node backend" : "JVM sidecar"} — {process.running
              ? `${t("processRunning")} (PID ${process.pid})`
              : t("processStopped")}</span>
            <Button disabled={!process.running || busy} onClick={() => void stop(process.id)}>{t("stopProcess")}</Button>
          </div>)}
          <p>{t("externalMcpProcesses")}</p>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
        <DialogActions className="omni-dialog-actions">
          <Button disabled={busy} onClick={() => void refresh()}>{t("refresh")}</Button>
          <Button disabled={busy} onClick={() => void restart()}>{t("restartServices")}</Button>
          <Button appearance="primary" onClick={onClose}>{t("close")}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
