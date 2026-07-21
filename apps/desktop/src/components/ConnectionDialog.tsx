import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  Input,
  Label,
  Checkbox,
  Text,
  tokens,
} from "@fluentui/react-components";
import type { ConnectionConfig } from "@omni-sql/ts-types";
import { backend } from "../lib/backend";
import { pickJarPath } from "../lib/file-io";

type Mode = "postgres" | "oracle" | "mysql" | "mariadb" | "sqlserver" | "jdbc-generic" | "demo";

const DEFAULT_PORTS: Record<Mode, string> = {
  postgres: "5432",
  oracle: "1521",
  mysql: "3306",
  mariadb: "3306",
  sqlserver: "1433",
  "jdbc-generic": "",
  demo: "5432",
};

const DEFAULT_DATABASES: Record<Mode, string> = {
  postgres: "postgres",
  oracle: "orcl",
  mysql: "app",
  mariadb: "app",
  sqlserver: "master",
  "jdbc-generic": "",
  demo: "postgres",
};

const DEFAULT_USERS: Record<Mode, string> = {
  postgres: "postgres",
  oracle: "system",
  mysql: "root",
  mariadb: "root",
  sqlserver: "sa",
  "jdbc-generic": "",
  demo: "postgres",
};

const ALL_MODES: Mode[] = ["postgres", "oracle", "mysql", "mariadb", "sqlserver"];

function isKnownDialect(d: string): d is Exclude<Mode, "demo" | "jdbc-generic"> {
  return new Set<Mode>(["postgres", "oracle", "mysql", "mariadb", "sqlserver"]).has(d as Mode);
}

function parseEndpoint(endpoint: string, defaultPort: string): { host: string; port: string; database: string } {
  const [hostPort, db] = endpoint.split("/");
  const [h, p] = hostPort?.split(":") ?? ["", ""];
  return { host: h ?? "", port: p ?? defaultPort, database: db ?? "postgres" };
}

function generateId(): string {
  return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface ConnectionDialogProps {
  open: boolean;
  editing?: ConnectionConfig | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ConnectionDialog({ open, editing, onClose, onSaved }: ConnectionDialogProps) {
  const [mode, setMode] = useState<Mode>("postgres");
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("postgres");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(false);
  const [jdbcUrl, setJdbcUrl] = useState("");
  const [jarPath, setJarPath] = useState("");
  const [driverClassName, setDriverClassName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; message?: string } | null>(null);
  const [availableSchemas, setAvailableSchemas] = useState<string[] | null>(null);
  const [selectedSchemas, setSelectedSchemas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const editingDialect = editing?.dialect;
    const isKnown = editingDialect !== undefined && isKnownDialect(editingDialect);
    const isJdbc = editingDialect === "jdbc-generic";
    const nextMode = isKnown ? editingDialect : isJdbc ? "jdbc-generic" : "demo";
    setMode(nextMode);
    setLabel(editing?.label ?? "");
    setId(editing?.id ?? "");
    setUser(editing?.user ?? "");
    setPassword("");
    setSsl(editing?.options?.ssl === true || editing?.options?.ssl === "require");
    if (isKnown) {
      const parts = parseEndpoint(editing!.endpoint, DEFAULT_PORTS[nextMode]);
      setHost(parts.host);
      setPort(parts.port);
      setDatabase(parts.database);
    } else {
      setHost("");
      setPort("5432");
      setDatabase("postgres");
    }
    if (isJdbc) {
      setJdbcUrl(editing?.endpoint ?? "");
      setJarPath(String(editing?.options?.jarPath ?? ""));
      setDriverClassName(String(editing?.options?.driverClassName ?? ""));
    } else {
      setJdbcUrl("");
      setJarPath("");
      setDriverClassName("");
    }
    setTestResult(null);
    setError(null);
    setBusy(false);
    setAvailableSchemas(null);
    setSelectedSchemas(new Set(editing?.schemas ?? []));
  }, [open, editing]);

  const buildEndpoint = useCallback(() => {
    if (mode === "jdbc-generic") return jdbcUrl;
    return `${host}:${port}/${database}`;
  }, [mode, jdbcUrl, host, port, database]);

  const buildOptions = useCallback((): ConnectionConfig["options"] => {
    if (mode === "jdbc-generic") return { jarPath, driverClassName };
    return ssl ? { ssl: "require" } : undefined;
  }, [mode, jarPath, driverClassName, ssl]);

  const defaultLabel = useCallback(() => {
    if (mode === "jdbc-generic") return jdbcUrl || "JDBC genérico";
    return `${host}/${database}`;
  }, [mode, jdbcUrl, host, database]);

  const canConnect = useCallback(() => {
    if (mode === "jdbc-generic") {
      return jdbcUrl.length > 0 && jarPath.length > 0 && driverClassName.length > 0 && user.length > 0;
    }
    return host.length > 0 && user.length > 0;
  }, [mode, jdbcUrl, jarPath, driverClassName, user, host]);

  const buildConfig = useCallback((): ConnectionConfig => {
    if (mode === "demo") {
      return {
        id: id || "demo",
        label: label || "Demo (in-memory)",
        dialect: "postgres",
        endpoint: "memory://local",
        user: user || "anon",
      };
    }
    return {
      id: id || generateId(),
      label: label || defaultLabel(),
      dialect: mode,
      endpoint: buildEndpoint(),
      user,
      options: buildOptions(),
      schemas: selectedSchemas.size > 0 ? [...selectedSchemas] : undefined,
    };
  }, [mode, id, label, defaultLabel, buildEndpoint, user, buildOptions, selectedSchemas]);

  const onTest = async () => {
    if (mode === "demo") return;
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await backend.call("connection.test", { config: buildConfig(), password });
      setTestResult(result as { ok: boolean; latencyMs: number; message?: string });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadSchemas = async () => {
    if (mode === "demo") return;
    setBusy(true);
    setError(null);
    try {
      const result = await backend.call<{ schemas: string[] }>("connection.listSchemas", {
        config: buildConfig(),
        password,
      });
      setAvailableSchemas(result.schemas);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await backend.call("connection.add", { config: buildConfig(), password });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const onModeChange = (next: Mode) => {
    const isDefaultPort = port === "" || ALL_MODES.some((m) => port === DEFAULT_PORTS[m]);
    const isDefaultDatabase = database === "" || ALL_MODES.some((m) => database === DEFAULT_DATABASES[m]);
    const isDefaultUser = user === "" || ALL_MODES.some((m) => user === DEFAULT_USERS[m]);
    setMode(next);
    if (next === "demo" || next === "jdbc-generic") return;
    if (isDefaultPort) setPort(DEFAULT_PORTS[next]);
    if (isDefaultDatabase) setDatabase(DEFAULT_DATABASES[next]);
    if (isDefaultUser) setUser(DEFAULT_USERS[next]);
  };

  const pickJar = async () => {
    const picked = await pickJarPath();
    if (picked) setJarPath(picked);
  };

  const toggleSchema = (name: string) => {
    setSelectedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <form onSubmit={onSave}>
          <DialogTitle>{editing ? "Editar conexão" : "Nova conexão"}</DialogTitle>
          <DialogBody style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Label>
              Tipo
              <select
                value={mode}
                onChange={(e) => onModeChange(e.target.value as Mode)}
                disabled={busy}
                style={{ display: "block", width: "100%", marginTop: 4, padding: 6 }}
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="mariadb">MariaDB</option>
                <option value="sqlserver">SQL Server</option>
                <option value="oracle">Oracle</option>
                <option value="jdbc-generic">JDBC genérico</option>
                <option value="demo">Demo (in-memory)</option>
              </select>
            </Label>

            <Label>
              Nome
              <Input value={label} onChange={(_, data) => setLabel(data.value)} placeholder="Minha conexão" disabled={busy} required style={{ marginTop: 4 }} />
            </Label>

            {editing && (
              <Label>
                ID interno
                <Input
                  value={id}
                  readOnly
                  disabled={busy}
                  aria-describedby="connection-id-help"
                  style={{ marginTop: 4 }}
                />
                <Text id="connection-id-help" size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                  Fixo para preservar as credenciais salvas.
                </Text>
              </Label>
            )}

            {mode === "jdbc-generic" && (
              <>
                <Label>
                  JDBC URL
                  <Input value={jdbcUrl} onChange={(_, data) => setJdbcUrl(data.value)} placeholder="jdbc:exemplo://host:porta/db" disabled={busy} required style={{ marginTop: 4 }} />
                </Label>
                <Label>
                  Driver (.jar)
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <Input value={jarPath} onChange={(_, data) => setJarPath(data.value)} placeholder="/caminho/para/driver.jar" disabled={busy} required style={{ flex: 1 }} />
                    <Button type="button" onClick={pickJar} disabled={busy}>Procurar…</Button>
                  </div>
                </Label>
                <Label>
                  Classe do driver
                  <Input value={driverClassName} onChange={(_, data) => setDriverClassName(data.value)} placeholder="com.exemplo.Driver" disabled={busy} required style={{ marginTop: 4 }} />
                </Label>
              </>
            )}

            {mode !== "demo" && mode !== "jdbc-generic" && (
              <>
                <div style={{ display: "flex", gap: 12 }}>
                  <Label style={{ flex: 1 }}>
                    Host
                    <Input value={host} onChange={(_, data) => setHost(data.value)} placeholder="127.0.0.1" disabled={busy} required style={{ marginTop: 4 }} />
                  </Label>
                  <Label>
                    Porta
                    <Input value={port} onChange={(_, data) => setPort(data.value)} placeholder={DEFAULT_PORTS[mode]} disabled={busy} required style={{ width: 90, marginTop: 4 }} />
                  </Label>
                </div>
                <Label>
                  {mode === "oracle" ? "Service name / SID" : "Database"}
                  <Input value={database} onChange={(_, data) => setDatabase(data.value)} placeholder={DEFAULT_DATABASES[mode]} disabled={busy} required style={{ marginTop: 4 }} />
                </Label>
              </>
            )}

            {mode !== "demo" && (
              <>
                <Label>
                  Usuário
                  <Input value={user} onChange={(_, data) => setUser(data.value)} placeholder={DEFAULT_USERS[mode]} disabled={busy} required style={{ marginTop: 4 }} />
                </Label>
                <Label>
                  Senha
                  <Input type="password" value={password} onChange={(_, data) => setPassword(data.value)} placeholder="••••••" disabled={busy} style={{ marginTop: 4 }} />
                </Label>
              </>
            )}

            {mode !== "demo" && mode !== "jdbc-generic" && (
              <>
                <Checkbox label="SSL require" checked={ssl} onChange={(_, data) => setSsl(data.checked === true)} disabled={busy} />
                <div
                  style={{
                    border: `1px solid ${tokens.colorNeutralStroke1}`,
                    borderRadius: 4,
                    padding: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Text size={200}>Schemas a indexar</Text>
                    <Button type="button" onClick={loadSchemas} disabled={busy || !canConnect()} size="small">
                      Carregar schemas
                    </Button>
                  </div>
                  {availableSchemas === null ? (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                      Sem seleção: todos os schemas serão indexados.
                    </Text>
                  ) : availableSchemas.length === 0 ? (
                    <Text size={200}>Nenhum schema encontrado.</Text>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 12 }}>
                        <Button type="button" appearance="subtle" size="small" onClick={() => setSelectedSchemas(new Set(availableSchemas))}>
                          Selecionar todos
                        </Button>
                        <Button type="button" appearance="subtle" size="small" onClick={() => setSelectedSchemas(new Set())}>
                          Selecionar nenhum
                        </Button>
                      </div>
                      <div style={{ maxHeight: 140, overflow: "auto" }}>
                        {availableSchemas.map((s) => (
                          <Checkbox key={s} label={s} checked={selectedSchemas.has(s)} onChange={() => toggleSchema(s)} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {error && (
              <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>
            )}
            {testResult && (
              <Text style={{ color: testResult.ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
                {testResult.ok ? `Conectado em ${testResult.latencyMs}ms` : `Falha: ${testResult.message ?? "desconhecida"}`}
              </Text>
            )}
          </DialogBody>
          <DialogActions>
            {mode !== "demo" && (
              <Button type="button" onClick={onTest} disabled={busy || !canConnect()}>
                {busy ? "Testando…" : "Testar conexão"}
              </Button>
            )}
            <div style={{ flex: 1 }} />
            <Button type="button" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" appearance="primary" disabled={busy || (mode !== "demo" && !canConnect())}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
          </DialogActions>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
