import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useLanguage } from "../i18n";

type Mode = "postgres" | "oracle" | "mysql" | "mariadb" | "sqlserver" | "jdbc-generic" | "odbc" | "demo";

const DEFAULT_PORTS: Record<Mode, string> = {
  postgres: "5432",
  oracle: "1521",
  mysql: "3306",
  mariadb: "3306",
  sqlserver: "1433",
  "jdbc-generic": "",
  odbc: "",
  demo: "5432",
};

const DEFAULT_DATABASES: Record<Mode, string> = {
  postgres: "postgres",
  oracle: "orcl",
  mysql: "app",
  mariadb: "app",
  sqlserver: "master",
  "jdbc-generic": "",
  odbc: "",
  demo: "postgres",
};

const DEFAULT_USERS: Record<Mode, string> = {
  postgres: "postgres",
  oracle: "system",
  mysql: "root",
  mariadb: "root",
  sqlserver: "sa",
  "jdbc-generic": "",
  odbc: "",
  demo: "postgres",
};

const ALL_MODES: Mode[] = ["postgres", "oracle", "mysql", "mariadb", "sqlserver"];

function isKnownDialect(d: string): d is Exclude<Mode, "demo" | "jdbc-generic" | "odbc"> {
  return new Set<Mode>(["postgres", "oracle", "mysql", "mariadb", "sqlserver"]).has(d as Mode);
}

function parseEndpoint(endpoint: string, defaultPort: string): { host: string; port: string; database: string } {
  const [hostPort, db] = endpoint.split("/");
  const [h, p] = hostPort?.split(":") ?? ["", ""];
  return { host: h ?? "", port: p ?? defaultPort, database: db ?? "postgres" };
}

function generateId(): string {
  return `conn-${crypto.randomUUID()}`;
}

export interface ConnectionDialogProps {
  open: boolean;
  editing?: ConnectionConfig | null;
  duplicating?: boolean;
  onClose: () => void;
  onSaved: (connectionId: string) => void | Promise<void>;
}

export function ConnectionDialog({ open, editing, duplicating = false, onClose, onSaved }: ConnectionDialogProps) {
  const { t } = useLanguage();
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
  const [odbcEndpoint, setOdbcEndpoint] = useState("");
  const [jarPath, setJarPath] = useState("");
  const [driverClassName, setDriverClassName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; message?: string } | null>(null);
  const [availableSchemas, setAvailableSchemas] = useState<string[] | null>(null);
  const [selectedSchemas, setSelectedSchemas] = useState<Set<string>>(new Set());
  const [schemaSearch, setSchemaSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    const editingDialect = editing?.dialect;
    const isKnown = editingDialect !== undefined && isKnownDialect(editingDialect);
    const isJdbc = editingDialect === "jdbc-generic";
    const isOdbc = editingDialect === "odbc";
    const nextMode = isKnown ? editingDialect : isJdbc ? "jdbc-generic" : isOdbc ? "odbc" : "demo";
    setMode(nextMode);
    setLabel(editing?.label ?? "");
    setId(duplicating ? generateId() : editing?.id ?? "");
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
    setOdbcEndpoint(isOdbc ? editing?.endpoint ?? "" : "");
    setTestResult(null);
    setError(null);
    setBusy(false);
    setAvailableSchemas(null);
    setSelectedSchemas(new Set(editing?.schemas ?? []));
    setSchemaSearch("");
  }, [open, editing, duplicating]);

  const buildEndpoint = useCallback(() => {
    if (mode === "jdbc-generic") return jdbcUrl;
    if (mode === "odbc") return odbcEndpoint;
    return `${host}:${port}/${database}`;
  }, [mode, jdbcUrl, odbcEndpoint, host, port, database]);

  const buildOptions = useCallback((): ConnectionConfig["options"] => {
    if (mode === "jdbc-generic") return { jarPath, driverClassName };
    if (mode === "odbc") return { timeout: 30 };
    return ssl ? { ssl: "require" } : undefined;
  }, [mode, jarPath, driverClassName, ssl]);

  const defaultLabel = useCallback(() => {
    if (mode === "jdbc-generic") return jdbcUrl || t("jdbcGeneric");
    if (mode === "odbc") return odbcEndpoint || "ODBC";
    return `${host}/${database}`;
  }, [mode, jdbcUrl, odbcEndpoint, host, database, t]);

  const canConnect = useCallback(() => {
    if (mode === "jdbc-generic") {
      return jdbcUrl.length > 0 && jarPath.length > 0 && driverClassName.length > 0 && user.length > 0;
    }
    if (mode === "odbc") return odbcEndpoint.trim().length > 0;
    return host.length > 0 && user.length > 0;
  }, [mode, jdbcUrl, odbcEndpoint, jarPath, driverClassName, user, host]);

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
      const result = await backend.call<{ connectionId: string }>("connection.add", { config: buildConfig(), password });
      await onSaved(result.connectionId);
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
    if (next === "demo" || next === "jdbc-generic" || next === "odbc") return;
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

  const schemaNames = useMemo(() => {
    const names = new Set([...(availableSchemas ?? []), ...selectedSchemas]);
    return [...names].sort((left, right) => {
      const selectionOrder = Number(selectedSchemas.has(right)) - Number(selectedSchemas.has(left));
      return selectionOrder || left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [availableSchemas, selectedSchemas]);
  const normalizedSchemaSearch = schemaSearch.trim().toLocaleLowerCase();
  const visibleSchemas = schemaNames.filter((name) => name.toLocaleLowerCase().includes(normalizedSchemaSearch));
  const selectSchemas = (names: readonly string[]) => setSelectedSchemas((current) => new Set([...current, ...names]));

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className="omni-standard-dialog omni-connection-dialog">
        <form className="omni-dialog-form" onSubmit={onSave}>
          <DialogTitle>{duplicating ? t("duplicateConnection") : editing ? t("editConnection") : t("newConnection")}</DialogTitle>
          <DialogBody className="omni-dialog-body">
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
                <option value="jdbc-generic">{t("jdbcGeneric")}</option>
                <option value="odbc">ODBC</option>
                <option value="demo">Demo (in-memory)</option>
              </select>
            </Label>

            <Label>
              Nome
              <Input value={label} onChange={(_, data) => setLabel(data.value)} placeholder={t("connectionNamePlaceholder")} disabled={busy} required style={{ marginTop: 4 }} />
            </Label>

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

            {mode === "odbc" && (
              <Label>
                DSN ou connection string ODBC
                <Input value={odbcEndpoint} onChange={(_, data) => setOdbcEndpoint(data.value)} placeholder="MeuDSN ou DRIVER={Driver};SERVER=host;DATABASE=db" disabled={busy} required style={{ marginTop: 4 }} />
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>Informe usuário e senha abaixo; não inclua UID/PWD neste campo.</Text>
              </Label>
            )}

            {mode !== "demo" && mode !== "jdbc-generic" && mode !== "odbc" && (
              <>
                <div className="omni-connection-host-row">
                  <Label style={{ flex: 1 }}>
                    Host
                    <Input value={host} onChange={(_, data) => setHost(data.value)} placeholder="127.0.0.1" disabled={busy} required style={{ marginTop: 4 }} />
                  </Label>
                  <Label>
                    {t("port")}
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
                  {t("user")}
                  <Input value={user} onChange={(_, data) => setUser(data.value)} placeholder={DEFAULT_USERS[mode]} disabled={busy} required style={{ marginTop: 4 }} />
                </Label>
                <Label>
                  {t("password")}
                  <Input type="password" value={password} onChange={(_, data) => setPassword(data.value)} placeholder="••••••" disabled={busy} style={{ marginTop: 4 }} />
                  {duplicating && <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("duplicatePasswordHint")}</Text>}
                </Label>
              </>
            )}

            {mode !== "demo" && (
              <>
                {mode !== "jdbc-generic" && mode !== "odbc" && (
                  <Checkbox label="SSL require" checked={ssl} onChange={(_, data) => setSsl(data.checked === true)} disabled={busy} />
                )}
                <section className="connection-schema-picker">
                  <div className="connection-schema-heading">
                    <div>
                      <Text weight="semibold">{t("schemasToIndex")}</Text>
                      <Text size={200} className="connection-schema-summary">
                        {selectedSchemas.size === 0 ? t("noSelectionAllSchemas") : t("schemaSelectionCount").replace("{selected}", String(selectedSchemas.size)).replace("{total}", String(schemaNames.length))}
                      </Text>
                    </div>
                    <Button type="button" onClick={loadSchemas} disabled={busy || !canConnect()} size="small">
                      {busy ? t("loading") : t("loadSchemas")}
                    </Button>
                  </div>
                  {availableSchemas === null && selectedSchemas.size === 0 ? (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("loadSchemasHint")}</Text>
                  ) : schemaNames.length === 0 ? (
                    <Text size={200}>{t("noSchemaFound")}</Text>
                  ) : (
                    <>
                      {availableSchemas === null && <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("savedSchemasHint")}</Text>}
                      <Input aria-label={t("searchSchemas")} value={schemaSearch} onChange={(_, data) => setSchemaSearch(data.value)} placeholder={t("searchSchemas")} />
                      <div className="connection-schema-actions">
                        <Button type="button" appearance="subtle" size="small" onClick={() => selectSchemas(schemaNames)}>
                          {t("selectAll")}
                        </Button>
                        {normalizedSchemaSearch && <Button type="button" appearance="subtle" size="small" onClick={() => selectSchemas(visibleSchemas)}>{t("selectVisible")}</Button>}
                        <Button type="button" appearance="subtle" size="small" onClick={() => setSelectedSchemas(new Set())}>
                          {t("useAllSchemas")}
                        </Button>
                      </div>
                      <div className="connection-schema-list">
                        {visibleSchemas.length === 0 ? <Text size={200}>{t("noSchemaMatches")}</Text> : visibleSchemas.map((schemaName) => (
                          <div className={`connection-schema-row${selectedSchemas.has(schemaName) ? " is-selected" : ""}`} key={schemaName}>
                            <Checkbox label={schemaName} checked={selectedSchemas.has(schemaName)} onChange={() => toggleSchema(schemaName)} />
                            {selectedSchemas.has(schemaName) && <Text size={100}>{t("selected")}</Text>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              </>
            )}

            {error && (
              <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>
            )}
            {testResult && (
              <Text style={{ color: testResult.ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
                {testResult.ok ? `${t("connectedIn")} ${testResult.latencyMs}ms` : `${t("failure")}: ${testResult.message ?? t("unknownFailure")}`}
              </Text>
            )}
          </DialogBody>
          <DialogActions className="omni-dialog-actions">
            {mode !== "demo" && (
              <Button type="button" onClick={onTest} disabled={busy || !canConnect()}>
                {busy ? t("loading") : t("connect")}
              </Button>
            )}
            <div style={{ flex: 1 }} />
            <Button type="button" onClick={onClose} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="submit" appearance="primary" disabled={busy || (mode !== "demo" && !canConnect())}>
              {busy ? t("loading") : t("saveConnection")}
            </Button>
          </DialogActions>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
