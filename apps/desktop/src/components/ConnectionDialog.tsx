import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  Field,
  Input,
  Label,
  Checkbox,
  Text,
  tokens,
} from "@fluentui/react-components";
import { DEFAULT_MCP_ACCESS, connectionMcpAccess, type ConnectionConfig, type McpAccess } from "@omni-sql/ts-types";
import { backend } from "../lib/backend";
import { pickJarPath } from "../lib/file-io";
import { listAnalysisS3 } from "../lib/analysis";
import { s3Buckets } from "../lib/s3-buckets";
import { useLanguage } from "../i18n";

type Mode = "postgres" | "oracle" | "mysql" | "mariadb" | "sqlserver" | "jdbc-generic" | "odbc" | "s3" | "mongodb" | "demo";

const ENVIRONMENTS = [
  { value: "", label: "environmentUnset" },
  { value: "development", label: "environmentDevelopment" },
  { value: "staging", label: "environmentStaging" },
  { value: "production", label: "environmentProduction" },
] as const;

const MCP_ACCESS_OPTIONS = [
  { value: "off", label: "mcpAccessOff" },
  { value: "read", label: "mcpAccessRead" },
  { value: "write", label: "mcpAccessWrite" },
] as const satisfies readonly { value: McpAccess; label: string }[];

const DB_TYPES: readonly { mode: Mode; abbr: string; label?: string; color: string }[] = [
  { mode: "postgres", abbr: "PG", label: "PostgreSQL", color: "#336791" },
  { mode: "mysql", abbr: "My", label: "MySQL", color: "#00758F" },
  { mode: "mariadb", abbr: "Ma", label: "MariaDB", color: "#003545" },
  { mode: "sqlserver", abbr: "MS", label: "SQL Server", color: "#A91D22" },
  { mode: "oracle", abbr: "Or", label: "Oracle", color: "#C74634" },
  { mode: "mongodb", abbr: "Mo", label: "MongoDB", color: "#2E7D32" },
  { mode: "s3", abbr: "S3", label: "S3", color: "#B8620B" },
  { mode: "jdbc-generic", abbr: "JD", color: "#5A5A8A" },
  { mode: "odbc", abbr: "OD", label: "ODBC", color: "#5A7A6A" },
  { mode: "demo", abbr: "De", label: "Demo (in-memory)", color: "#6B6B6B" },
];

const DEFAULT_PORTS: Record<Mode, string> = {
  postgres: "5432",
  oracle: "1521",
  mysql: "3306",
  mariadb: "3306",
  sqlserver: "1433",
  "jdbc-generic": "",
  odbc: "",
  mongodb: "",
  s3: "",
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
  mongodb: "",
  s3: "",
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
  mongodb: "",
  s3: "",
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

function bucketUris(value: string): string[] {
  return [...new Set(value.split(/[\n,]+/).map((bucket) => bucket.trim().replace(/\/$/, "")).filter(Boolean))];
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
  const [environment, setEnvironment] = useState("");
  const [mcpAccess, setMcpAccess] = useState<McpAccess>(DEFAULT_MCP_ACCESS);
  const [id, setId] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("postgres");
  const [user, setUser] = useState("");
  const [sqlPassword, setPassword] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const password = mode === "s3" ? s3SecretKey : sqlPassword;
  const [ssl, setSsl] = useState(false);
  const [jdbcUrl, setJdbcUrl] = useState("");
  const [mongoUri, setMongoUri] = useState("mongodb://localhost:27017/test");
  const [odbcEndpoint, setOdbcEndpoint] = useState("");
  const [s3BucketList, setS3BucketList] = useState("");
  const [availableBuckets, setAvailableBuckets] = useState<string[] | null>(null);
  const [s3Region, setS3Region] = useState("");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [ducklakeMappings, setDucklakeMappings] = useState<{ prefix: string; kind: "postgres" | "sqlite" | "duckdb"; connectionId?: string; path?: string }[]>([]);
  const [postgresConnections, setPostgresConnections] = useState<ConnectionConfig[]>([]);
  const [jarPath, setJarPath] = useState("");
  const [driverClassName, setDriverClassName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; message?: string } | null>(null);
  const [availableSchemas, setAvailableSchemas] = useState<string[] | null>(null);
  const [selectedSchemas, setSelectedSchemas] = useState<Set<string>>(new Set());
  const [schemaSearch, setSchemaSearch] = useState("");
  const [schemasOpen, setSchemasOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const editingDialect = editing?.dialect;
    const isKnown = editingDialect !== undefined && isKnownDialect(editingDialect);
    const isJdbc = editingDialect === "jdbc-generic";
    const isOdbc = editingDialect === "odbc";
    const isS3 = editingDialect === "s3";
    const nextMode = editingDialect === "mongodb" ? "mongodb" : isKnown ? editingDialect : isJdbc ? "jdbc-generic" : isOdbc ? "odbc" : isS3 ? "s3" : "demo";
    setMode(nextMode);
    setMongoUri(editingDialect === "mongodb" ? editing!.endpoint : "mongodb://localhost:27017/test");
    setLabel(editing?.label ?? "");
    setEnvironment(String(editing?.options?.environment ?? ""));
    setMcpAccess(editing ? connectionMcpAccess(editing) : DEFAULT_MCP_ACCESS);
    setId(duplicating ? generateId() : editing?.id ?? "");
    setUser(isS3 ? "" : editing?.user ?? "");
    setS3AccessKey(isS3 ? editing?.user ?? "" : "");
    setS3SecretKey("");
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
    setS3BucketList(isS3 && editing ? s3Buckets(editing).join("\n") : "");
    setAvailableBuckets(null);
    setS3Region(isS3 ? String(editing?.options?.region ?? "") : "");
    setS3Endpoint(isS3 ? String(editing?.options?.endpoint ?? "") : "");
    try {
      const parsed: unknown = isS3 ? JSON.parse(String(editing?.options?.ducklakeMappings ?? "[]")) : [];
      setDucklakeMappings(Array.isArray(parsed) ? parsed as typeof ducklakeMappings : []);
    } catch { setDucklakeMappings([]); }
    setTestResult(null);
    setError(null);
    setBusy(false);
    setAvailableSchemas(null);
    setSelectedSchemas(new Set(editing?.schemas ?? []));
    setSchemaSearch("");
    setSchemasOpen((editing?.schemas?.length ?? 0) > 0);
  }, [open, editing, duplicating]);

  useEffect(() => {
    if (!open) return;
    void backend.call<{ configs: ConnectionConfig[] }>("connection.list", {}).then(({ configs }) =>
      setPostgresConnections(configs.filter((config) => config.dialect === "postgres"))).catch(() => setPostgresConnections([]));
  }, [open]);

  const buildEndpoint = useCallback(() => {
    if (mode === "jdbc-generic") return jdbcUrl;
    if (mode === "mongodb") return mongoUri.trim();
    if (mode === "odbc") return odbcEndpoint;
    if (mode === "s3") return bucketUris(s3BucketList)[0] ?? "s3://";
    return `${host}:${port}/${database}`;
  }, [mode, jdbcUrl, odbcEndpoint, mongoUri, s3BucketList, host, port, database]);

  const buildOptions = useCallback((): ConnectionConfig["options"] => {
    if (mode === "jdbc-generic") return { jarPath, driverClassName };
    if (mode === "mongodb") return undefined;
    if (mode === "odbc") return { timeout: 30 };
    if (mode === "s3") return { region: s3Region.trim(), endpoint: s3Endpoint.trim(),
      buckets: JSON.stringify(bucketUris(s3BucketList)),
      ducklakeMappings: JSON.stringify(ducklakeMappings.map((mapping) => ({ ...mapping, prefix: mapping.prefix.trim().replace(/\/$/, ""), path: mapping.path?.trim() }))) };
    return ssl ? { ssl: "require" } : undefined;
  }, [mode, jarPath, driverClassName, ssl, s3BucketList, s3Region, s3Endpoint, ducklakeMappings]);

  const defaultLabel = useCallback(() => {
    if (mode === "jdbc-generic") return jdbcUrl || t("jdbcGeneric");
    if (mode === "mongodb") return mongoUri.trim() || "MongoDB";
    if (mode === "odbc") return odbcEndpoint || "ODBC";
    if (mode === "s3") return bucketUris(s3BucketList)[0] || "S3";
    return `${host}/${database}`;
  }, [mode, jdbcUrl, odbcEndpoint, mongoUri, s3BucketList, host, database, t]);

  const canConnect = useCallback(() => {
    if (mode === "jdbc-generic") {
      return jdbcUrl.length > 0 && jarPath.length > 0 && driverClassName.length > 0 && user.length > 0;
    }
    if (mode === "mongodb") return /^mongodb(?:\+srv)?:\/\//i.test(mongoUri.trim()) && !mongoUri.split("?")[0]!.includes("@");
    if (mode === "odbc") return odbcEndpoint.trim().length > 0;
    if (mode === "s3") {
      const buckets = bucketUris(s3BucketList);
      return buckets.every((value) => /^s3:\/\/[^/@]+\/?$/.test(value))
        && ducklakeMappings.every((mapping) => /^s3:\/\/[^/@]+(?:\/[^\r\n]*)?$/.test(mapping.prefix.trim())
          && buckets.some((bucket) => mapping.prefix === bucket || mapping.prefix.startsWith(`${bucket}/`))
          && (mapping.kind === "postgres" ? !!mapping.connectionId : !!mapping.path?.trim()));
    }
    return host.length > 0 && user.length > 0;
  }, [mode, jdbcUrl, odbcEndpoint, mongoUri, s3BucketList, jarPath, driverClassName, user, host, ducklakeMappings]);

  const buildConfig = useCallback((): ConnectionConfig => {
    // The default (read-only) is not persisted.
    const shared = { ...(environment ? { environment } : {}), ...(mcpAccess !== DEFAULT_MCP_ACCESS ? { mcpAccess } : {}) };
    if (mode === "demo") {
      return {
        id: id || "demo",
        label: label || "Demo (in-memory)",
        dialect: "postgres",
        endpoint: "memory://local",
        user: user || "anon",
        ...(Object.keys(shared).length > 0 ? { options: shared } : {}),
      };
    }
    const options = buildOptions();
    return {
      id: id || generateId(),
      label: label || defaultLabel(),
      dialect: mode,
      endpoint: buildEndpoint(),
      user: mode === "s3" ? s3AccessKey.trim() : user,
      options: Object.keys(shared).length > 0 ? { ...options, ...shared } : options,
      schemas: selectedSchemas.size > 0 ? [...selectedSchemas] : undefined,
    };
  }, [mode, id, label, environment, mcpAccess, defaultLabel, buildEndpoint, user, s3AccessKey, buildOptions, selectedSchemas]);

  const onTest = async () => {
    if (mode === "demo") return;
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      if (mode === "s3") {
        const startedAt = performance.now();
        if (buildEndpoint() === "s3://") {
          await backend.call("connection.listBuckets", { config: buildConfig(), password });
        } else {
          const stored = editing?.dialect === "s3" && !duplicating && !password
            ? await backend.call<{ secretAccessKey?: string }>("connection.s3Credentials", { connectionId: editing.id })
            : null;
          await listAnalysisS3({ uri: buildEndpoint(), region: s3Region.trim(),
            endpoint: s3Endpoint.trim() || undefined, accessKeyId: s3AccessKey.trim() || undefined,
            secretAccessKey: password || stored?.secretAccessKey, prefix: "" });
        }
        setTestResult({ ok: true, latencyMs: Math.round(performance.now() - startedAt) });
        return;
      }
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
    if (next === "demo" || next === "jdbc-generic" || next === "odbc" || next === "s3") return;
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

  const loadBuckets = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await backend.call<{ buckets: string[] }>("connection.listBuckets", { config: buildConfig(), password });
      setAvailableBuckets(result.buckets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedBuckets = bucketUris(s3BucketList);
  const displayedBuckets = [...new Set([...(availableBuckets ?? []), ...selectedBuckets.map((uri) => uri.slice("s3://".length))])];
  const toggleBucket = (bucket: string) => {
    const uri = `s3://${bucket}`;
    setS3BucketList((current) => {
      const selected = bucketUris(current);
      return (selected.includes(uri) ? selected.filter((value) => value !== uri) : [...selected, uri]).join("\n");
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
        <form className="omni-dialog-form" onSubmit={onSave} onChange={() => { setTestResult(null); setError(null); }}>
          <DialogTitle>{duplicating ? t("duplicateConnection") : editing ? t("editConnection") : t("newConnection")}</DialogTitle>
          <DialogBody className="omni-dialog-body">
            <div className="omni-dialog-step">{t("connectionStepType")}</div>
            <div role="radiogroup" aria-label={t("connectionType")} className="omni-db-type-grid">
              {DB_TYPES.map(({ mode: value, abbr, label: typeLabel, color }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  className="omni-db-type"
                  disabled={busy}
                  onClick={() => onModeChange(value)}
                >
                  <span aria-hidden className="omni-db-type-badge" style={{ background: color }}>{abbr}</span>
                  <span>{typeLabel ?? t("jdbcGeneric")}</span>
                </button>
              ))}
            </div>

            <div className="omni-dialog-step">{t("connectionStepDetails")}</div>
            <div className="omni-connection-name-row">
              <Field label={t("connectionName")}>
                <Input value={label} onChange={(_, data) => setLabel(data.value)} placeholder={t("connectionNamePlaceholder")} disabled={busy} required style={{ marginTop: 4 }} />
              </Field>
              <div className="omni-connection-environment">
                <span id="omni-connection-environment-label" className="omni-connection-environment-label">{t("connectionEnvironment")}</span>
                <div role="radiogroup" aria-labelledby="omni-connection-environment-label" className="omni-segmented omni-environment-segmented">
                  {ENVIRONMENTS.map(({ value, label: key }) => (
                    <button key={value || "unset"} type="button" role="radio" aria-checked={environment === value} disabled={busy} data-environment={value || undefined} onClick={() => { setEnvironment(value); setTestResult(null); setError(null); }}>
                      {value && <span aria-hidden className="omni-environment-dot" />}{t(key)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {mode !== "s3" && <div className="omni-connection-environment">
              <span id="omni-connection-mcp-label" className="omni-connection-environment-label">{t("connectionMcpAccess")}</span>
              <div role="radiogroup" aria-labelledby="omni-connection-mcp-label" className="omni-segmented" style={{ justifySelf: "start" }}>
                {MCP_ACCESS_OPTIONS.map(({ value, label: key }) => (
                  <button key={value} type="button" role="radio" aria-checked={mcpAccess === value} disabled={busy} onClick={() => { setMcpAccess(value); setTestResult(null); setError(null); }}>
                    {t(key)}
                  </button>
                ))}
              </div>
              <Text size={200}>{t("mcpAccessHint")}</Text>
            </div>}

            {mode === "mongodb" && <Field label="MongoDB URI">
              <Input value={mongoUri} onChange={(_, data) => setMongoUri(data.value)} placeholder="mongodb://localhost:27017/test?authSource=admin" disabled={busy} required />
              <Text size={200}>{t("mongoUriHint")} {t("connectionCredentialsHint")}</Text>
            </Field>}

            {mode === "jdbc-generic" && (
              <>
                <Label>
                  JDBC URL
                  <Input value={jdbcUrl} onChange={(_, data) => setJdbcUrl(data.value)} placeholder={t("jdbcUrlPlaceholder")} disabled={busy} required style={{ marginTop: 4 }} />
                </Label>
                <Label>
                  Driver (.jar)
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <Input value={jarPath} onChange={(_, data) => setJarPath(data.value)} placeholder={t("jdbcJarPlaceholder")} disabled={busy} required style={{ flex: 1 }} />
                  <Button type="button" onClick={pickJar} disabled={busy}>{t("browse")}</Button>
                  </div>
                </Label>
                <Label>
                  {t("jdbcDriverClass")}
                  <Input value={driverClassName} onChange={(_, data) => setDriverClassName(data.value)} placeholder={t("jdbcClassPlaceholder")} disabled={busy} required style={{ marginTop: 4 }} />
                </Label>
              </>
            )}

            {mode === "odbc" && (
              <Label>
                {t("odbcAddress")}
                <Input value={odbcEndpoint} onChange={(_, data) => setOdbcEndpoint(data.value)} placeholder={t("odbcPlaceholder")} disabled={busy} required style={{ marginTop: 4 }} />
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("odbcCredentialsHint")}</Text>
              </Label>
            )}

            {mode === "s3" && (
              <>
                <Field label={t("s3Region")}>
                  <Input value={s3Region} onChange={(_, data) => setS3Region(data.value)} placeholder={t("s3RegionPlaceholder")} disabled={busy} style={{ marginTop: 4 }} />
                </Field>
                <Field label={t("s3Endpoint")}>
                  <Input value={s3Endpoint} onChange={(_, data) => setS3Endpoint(data.value)} placeholder={t("s3EndpointPlaceholder")} disabled={busy} style={{ marginTop: 4 }} />
                </Field>
                <Field label="Access Key ID">
                  <Input value={s3AccessKey} onChange={(_, data) => setS3AccessKey(data.value)} placeholder={t("s3AccessKeyPlaceholder")} disabled={busy} style={{ marginTop: 4 }} />
                </Field>
                <Field label="Secret Access Key">
                  <Input type="password" value={s3SecretKey} onChange={(_, data) => setS3SecretKey(data.value)} placeholder={editing?.dialect === "s3" && !duplicating ? t("s3KeepSecret") : t("s3SecretKeyPlaceholder")} disabled={busy} style={{ marginTop: 4 }} />
                </Field>
                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("s3CredentialsHint")}</Text>
                <section className="connection-schema-picker">
                  <div className="connection-schema-heading">
                    <div>
                      <Text weight="semibold">{t("s3BucketsToUse")}</Text>
                      <Text size={200} className="connection-schema-summary">{t("s3BucketsSelected").replace("{count}", String(selectedBuckets.length))}</Text>
                    </div>
                    <Button type="button" size="small" onClick={loadBuckets} disabled={busy}>
                      {busy ? t("loading") : t("s3LoadBuckets")}
                    </Button>
                  </div>
                  {availableBuckets === null && displayedBuckets.length === 0 ? (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("s3LoadBucketsHint")}</Text>
                  ) : displayedBuckets.length === 0 ? (
                    <Text size={200}>{t("s3NoBuckets")}</Text>
                  ) : (
                    <div className="connection-schema-list">
                      {displayedBuckets.map((bucket) => (
                        <div className="connection-schema-row" key={bucket}>
                          <Checkbox label={bucket} checked={selectedBuckets.includes(`s3://${bucket}`)} onChange={() => toggleBucket(bucket)} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <div style={{ display: "grid", gap: 8 }}>
                  <Text weight="semibold">{t("ducklakeCatalogs")}</Text>
                  <Text size={200}>{t("ducklakeHint")}</Text>
                  {ducklakeMappings.map((mapping, index) => <div key={index} style={{ display: "grid", gap: 6, padding: 8, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: 6 }}>
                    <Label>{t("ducklakePrefix")}
                      <Input value={mapping.prefix} onChange={(_, data) => setDucklakeMappings((items) => items.map((item, i) => i === index ? { ...item, prefix: data.value } : item))} placeholder="s3://bucket/main/orders" disabled={busy} />
                    </Label>
                    <Label>{t("ducklakeCatalog")}
                      <select aria-label={t("ducklakeCatalogType").replace("{index}", String(index + 1))} value={mapping.kind} disabled={busy}
                        onChange={(event) => setDucklakeMappings((items) => items.map((item, i) => i === index ? { prefix: item.prefix, kind: event.target.value as typeof mapping.kind } : item))}>
                        <option value="postgres">PostgreSQL</option><option value="sqlite">SQLite</option><option value="duckdb">DuckDB</option>
                      </select>
                    </Label>
                    {mapping.kind === "postgres" ? <Label>{t("ducklakePostgresConnection")}
                      <select aria-label={t("ducklakePostgresConnectionNumber").replace("{index}", String(index + 1))} value={mapping.connectionId ?? ""} disabled={busy}
                        onChange={(event) => setDucklakeMappings((items) => items.map((item, i) => i === index ? { ...item, connectionId: event.target.value } : item))}>
                        <option value="">{t("ducklakeSelectConnection")}</option>
                        {postgresConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
                      </select>
                    </Label> : <Label>{t("ducklakeFilePath").replace("{kind}", mapping.kind === "sqlite" ? "SQLite" : "DuckDB")}
                      <Input value={mapping.path ?? ""} onChange={(_, data) => setDucklakeMappings((items) => items.map((item, i) => i === index ? { ...item, path: data.value } : item))} placeholder={t(mapping.kind === "sqlite" ? "ducklakeSqlitePathPlaceholder" : "ducklakeDuckdbPathPlaceholder")} disabled={busy} />
                    </Label>}
                    <Button size="small" appearance="subtle" onClick={() => setDucklakeMappings((items) => items.filter((_, i) => i !== index))} disabled={busy}>{t("ducklakeRemoveCatalog")}</Button>
                  </div>)}
                  <Button size="small" appearance="secondary" disabled={busy} onClick={() => setDucklakeMappings((items) => [...items, { prefix: bucketUris(s3BucketList)[0] ?? "", kind: "postgres" }])}>{t("ducklakeAddCatalog")}</Button>
                </div>
              </>
            )}

            {mode !== "demo" && mode !== "jdbc-generic" && mode !== "odbc" && mode !== "mongodb" && mode !== "s3" && (
              <>
                <div className="omni-connection-host-row">
                  <Field label="Host" style={{ flex: 1 }}>
                    <Input value={host} onChange={(_, data) => setHost(data.value)} placeholder="127.0.0.1" disabled={busy} required style={{ marginTop: 4 }} />
                  </Field>
                  <Field label={t("port")}>
                    <Input value={port} onChange={(_, data) => setPort(data.value)} placeholder={DEFAULT_PORTS[mode]} disabled={busy} required style={{ width: 90, marginTop: 4 }} />
                  </Field>
                </div>
                <Field label={mode === "oracle" ? "Service name / SID" : "Database"}>
                  <Input value={database} onChange={(_, data) => setDatabase(data.value)} placeholder={DEFAULT_DATABASES[mode]} disabled={busy} required style={{ marginTop: 4 }} />
                </Field>
              </>
            )}

            {mode !== "demo" && mode !== "s3" && (
              <>
                <Field label={t("user")}>
                  <Input value={user} onChange={(_, data) => setUser(data.value)} placeholder={DEFAULT_USERS[mode]} disabled={busy} required={mode !== "mongodb"} style={{ marginTop: 4 }} />
                </Field>
                <Field label={t("password")}>
                  <Input type="password" value={password} onChange={(_, data) => setPassword(data.value)} placeholder="••••••" disabled={busy} style={{ marginTop: 4 }} />
                </Field>
                {duplicating && <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{t("duplicateCredentialsHint")}</Text>}
              </>
            )}

            {mode !== "demo" && mode !== "s3" && (
              <>
                {mode !== "jdbc-generic" && mode !== "odbc" && mode !== "mongodb" && (
                  <Checkbox label="SSL require" checked={ssl} onChange={(_, data) => setSsl(data.checked === true)} disabled={busy} />
                )}
                <details className="connection-schema-picker omni-connection-schemas" open={schemasOpen} onToggle={(event) => setSchemasOpen(event.currentTarget.open)}>
                  <summary className="omni-connection-schemas-summary">
                    <span>{t("schemasToIndex")}</span>
                    <span className="connection-schema-summary">
                      {selectedSchemas.size === 0 ? t("noSelectionAllSchemas") : t("schemaSelectionCount").replace("{selected}", String(selectedSchemas.size)).replace("{total}", String(schemaNames.length))}
                    </span>
                    <span className="connection-schema-change">{t("changeSelection")}</span>
                  </summary>
                  <div className="connection-schema-heading">
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
                </details>
              </>
            )}

          </DialogBody>
          <div className="omni-connection-feedback">
            {error && <Text role="alert" style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}
            {testResult && (
              <div role={testResult.ok ? "status" : "alert"} className={`omni-connection-test-banner ${testResult.ok ? "is-ok" : "is-error"}`}>
                <span aria-hidden>●</span>
                <span>{testResult.ok ? `${t("connectionTestSucceeded")} ${testResult.latencyMs}ms` : `${t("failure")}: ${testResult.message ?? t("unknownFailure")}`}</span>
              </div>
            )}
          </div>
          <DialogActions className="omni-dialog-actions omni-connection-actions">
            {mode !== "demo" && (
              <Button type="button" onClick={onTest} disabled={busy || !canConnect()}>
                {busy ? t("loading") : t("testConnection")}
              </Button>
            )}
            <span className="omni-dialog-actions-spacer" />
            <Button type="button" appearance="subtle" onClick={onClose} disabled={busy}>
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
