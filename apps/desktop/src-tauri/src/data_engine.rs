use duckdb::{appender_params_from_iter, types::Value, Connection, InterruptHandle};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader, Seek},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const DEFAULT_MEMORY_LIMIT: &str = "512MB";
const DEFAULT_THREADS: u8 = 2;
const MAX_SNAPSHOT_ROWS: usize = 10_000;
const MAX_SNAPSHOT_BYTES: usize = 32 * 1024 * 1024;
const MAX_CELL_BYTES: usize = 4 * 1024 * 1024;
const MAX_PREVIEW_ROWS: usize = 10_000;
const MAX_PREVIEW_BYTES: usize = 16 * 1024 * 1024;
const MAX_DATASETS: usize = 16;
const MAX_RESULT_HANDLES: usize = 8;
const MAX_DATASET_BYTES: usize = 4 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResultRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub name: String,
    pub columns: Vec<ImportColumn>,
    pub rows: Vec<Vec<JsonValue>>,
    pub rows_more_available: bool,
    pub source_connection_id: Option<String>,
    pub source_sql: Option<String>,
    #[serde(default)]
    pub selection: ImportSelection,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ImportSelection {
    #[default]
    Full,
    FirstN {
        rows: usize,
    },
    Reservoir {
        rows: usize,
        seed: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetRef {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub relation_name: String,
    pub columns: Vec<DatasetColumn>,
    pub row_count: usize,
    pub approximate_bytes: usize,
    pub created_at_ms: u64,
    pub coverage: DatasetCoverage,
    pub selection: ImportSelection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retained_target: Option<usize>,
    pub scanned_rows: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_total: Option<usize>,
    pub source_connection_id: Option<String>,
    pub source_sql: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetColumn {
    pub name: String,
    pub original_name: String,
    pub data_type: String,
    pub source_data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatasetCoverage {
    Complete,
    Sampled,
    Truncated,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub sql: String,
    pub limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStartRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub sql: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPageRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub handle_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultHandleRef {
    pub id: String,
    pub workspace_id: String,
    pub columns: Vec<QueryColumn>,
    pub row_count: usize,
    pub created_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceImportRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub name: String,
    pub connection_id: String,
    pub sql: String,
    pub selection: ImportSelection,
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StreamMessage {
    Batch {
        columns: Vec<ImportColumn>,
        rows: Vec<Vec<JsonValue>>,
    },
    Complete,
    Error { error: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisQueryResult {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<JsonValue>>,
    pub rows_more_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Csv,
    Parquet,
    ArrowIpc,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileFormat {
    Csv,
    Parquet,
    Json,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImportRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub name: String,
    pub path: PathBuf,
    pub format: FileFormat,
    #[serde(default)]
    pub selection: ImportSelection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ImportRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub name: String,
    pub uri: String,
    pub format: S3Format,
    pub table_schema: Option<String>,
    pub table_name: Option<String>,
    pub catalog: Option<DuckLakeCatalog>,
    pub region: String,
    pub endpoint: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    #[serde(default)]
    pub selection: ImportSelection,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum S3Format { Csv, Parquet, Delta, Iceberg, Ducklake }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3QueryRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub uri: String,
    pub format: S3Format,
    pub table_schema: Option<String>,
    pub table_name: Option<String>,
    pub catalog: Option<DuckLakeCatalog>,
    pub region: String,
    pub endpoint: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub sql: String,
    pub limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3CatalogSource {
    pub schema: String,
    pub name: String,
    pub uri: String,
    pub format: S3Format,
    pub table_schema: Option<String>,
    pub table_name: Option<String>,
    pub catalog: Option<DuckLakeCatalog>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3CatalogQueryRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub sources: Vec<S3CatalogSource>,
    pub region: String,
    pub endpoint: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub sql: String,
    pub limit: usize,
}

fn s3_scan_function(format: S3Format) -> &'static str {
    match format {
        S3Format::Csv => "read_csv_auto",
        S3Format::Parquet => "read_parquet",
        S3Format::Delta => "delta_scan",
        S3Format::Iceberg => "iceberg_scan",
        S3Format::Ducklake => "",
    }
}

fn validate_s3_uri(uri: &str) -> Result<(), String> {
    if !uri.starts_with("s3://") || uri.len() > 2048
        || uri[5..].split('/').next().is_none_or(|bucket| bucket.is_empty() || bucket.contains('@'))
        || uri.chars().any(char::is_control) {
        return Err("S3 source must be an s3://bucket/path URI".to_string());
    }
    Ok(())
}

fn ducklake_relation(schema: Option<&str>, table: Option<&str>) -> Result<String, String> {
    let (Some(schema), Some(table)) = (schema, table) else { return Err("DuckLake table is required".into()); };
    if schema.is_empty() || table.is_empty() || schema.len() > 128 || table.len() > 256 || schema.chars().any(char::is_control) || table.chars().any(char::is_control) {
        return Err("invalid DuckLake table".into());
    }
    Ok(format!("{}.{}", quote_identifier(schema), quote_identifier(table)))
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DuckLakeCatalog {
    Postgres { host: String, port: u16, database: String, user: String, password: Option<String> },
    Sqlite { path: String },
    Duckdb { path: String },
}

fn attach_ducklake(remote: &Connection, catalog: &DuckLakeCatalog, alias: &str) -> Result<(), String> {
    let quote = |value: &str| format!("'{}'", value.replace('\'', "''"));
    let attach = match catalog {
        DuckLakeCatalog::Postgres { host, port, database, user, password } => {
            if [host, database, user].iter().any(|value| value.is_empty() || value.len() > 256 || value.chars().any(char::is_control)) {
                return Err("invalid PostgreSQL DuckLake catalog".into());
            }
            remote.execute_batch("INSTALL postgres; LOAD postgres;")
                .map_err(|error| format!("failed to load PostgreSQL support: {error}"))?;
            let secret_name = format!("omni_pg_{alias}");
            let secret = format!("CREATE SECRET {} (TYPE postgres, HOST {}, PORT {}, DATABASE {}, USER {}{})",
                quote_identifier(&secret_name), quote(host), port, quote(database), quote(user), password.as_ref().map_or(String::new(), |value| format!(", PASSWORD {}", quote(value))));
            remote.execute_batch(&secret).map_err(|_| "failed to configure PostgreSQL DuckLake credentials".to_string())?;
            format!("ATTACH 'ducklake:postgres:' AS {} (META_SECRET {}, READ_ONLY, CREATE_IF_NOT_EXISTS false)", quote_identifier(alias), quote_identifier(&secret_name))
        }
        DuckLakeCatalog::Sqlite { path } | DuckLakeCatalog::Duckdb { path } => {
            if path.is_empty() || path.len() > 2048 || path.chars().any(char::is_control) { return Err("invalid DuckLake catalog path".into()); }
            if matches!(catalog, DuckLakeCatalog::Sqlite { .. }) {
                remote.execute_batch("INSTALL sqlite; LOAD sqlite;")
                    .map_err(|error| format!("failed to load SQLite support: {error}"))?;
            }
            let location = if matches!(catalog, DuckLakeCatalog::Sqlite { .. }) { format!("ducklake:sqlite:{path}") } else { format!("ducklake:{path}") };
            format!("ATTACH {} AS {} (READ_ONLY, CREATE_IF_NOT_EXISTS false)", quote(&location), quote_identifier(alias))
        }
    };
    remote.execute_batch(&attach).map_err(|error| format!("failed to attach DuckLake catalog: {error}"))
}

#[derive(Debug, Serialize)]
pub struct DuckLakeTable { pub schema: String, pub name: String, pub uri: String }

pub fn list_ducklake_tables(request: S3ListRequest) -> Result<Vec<DuckLakeTable>, String> {
    let catalog = request.catalog.as_ref().ok_or("DuckLake catalog is required")?;
    let remote = open_s3_reader(&request.uri, S3Format::Ducklake, &request.region, request.endpoint.as_deref(), request.access_key_id.as_deref(), request.secret_access_key.as_deref())?;
    attach_ducklake(&remote, catalog, "omni_lake")?;
    let mut statement = remote.prepare("SELECT table_schema, table_name FROM information_schema.tables WHERE table_catalog = 'omni_lake' AND table_type = 'BASE TABLE' ORDER BY table_schema, table_name LIMIT 500")
        .map_err(|error| format!("failed to inspect DuckLake catalog: {error}"))?;
    let tables = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|error| format!("failed to list DuckLake tables: {error}"))?
        .collect::<Result<Vec<_>, _>>().map_err(|error| format!("failed to read DuckLake tables: {error}"))?;
    let root = request.uri.trim_end_matches('/');
    let relative = request.prefix.trim_matches('/');
    let prefix = if relative.is_empty() { format!("{root}/") } else { format!("{root}/{relative}/") };
    let mut found = Vec::new();
    for (schema, name) in tables {
        let sql = format!("SELECT data_file FROM ducklake_list_files('omni_lake', '{}', schema => '{}') LIMIT 1000", name.replace('\'', "''"), schema.replace('\'', "''"));
        let mut files = remote.prepare(&sql).map_err(|error| format!("failed to inspect DuckLake files: {error}"))?;
        let paths = files.query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("failed to list DuckLake files: {error}"))?;
        for path in paths {
            let path = path.map_err(|error| format!("failed to read DuckLake file: {error}"))?;
            if path.starts_with(&prefix) {
                let uri = path.rsplit_once('/').map_or(path.clone(), |(parent, _)| parent.to_string());
                found.push(DuckLakeTable { schema: schema.clone(), name: name.clone(), uri });
                break;
            }
        }
    }
    Ok(found)
}

fn open_s3_reader(uri: &str, format: S3Format, region: &str, endpoint: Option<&str>, access_key_id: Option<&str>, secret_access_key: Option<&str>) -> Result<Connection, String> {
    let uri = uri.trim();
    validate_s3_uri(uri)?;
    if region.len() > 128 || !region.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid S3 region".to_string());
    }
    if let Some(endpoint) = endpoint {
        if endpoint.len() > 255 || endpoint.chars().any(|c| c.is_control() || c == '\'' || c == ';') {
            return Err("invalid S3 endpoint".to_string());
        }
    }
    let remote = Connection::open_in_memory()
        .map_err(|error| format!("failed to open S3 reader: {error}"))?;
    remote.execute_batch(&format!("SET memory_limit = '{DEFAULT_MEMORY_LIMIT}'; SET threads = {DEFAULT_THREADS};"))
        .map_err(|error| format!("failed to limit S3 reader resources: {error}"))?;
    remote.execute_batch("SET allow_unsigned_extensions = false; INSTALL httpfs; LOAD httpfs; INSTALL aws; LOAD aws;")
        .map_err(|error| format!("failed to load S3 support: {error}"))?;
    if matches!(format, S3Format::Delta | S3Format::Iceberg | S3Format::Ducklake) {
        let extension = match format { S3Format::Delta => "delta", S3Format::Iceberg => "iceberg", _ => "ducklake" };
        remote.execute_batch(&format!("INSTALL {extension}; LOAD {extension};"))
            .map_err(|error| format!("failed to load {extension} support: {error}"))?;
    }
    if access_key_id.is_some() != secret_access_key.is_some() {
        return Err("S3 access key and secret key must be provided together".to_string());
    }
    let mut secret = if let (Some(key), Some(value)) = (access_key_id, secret_access_key) {
        if key.is_empty() || value.is_empty() || key.len() > 1024 || value.len() > 1024
            || key.chars().any(char::is_control) || value.chars().any(char::is_control) {
            return Err("invalid S3 credentials".to_string());
        }
        format!("CREATE SECRET (TYPE s3, PROVIDER config, KEY_ID '{}', SECRET '{}'", key.replace('\'', "''"), value.replace('\'', "''"))
    } else {
        String::from("CREATE SECRET (TYPE s3, PROVIDER credential_chain")
    };
    if !region.is_empty() { secret.push_str(&format!(", REGION '{region}'")); }
    if let Some(endpoint) = endpoint.filter(|value| !value.is_empty()) {
        let (endpoint, ssl) = if let Some(value) = endpoint.strip_prefix("http://") {
            (value, false)
        } else if let Some(value) = endpoint.strip_prefix("https://") {
            (value, true)
        } else { (endpoint, true) };
        secret.push_str(&format!(", ENDPOINT '{endpoint}', USE_SSL {}, URL_STYLE 'path'", if ssl { "true" } else { "false" }));
    }
    secret.push_str(");");
    remote.execute_batch(&secret)
        .map_err(|_| "failed to configure S3 credentials".to_string())?;
    Ok(remote)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ListRequest {
    pub uri: String,
    pub region: String,
    pub endpoint: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub prefix: String,
    pub catalog: Option<DuckLakeCatalog>,
}

pub fn list_s3_objects(request: S3ListRequest) -> Result<Vec<String>, String> {
    if request.prefix.len() > 512 || request.prefix.contains("..") || request.prefix.chars().any(char::is_control)
        || request.prefix.chars().any(|c| matches!(c, '*' | '?' | '[' | ']' | '\'')) {
        return Err("invalid S3 prefix".to_string());
    }
    let root = request.uri.trim().trim_end_matches('/');
    let remote = open_s3_reader(root, S3Format::Parquet, &request.region, request.endpoint.as_deref(), request.access_key_id.as_deref(), request.secret_access_key.as_deref())?;
    let prefix = request.prefix.trim_start_matches('/');
    let pattern = format!("{root}/{prefix}**");
    let mut statement = remote.prepare("SELECT file FROM glob(?) LIMIT 500")
        .map_err(|error| format!("failed to prepare S3 listing: {error}"))?;
    let rows = statement.query_map([pattern], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to list S3 objects: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| format!("failed to read S3 listing: {error}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub operation_id: String,
    pub workspace_id: String,
    pub sql: String,
    pub path: PathBuf,
    pub format: ExportFormat,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: PathBuf,
    pub rows: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationStatus {
    pub operation_id: String,
    pub state: String,
    pub scanned_rows: usize,
    pub retained_rows: usize,
    pub processed_bytes: usize,
    pub started_at_ms: u64,
    pub finished_at_ms: Option<u64>,
}

struct EngineInner {
    connection: Connection,
    datasets: HashMap<String, DatasetRef>,
    result_handles: HashMap<String, (ResultHandleRef, String)>,
}

struct TempDirectory(PathBuf);

#[derive(Clone)]
struct SourceCancellation {
    operation_id: String,
    connection_id: String,
    backend_token: String,
    backend_port: u16,
}

struct RemoteInterruptGuard<'a> {
    slot: &'a Mutex<Option<Arc<InterruptHandle>>>,
}

impl Drop for RemoteInterruptGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.slot.lock() { *slot = None; }
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("failed to clean analytical temporary directory: {error}");
            }
        }
    }
}

/// Process-local analytical engine. The mutex establishes a single connection
/// owner until the dedicated worker/queue is introduced later in M1.
pub struct DataEngine {
    inner: Mutex<EngineInner>,
    interrupt: Arc<InterruptHandle>,
    remote_interrupt: Mutex<Option<Arc<InterruptHandle>>>,
    current_operation: Mutex<Option<String>>,
    operation_status: Mutex<Option<OperationStatus>>,
    source_cancellation: Mutex<Option<SourceCancellation>>,
    cancel_requested: AtomicBool,
    // Declared last so the DuckDB connection is dropped before spill cleanup.
    _temp_directory: TempDirectory,
}

fn persist_dataset(connection: &Connection, dataset: &DatasetRef) -> Result<(), String> {
    let metadata = serde_json::to_string(dataset)
        .map_err(|error| format!("failed to serialize DuckDB dataset: {error}"))?;
    connection.execute("INSERT OR REPLACE INTO omni_local_dataset_registry (id, metadata) VALUES (?, ?)",
        duckdb::params![dataset.id, metadata])
        .map_err(|error| format!("failed to save DuckDB dataset: {error}"))?;
    Ok(())
}

impl DataEngine {
    pub fn open_in_memory() -> Result<Self, String> {
        Self::open_at(None)
    }

    pub fn open_persistent(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| format!("failed to create DuckDB data directory: {error}"))?;
        }
        Self::open_at(Some(path))
    }

    fn open_at(path: Option<&Path>) -> Result<Self, String> {
        let temp_directory = TempDirectory(create_temp_directory()?);
        let connection = match path { Some(path) => Connection::open(path), None => Connection::open_in_memory() }
            .map_err(|error| format!("failed to open the DuckDB data engine: {error}"))?;
        initialize_connection(&connection, &temp_directory.0)?;
        connection.execute_batch("CREATE TABLE IF NOT EXISTS omni_local_dataset_registry (id VARCHAR PRIMARY KEY, metadata VARCHAR NOT NULL)")
            .map_err(|error| format!("failed to initialize DuckDB dataset registry: {error}"))?;
        let datasets = {
            let mut statement = connection.prepare("SELECT metadata FROM omni_local_dataset_registry")
                .map_err(|error| format!("failed to read DuckDB dataset registry: {error}"))?;
            statement.query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| format!("failed to list DuckDB datasets: {error}"))?
                .map(|row| row.map_err(|error| error.to_string()).and_then(|json| serde_json::from_str::<DatasetRef>(&json).map_err(|error| error.to_string())))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter().map(|dataset| (dataset.id.clone(), dataset)).collect()
        };
        let interrupt = connection.interrupt_handle();
        Ok(Self {
            inner: Mutex::new(EngineInner {
                connection,
                datasets,
                result_handles: HashMap::new(),
            }),
            interrupt,
            remote_interrupt: Mutex::new(None),
            current_operation: Mutex::new(None),
            operation_status: Mutex::new(None),
            source_cancellation: Mutex::new(None),
            cancel_requested: AtomicBool::new(false),
            _temp_directory: temp_directory,
        })
    }

    pub fn smoke_query(&self) -> Result<i64, String> {
        let inner = self.lock()?;
        inner
            .connection
            .query_row("SELECT 1", [], |row| row.get(0))
            .map_err(|error| format!("DuckDB smoke query failed: {error}"))
    }

    pub fn import_result(&self, request: ImportResultRequest) -> Result<DatasetRef, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || self.import_result_inner(request))
    }

    fn import_result_inner(&self, request: ImportResultRequest) -> Result<DatasetRef, String> {
        validate_import(&request)?;
        let selected_rows = select_rows(&request.rows, &request.selection)?;
        let approximate_bytes = serde_json::to_vec(&selected_rows)
            .map_err(|error| format!("failed to measure snapshot: {error}"))?
            .len();
        if approximate_bytes > MAX_SNAPSHOT_BYTES {
            return Err(format!(
                "snapshot exceeds the {} byte analytical import limit",
                MAX_SNAPSHOT_BYTES
            ));
        }

        let id = random_id()?;
        let columns = normalize_columns(&request.columns)?;
        let mut inner = self.lock()?;
        ensure_dataset_capacity(&inner)?;
        let relation_name = available_relation_name(&inner, &request.name, None);
        let create_sql = format!(
            "CREATE {}TABLE {} ({})",
            if request.workspace_id == "federated" { "TEMP " } else { "" },
            quote_identifier(&relation_name),
            columns
                .iter()
                .map(|column| format!("{} {}", quote_identifier(&column.name), column.data_type))
                .collect::<Vec<_>>()
                .join(", ")
        );

        let transaction = inner
            .connection
            .transaction()
            .map_err(|error| format!("failed to start snapshot import: {error}"))?;
        transaction
            .execute_batch(&create_sql)
            .map_err(|error| format!("failed to create analytical dataset: {error}"))?;
        {
            let mut appender = transaction
                .appender(&relation_name)
                .map_err(|error| format!("failed to open dataset appender: {error}"))?;
            for (row_index, row) in selected_rows.iter().enumerate() {
                let values = row
                    .iter()
                    .zip(columns.iter())
                    .enumerate()
                    .map(|(column_index, (value, column))| {
                        json_to_duckdb(value, &column.data_type).map_err(|error| {
                            format!(
                                "row {}, column {}: {error}",
                                row_index + 1,
                                column_index + 1
                            )
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                appender
                    .append_row(appender_params_from_iter(values.iter()))
                    .map_err(|error| {
                        format!("row {}: snapshot append failed: {error}", row_index + 1)
                    })?;
            }
            appender
                .flush()
                .map_err(|error| format!("snapshot flush failed: {error}"))?;
        }
        let dataset = DatasetRef {
            id: id.clone(),
            workspace_id: request.workspace_id,
            name: request.name,
            relation_name,
            columns,
            row_count: selected_rows.len(),
            approximate_bytes,
            created_at_ms: now_ms()?,
            coverage: match &request.selection {
                ImportSelection::Full if request.rows_more_available => DatasetCoverage::Truncated,
                ImportSelection::Full => DatasetCoverage::Complete,
                ImportSelection::FirstN { .. } | ImportSelection::Reservoir { .. } => {
                    DatasetCoverage::Sampled
                }
            },
            selection: request.selection.clone(),
            retained_target: selection_target(&request.selection),
            scanned_rows: request.rows.len(),
            source_total: (!request.rows_more_available).then_some(request.rows.len()),
            source_connection_id: request.source_connection_id,
            source_sql: request.source_sql,
            source_uri: None,
        };
        if dataset.workspace_id != "federated" { persist_dataset(&transaction, &dataset)?; }
        transaction.commit().map_err(|error| format!("snapshot commit failed: {error}"))?;
        inner.datasets.insert(id, dataset.clone());
        Ok(dataset)
    }

    pub fn import_source(
        &self,
        request: SourceImportRequest,
        backend_token: &str,
        backend_port: u16,
    ) -> Result<DatasetRef, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id.clone(), || {
            *self.source_cancellation.lock()
                .map_err(|_| "source cancellation lock is poisoned".to_string())? = Some(SourceCancellation {
                    operation_id: operation_id.clone(),
                    connection_id: request.connection_id.clone(),
                    backend_token: backend_token.to_string(),
                    backend_port,
                });
            let result = self.import_source_inner(request, backend_token, backend_port);
            if let Ok(mut cancellation) = self.source_cancellation.lock() {
                if cancellation.as_ref().is_some_and(|value| value.operation_id == operation_id) {
                    *cancellation = None;
                }
            }
            result
        })
    }

    fn import_source_inner(
        &self,
        request: SourceImportRequest,
        backend_token: &str,
        backend_port: u16,
    ) -> Result<DatasetRef, String> {
        validate_workspace_id(&request.workspace_id)?;
        if request.name.trim().is_empty() || request.name.len() > 128 {
            return Err("dataset name must contain between 1 and 128 characters".to_string());
        }
        if request.connection_id.is_empty() || request.sql.trim().is_empty() {
            return Err("source connection and SQL are required".to_string());
        }
        if request.batch_size == 0 || request.batch_size > 10_000 {
            return Err("batch size must be between 1 and 10000".to_string());
        }
        validate_selection(&request.selection)?;

        let response = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(60 * 60))
            .build()
            .map_err(|error| format!("failed to create analytical stream client: {error}"))?
            .post(format!("http://127.0.0.1:{backend_port}/analysis/stream"))
            .bearer_auth(backend_token)
            .json(&serde_json::json!({
                "connectionId": request.connection_id,
                "sql": request.sql,
                "batchSize": request.batch_size,
            }))
            .send()
            .map_err(|error| format!("failed to start analytical source stream: {error}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let detail = response.json::<serde_json::Value>().ok()
                .and_then(|body| body.get("error").and_then(|value| value.as_str()).map(str::to_owned));
            return Err(detail.unwrap_or_else(|| format!("analytical source stream failed with HTTP {status}")));
        }

        let mut reader = BufReader::new(response);
        let (source_columns, first_rows) = match read_stream_message(&mut reader)? {
            Some(StreamMessage::Batch { columns, rows }) => (columns, rows),
            Some(StreamMessage::Complete) | None => {
                return Err("analytical source returned no schema".to_string())
            }
            Some(StreamMessage::Error { error }) => {
                return Err(format!("analytical source failed: {error}"))
            }
        };
        let columns = normalize_columns(&source_columns)?;
        let id = random_id()?;
        let mut inner = self.lock()?;
        ensure_dataset_capacity(&inner)?;
        let relation_name = available_relation_name(&inner, &request.name, None);
        let create_sql = format!(
            "CREATE {}TABLE {} ({})",
            if request.workspace_id == "federated" { "TEMP " } else { "" },
            quote_identifier(&relation_name),
            columns
                .iter()
                .map(|column| format!("{} {}", quote_identifier(&column.name), column.data_type))
                .collect::<Vec<_>>()
                .join(", ")
        );

        let transaction = inner.connection.transaction()
            .map_err(|error| format!("failed to start source import: {error}"))?;
        transaction.execute_batch(&create_sql)
            .map_err(|error| format!("failed to create analytical dataset: {error}"))?;

        let mut row_count = 0_usize;
        let mut approximate_bytes = 0_usize;
        let mut scanned_bytes = 0_usize;
        let mut scanned_rows = 0_usize;
        let mut reservoir = Vec::<Vec<JsonValue>>::new();
        let mut random_state = match &request.selection {
            ImportSelection::Reservoir { seed, .. } => (*seed).max(1),
            _ => 1,
        };
        let mut stream_complete = false;
        {
            let mut appender = transaction.appender(&relation_name)
                .map_err(|error| format!("failed to open source dataset appender: {error}"))?;
            let mut pending_rows = Some(first_rows);
            loop {
                if self.cancel_requested.load(Ordering::Acquire) {
                    return Err("analytical source import cancelled".to_string());
                }
                let rows = if let Some(rows) = pending_rows.take() {
                    rows
                } else {
                    match read_stream_message(&mut reader)? {
                        Some(StreamMessage::Batch { columns: next_columns, rows }) => {
                            if !same_schema(&source_columns, &next_columns) {
                                return Err("analytical source schema changed during ingestion".to_string());
                            }
                            rows
                        }
                        Some(StreamMessage::Complete) => {
                            stream_complete = true;
                            break;
                        }
                        Some(StreamMessage::Error { error }) => {
                            return Err(format!("analytical source failed: {error}"));
                        }
                        None => break,
                    }
                };

                for row in rows {
                    scanned_rows += 1;
                    validate_stream_row(&row, columns.len(), scanned_rows)?;
                    let row_bytes = measure_row(&row)?;
                    scanned_bytes = scanned_bytes.saturating_add(row_bytes);
                    match &request.selection {
                        ImportSelection::Full => {
                            approximate_bytes = approximate_bytes.saturating_add(row_bytes);
                            append_row(&mut appender, &row, &columns, scanned_rows)?;
                            row_count += 1;
                        }
                        ImportSelection::FirstN { rows: limit } => {
                            if row_count < *limit {
                                approximate_bytes = approximate_bytes.saturating_add(row_bytes);
                                append_row(&mut appender, &row, &columns, scanned_rows)?;
                                row_count += 1;
                            }
                            if row_count == *limit {
                                stream_complete = true;
                                break;
                            }
                        }
                        ImportSelection::Reservoir { rows: limit, .. } => {
                            if reservoir.len() < *limit {
                                reservoir.push(row);
                            } else {
                                random_state ^= random_state << 13;
                                random_state ^= random_state >> 7;
                                random_state ^= random_state << 17;
                                let selected = (random_state % scanned_rows as u64) as usize;
                                if selected < *limit {
                                    reservoir[selected] = row;
                                }
                            }
                        }
                    }
                    if approximate_bytes > MAX_DATASET_BYTES {
                        return Err(format!("analytical source exceeds the {MAX_DATASET_BYTES} byte dataset budget"));
                    }
                }
                self.update_progress(scanned_rows, match &request.selection {
                    ImportSelection::Reservoir { .. } => reservoir.len(),
                    _ => row_count,
                }, scanned_bytes);
                if matches!(&request.selection, ImportSelection::FirstN { rows: limit } if row_count == *limit) {
                    break;
                }
            }
            if !stream_complete {
                return Err("analytical source stream ended before completion".to_string());
            }
            if matches!(&request.selection, ImportSelection::Reservoir { .. }) {
                for (index, row) in reservoir.iter().enumerate() {
                    approximate_bytes = approximate_bytes.saturating_add(measure_row(row)?);
                    if approximate_bytes > MAX_DATASET_BYTES {
                        return Err(format!("analytical source sample exceeds the {MAX_DATASET_BYTES} byte dataset budget"));
                    }
                    append_row(&mut appender, row, &columns, index + 1)?;
                }
                row_count = reservoir.len();
            }
            appender.flush()
                .map_err(|error| format!("source dataset flush failed: {error}"))?;
        }
        let dataset = DatasetRef {
            id: id.clone(),
            workspace_id: request.workspace_id,
            name: request.name,
            relation_name,
            columns,
            row_count,
            approximate_bytes,
            created_at_ms: now_ms()?,
            coverage: match &request.selection {
                ImportSelection::Full => DatasetCoverage::Complete,
                ImportSelection::FirstN { .. } | ImportSelection::Reservoir { .. } => DatasetCoverage::Sampled,
            },
            selection: request.selection.clone(),
            retained_target: selection_target(&request.selection),
            scanned_rows,
            source_total: matches!(&request.selection, ImportSelection::Full | ImportSelection::Reservoir { .. }).then_some(scanned_rows),
            source_connection_id: Some(request.connection_id),
            source_sql: Some(request.sql),
            source_uri: None,
        };
        if dataset.workspace_id != "federated" { persist_dataset(&transaction, &dataset)?; }
        transaction.commit().map_err(|error| format!("source dataset commit failed: {error}"))?;
        inner.datasets.insert(id, dataset.clone());
        Ok(dataset)
    }

    pub fn list_datasets(&self, workspace_id: &str) -> Result<Vec<DatasetRef>, String> {
        validate_workspace_id(workspace_id)?;
        let inner = self.lock()?;
        let mut datasets = inner
            .datasets
            .values()
            .filter(|dataset| dataset.workspace_id == workspace_id)
            .cloned()
            .collect::<Vec<_>>();
        datasets.sort_by_key(|dataset| dataset.created_at_ms);
        Ok(datasets)
    }

    pub fn rename_dataset(&self, workspace_id: &str, dataset_id: &str, name: &str) -> Result<DatasetRef, String> {
        validate_workspace_id(workspace_id)?;
        let name = name.trim();
        if name.is_empty() { return Err("dataset name cannot be empty".to_string()); }
        if name.chars().count() > 128 { return Err("dataset name cannot exceed 128 characters".to_string()); }
        let mut inner = self.lock()?;
        let dataset = inner.datasets.get(dataset_id)
            .ok_or_else(|| "analytical dataset was not found".to_string())?;
        if dataset.workspace_id != workspace_id { return Err("dataset does not belong to this workspace".to_string()); }
        let old_relation_name = dataset.relation_name.clone();
        let relation_name = available_relation_name(&inner, name, Some(dataset_id));
        let mut updated = dataset.clone();
        updated.name = name.to_string();
        updated.relation_name = relation_name.clone();
        let transaction = inner.connection.transaction()
            .map_err(|error| format!("failed to start dataset rename: {error}"))?;
        if relation_name != old_relation_name {
            transaction.execute_batch(&format!(
                "ALTER TABLE {} RENAME TO {}", quote_identifier(&old_relation_name), quote_identifier(&relation_name)
            )).map_err(|error| format!("failed to rename analytical dataset: {error}"))?;
        }
        if workspace_id != "federated" { persist_dataset(&transaction, &updated)?; }
        transaction.commit().map_err(|error| format!("failed to commit dataset rename: {error}"))?;
        inner.datasets.insert(dataset_id.to_string(), updated.clone());
        Ok(updated)
    }

    pub fn drop_dataset(&self, workspace_id: &str, dataset_id: &str) -> Result<bool, String> {
        validate_workspace_id(workspace_id)?;
        let mut inner = self.lock()?;
        let Some(dataset) = inner.datasets.get(dataset_id) else {
            return Ok(false);
        };
        if dataset.workspace_id != workspace_id {
            return Err("dataset does not belong to this workspace".to_string());
        }
        let relation_name = dataset.relation_name.clone();
        let transaction = inner.connection.transaction()
            .map_err(|error| format!("failed to start dataset deletion: {error}"))?;
        transaction.execute_batch(&format!("DROP TABLE {}", quote_identifier(&relation_name)))
            .map_err(|error| format!("failed to drop analytical dataset: {error}"))?;
        transaction.execute("DELETE FROM omni_local_dataset_registry WHERE id = ?", [dataset_id])
            .map_err(|error| format!("failed to update DuckDB dataset registry: {error}"))?;
        transaction.commit().map_err(|error| format!("failed to commit dataset deletion: {error}"))?;
        inner.datasets.remove(dataset_id);
        Ok(true)
    }

    pub fn clear(&self, workspace_id: &str) -> Result<usize, String> {
        validate_workspace_id(workspace_id)?;
        let mut inner = self.lock()?;
        let datasets = inner.datasets.values()
            .filter(|dataset| dataset.workspace_id == workspace_id)
            .map(|dataset| (dataset.id.clone(), dataset.relation_name.clone()))
            .collect::<Vec<_>>();
        let handles = inner.result_handles.values()
            .filter(|(handle, _)| handle.workspace_id == workspace_id)
            .map(|(_, relation_name)| relation_name.clone())
            .collect::<Vec<_>>();
        let transaction = inner.connection.transaction()
            .map_err(|error| format!("failed to start analytical workspace clear: {error}"))?;
        for (id, relation_name) in &datasets {
            transaction.execute_batch(&format!("DROP TABLE {}", quote_identifier(relation_name)))
                .map_err(|error| format!("failed to clear analytical dataset: {error}"))?;
            transaction.execute("DELETE FROM omni_local_dataset_registry WHERE id = ?", [id])
                .map_err(|error| format!("failed to clear DuckDB dataset registry: {error}"))?;
        }
        for relation_name in &handles {
            transaction.execute_batch(&format!("DROP TABLE {}", quote_identifier(relation_name)))
                .map_err(|error| format!("failed to clear analytical result: {error}"))?;
        }
        transaction.commit().map_err(|error| format!("failed to commit analytical workspace clear: {error}"))?;
        inner.datasets.retain(|_, dataset| dataset.workspace_id != workspace_id);
        inner.result_handles.retain(|_, (handle, _)| handle.workspace_id != workspace_id);
        Ok(datasets.len() + handles.len())
    }

    pub fn query(&self, request: QueryRequest) -> Result<AnalysisQueryResult, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || self.query_inner(request))
    }

    pub fn start_query(&self, request: QueryStartRequest) -> Result<ResultHandleRef, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || self.start_query_inner(request))
    }

    fn start_query_inner(&self, request: QueryStartRequest) -> Result<ResultHandleRef, String> {
        validate_workspace_id(&request.workspace_id)?;
        let sql = validate_read_only_sql(&request.sql)?;
        let id = random_id()?;
        let relation_name = format!("result_{}", id.replace('-', ""));
        let mut inner = self.lock()?;
        ensure_workspace_relations(&inner, &request.workspace_id, sql)?;
        if inner.result_handles.len() >= MAX_RESULT_HANDLES {
            return Err(format!("analytical engine reached the {MAX_RESULT_HANDLES} stable result handle limit"));
        }
        let transaction = inner.connection.transaction()
            .map_err(|error| format!("failed to start stable analytical query: {error}"))?;
        transaction.execute_batch(&format!("CREATE TEMP TABLE {} AS {sql}", quote_identifier(&relation_name)))
            .map_err(|error| format!("stable analytical query failed: {error}"))?;
        let row_count: usize = transaction.query_row(
            &format!("SELECT count(*) FROM {}", quote_identifier(&relation_name)), [], |row| row.get::<_, i64>(0)
        ).map_err(|error| format!("failed to count stable analytical result: {error}"))?
            .try_into().map_err(|_| "stable analytical result row count overflowed".to_string())?;
        let columns = relation_query_columns(&transaction, &relation_name)?;
        transaction.commit().map_err(|error| format!("failed to publish stable analytical result: {error}"))?;
        let handle = ResultHandleRef { id: id.clone(), workspace_id: request.workspace_id, columns, row_count, created_at_ms: now_ms()? };
        inner.result_handles.insert(id, (handle.clone(), relation_name));
        Ok(handle)
    }

    pub fn query_page(&self, request: QueryPageRequest) -> Result<AnalysisQueryResult, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || {
            validate_workspace_id(&request.workspace_id)?;
            if request.limit == 0 || request.limit > MAX_PREVIEW_ROWS {
                return Err(format!("page limit must be between 1 and {MAX_PREVIEW_ROWS}"));
            }
            let relation_name = {
                let inner = self.lock()?;
                let (handle, relation_name) = inner.result_handles.get(&request.handle_id)
                    .ok_or_else(|| "stable analytical result handle was not found".to_string())?;
                if handle.workspace_id != request.workspace_id {
                    return Err("stable analytical result belongs to another workspace".to_string());
                }
                relation_name.clone()
            };
            self.query_inner(QueryRequest {
                operation_id: request.operation_id,
                workspace_id: request.workspace_id,
                sql: format!("SELECT * FROM {} LIMIT {} OFFSET {}", quote_identifier(&relation_name), request.limit + 1, request.offset),
                limit: request.limit,
            })
        })
    }

    pub fn drop_result_handle(&self, workspace_id: &str, handle_id: &str) -> Result<bool, String> {
        validate_workspace_id(workspace_id)?;
        let mut inner = self.lock()?;
        let Some((handle, relation_name)) = inner.result_handles.get(handle_id) else { return Ok(false) };
        if handle.workspace_id != workspace_id {
            return Err("stable analytical result belongs to another workspace".to_string());
        }
        let relation_name = relation_name.clone();
        inner.connection.execute_batch(&format!("DROP TABLE {}", quote_identifier(&relation_name)))
            .map_err(|error| format!("failed to drop stable analytical result: {error}"))?;
        inner.result_handles.remove(handle_id);
        Ok(true)
    }

    pub fn export_query(&self, request: ExportRequest) -> Result<ExportResult, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || self.export_query_inner(request))
    }

    pub fn import_file(&self, request: FileImportRequest) -> Result<DatasetRef, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || self.import_file_inner(request))
    }

    pub fn import_s3(&self, request: S3ImportRequest) -> Result<DatasetRef, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || self.import_s3_inner(request))
    }

    pub fn query_s3(&self, request: S3QueryRequest) -> Result<AnalysisQueryResult, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || {
            validate_workspace_id(&request.workspace_id)?;
            if request.limit == 0 || request.limit > MAX_PREVIEW_ROWS {
                return Err(format!("preview limit must be between 1 and {MAX_PREVIEW_ROWS}"));
            }
            let sql = validate_s3_sql(&request.sql)?;
            let remote = open_s3_reader(&request.uri, request.format, &request.region, request.endpoint.as_deref(), request.access_key_id.as_deref(), request.secret_access_key.as_deref())?;
            let _remote_guard = self.arm_remote_interrupt(&remote)?;
            let relation = if matches!(request.format, S3Format::Ducklake) {
                attach_ducklake(&remote, request.catalog.as_ref().ok_or("DuckLake catalog is required")?, "omni_lake")?;
                format!("omni_lake.{}", ducklake_relation(request.table_schema.as_deref(), request.table_name.as_deref())?)
            } else {
                format!("{}('{}')", s3_scan_function(request.format), request.uri.trim().replace('\'', "''"))
            };
            remote.execute_batch(&format!("CREATE VIEW s3_source AS SELECT * FROM {relation}"))
                .map_err(|error| format!("failed to open S3 source: {error}"))?;
            remote.execute_batch("SET autoload_known_extensions = false; SET autoinstall_known_extensions = false; SET disabled_filesystems = 'LocalFileSystem'; SET lock_configuration = true;")
                .map_err(|error| format!("failed to restrict S3 reader: {error}"))?;
            // The editor can refer to the registered view, but cannot invoke file readers.
            Self::query_preview(&remote, sql, request.limit)
        })
    }

    pub fn query_s3_catalog(&self, request: S3CatalogQueryRequest) -> Result<AnalysisQueryResult, String> {
        let operation_id = request.operation_id.clone();
        self.run_operation(operation_id, || {
            validate_workspace_id(&request.workspace_id)?;
            if request.sources.is_empty() || request.sources.len() > 500 {
                return Err("S3 catalog must contain between 1 and 500 sources".to_string());
            }
            if request.limit == 0 || request.limit > MAX_PREVIEW_ROWS {
                return Err(format!("preview limit must be between 1 and {MAX_PREVIEW_ROWS}"));
            }
            let sql = validate_s3_sql(&request.sql)?;
            let first = &request.sources[0];
            let remote = open_s3_reader(&first.uri, S3Format::Parquet, &request.region, request.endpoint.as_deref(), request.access_key_id.as_deref(), request.secret_access_key.as_deref())?;
            let _remote_guard = self.arm_remote_interrupt(&remote)?;
            if request.sources.iter().any(|source| matches!(source.format, S3Format::Delta)) {
                remote.execute_batch("INSTALL delta; LOAD delta;").map_err(|error| format!("failed to load Delta support: {error}"))?;
            }
            if request.sources.iter().any(|source| matches!(source.format, S3Format::Iceberg)) {
                remote.execute_batch("INSTALL iceberg; LOAD iceberg;").map_err(|error| format!("failed to load Iceberg support: {error}"))?;
            }
            if request.sources.iter().any(|source| matches!(source.format, S3Format::Ducklake)) {
                remote.execute_batch("INSTALL ducklake; LOAD ducklake;").map_err(|error| format!("failed to load DuckLake support: {error}"))?;
            }
            let mut schemas = HashSet::new();
            let mut attached_catalogs = HashMap::<String, String>::new();
            for source in &request.sources {
                if source.schema.is_empty() || source.name.is_empty() || source.schema.len() > 128 || source.name.len() > 256 {
                    return Err("invalid S3 catalog source".to_string());
                }
                validate_s3_uri(&source.uri)?;
                if schemas.insert(source.schema.clone()) {
                    remote.execute_batch(&format!("CREATE SCHEMA {}", quote_identifier(&source.schema)))
                        .map_err(|error| format!("failed to create S3 schema: {error}"))?;
                }
                let relation = if matches!(source.format, S3Format::Ducklake) {
                    let catalog = source.catalog.as_ref().ok_or("DuckLake catalog is required")?;
                    let key = serde_json::to_string(catalog).map_err(|_| "invalid DuckLake catalog")?;
                    let alias = if let Some(alias) = attached_catalogs.get(&key) { alias.clone() } else {
                        let alias = format!("omni_lake_{}", attached_catalogs.len());
                        attach_ducklake(&remote, catalog, &alias)?;
                        attached_catalogs.insert(key, alias.clone());
                        alias
                    };
                    format!("{}.{}", quote_identifier(&alias), ducklake_relation(source.table_schema.as_deref(), source.table_name.as_deref())?)
                } else {
                    format!("{}('{}')", s3_scan_function(source.format), source.uri.replace('\'', "''"))
                };
                let statement = format!("CREATE VIEW {}.{} AS SELECT * FROM {relation}", quote_identifier(&source.schema), quote_identifier(&source.name));
                remote.execute_batch(&statement)
                    .map_err(|error| format!("failed to register S3 source: {error}"))?;
            }
            let normalized_sql = sql.to_ascii_lowercase();
            let local_datasets = {
                let inner = self.lock()?;
                inner.datasets.values()
                    .filter(|dataset| dataset.workspace_id == "local-duckdb" || dataset.workspace_id == "federated")
                    .filter(|dataset| {
                        let name = dataset.relation_name.to_ascii_lowercase();
                        [
                            format!("local.{name}"),
                            format!("local.{}", quote_identifier(&name)),
                            format!("\"local\".{name}"),
                            format!("\"local\".{}", quote_identifier(&name)),
                        ].iter().any(|reference| normalized_sql.contains(reference))
                    })
                    .map(|dataset| (dataset.relation_name.clone(), dataset.workspace_id.clone()))
                    .collect::<Vec<_>>()
            };
            if !local_datasets.is_empty() {
                remote.execute_batch("LOAD parquet")
                    .map_err(|error| format!("failed to load Parquet for local join: {error}"))?;
                remote.execute_batch("CREATE SCHEMA local")
                    .map_err(|error| format!("failed to create local schema: {error}"))?;
            }
            for (relation_name, workspace_id) in local_datasets {
                let temporary_path = self._temp_directory.0.join(format!("{}.parquet", random_id()?));
                let escaped_path = temporary_path.to_string_lossy().replace('\'', "''");
                let export_result = self.export_query_inner(ExportRequest {
                    operation_id: request.operation_id.clone(),
                    workspace_id,
                    sql: format!("SELECT * FROM {}", quote_identifier(&relation_name)),
                    path: temporary_path.clone(),
                    format: ExportFormat::Parquet,
                });
                if let Err(error) = export_result {
                    let _ = std::fs::remove_file(&temporary_path);
                    return Err(format!("failed to stage local dataset for S3 join: {error}"));
                }
                let staged_bytes = match std::fs::metadata(&temporary_path) {
                    Ok(metadata) => metadata.len(),
                    Err(error) => {
                        let _ = std::fs::remove_file(&temporary_path);
                        return Err(format!("failed to inspect local join staging: {error}"));
                    }
                };
                if staged_bytes > MAX_DATASET_BYTES as u64 {
                    let _ = std::fs::remove_file(&temporary_path);
                    return Err(format!("local join staging exceeds the {MAX_DATASET_BYTES} byte dataset budget"));
                }
                let stage_result = remote.execute_batch(&format!(
                    "CREATE TABLE local.{} AS SELECT * FROM read_parquet('{}')",
                    quote_identifier(&relation_name), escaped_path
                ));
                let _ = std::fs::remove_file(&temporary_path);
                stage_result.map_err(|error| format!("failed to stage local dataset for S3 join: {error}"))?;
            }
            remote.execute_batch("SET autoload_known_extensions = false; SET autoinstall_known_extensions = false; SET disabled_filesystems = 'LocalFileSystem'; SET lock_configuration = true;")
                .map_err(|error| format!("failed to restrict S3 reader: {error}"))?;
            Self::query_preview(&remote, sql, request.limit)
        })
    }

    fn import_s3_inner(&self, request: S3ImportRequest) -> Result<DatasetRef, String> {
        validate_workspace_id(&request.workspace_id)?;
        validate_selection(&request.selection)?;
        let uri = request.uri.trim();
        let escaped_uri = uri.replace('\'', "''");
        let remote = open_s3_reader(uri, request.format, &request.region, request.endpoint.as_deref(), request.access_key_id.as_deref(), request.secret_access_key.as_deref())?;
        let _remote_guard = self.arm_remote_interrupt(&remote)?;
        let relation = if matches!(request.format, S3Format::Ducklake) {
            attach_ducklake(&remote, request.catalog.as_ref().ok_or("DuckLake catalog is required")?, "omni_lake")?;
            format!("omni_lake.{}", ducklake_relation(request.table_schema.as_deref(), request.table_name.as_deref())?)
        } else {
            format!("{}('{escaped_uri}')", s3_scan_function(request.format))
        };
        let temporary_path = self._temp_directory.0.join(format!("{}.parquet", random_id()?));
        let escaped_path = temporary_path.to_string_lossy().replace('\'', "''");
        let limit = match &request.selection {
            ImportSelection::FirstN { rows } => format!(" LIMIT {rows}"),
            _ => String::new(),
        };
        let copy = format!("COPY (SELECT * FROM {relation}{limit}) TO '{escaped_path}' (FORMAT PARQUET)");
        let result = remote.execute_batch(&copy)
            .map_err(|error| format!("failed to read S3 source: {error}"));
        if let Err(error) = result { let _ = std::fs::remove_file(&temporary_path); return Err(error); }
        let staged_bytes = match std::fs::metadata(&temporary_path) {
            Ok(metadata) => metadata.len(),
            Err(error) => {
                let _ = std::fs::remove_file(&temporary_path);
                return Err(format!("failed to inspect staged S3 source: {error}"));
            }
        };
        if staged_bytes > MAX_DATASET_BYTES as u64 {
            let _ = std::fs::remove_file(&temporary_path);
            return Err(format!("staged S3 source exceeds the {MAX_DATASET_BYTES} byte dataset budget"));
        }
        drop(_remote_guard);
        drop(remote);
        let imported = self.import_file_with_origin(FileImportRequest {
            operation_id: request.operation_id,
            workspace_id: request.workspace_id,
            name: request.name,
            path: temporary_path.clone(),
            format: FileFormat::Parquet,
            selection: request.selection,
        }, Some(uri.to_string()));
        let _ = std::fs::remove_file(&temporary_path);
        imported
    }

    fn import_file_inner(&self, request: FileImportRequest) -> Result<DatasetRef, String> {
        let source_uri = Some(request.path.to_string_lossy().into_owned());
        self.import_file_with_origin(request, source_uri)
    }

    fn import_file_with_origin(&self, request: FileImportRequest, source_uri: Option<String>) -> Result<DatasetRef, String> {
        validate_workspace_id(&request.workspace_id)?;
        if request.name.trim().is_empty() || request.name.len() > 128 {
            return Err("dataset name must contain between 1 and 128 characters".to_string());
        }
        validate_selection(&request.selection)?;
        validate_import_path(&request.path, request.format)?;
        if matches!(request.format, FileFormat::Json) {
            return self.import_json_file_inner(request);
        }
        let (schema, mut batches) = open_file_batches(&request.path, request.format)?;
        if schema.fields().is_empty() || schema.fields().len() > 1024 {
            return Err("analytical file must contain between 1 and 1024 columns".to_string());
        }
        let columns = normalize_arrow_columns(schema.fields())?;
        let id = random_id()?;
        let mut inner = self.lock()?;
        ensure_dataset_capacity(&inner)?;
        let relation_name = available_relation_name(&inner, &request.name, None);
        let create_sql = format!(
            "CREATE {}TABLE {} ({})",
            if request.workspace_id == "federated" { "TEMP " } else { "" },
            quote_identifier(&relation_name),
            columns.iter().map(|column| format!("{} {}", quote_identifier(&column.name), column.data_type)).collect::<Vec<_>>().join(", ")
        );
        let transaction = inner.connection.transaction()
            .map_err(|error| format!("failed to start analytical file import: {error}"))?;
        transaction.execute_batch(&create_sql)
            .map_err(|error| format!("failed to create file dataset: {error}"))?;
        let mut row_count = 0_usize;
        let mut approximate_bytes = 0_usize;
        let mut scanned_bytes = 0_usize;
        let mut scanned_rows = 0_usize;
        {
            let mut appender = transaction.appender(&relation_name)
                .map_err(|error| format!("failed to open file dataset appender: {error}"))?;
            let mut reservoir = Vec::new();
            let mut random_state = match &request.selection {
                ImportSelection::Reservoir { seed, .. } => (*seed).max(1),
                _ => 1,
            };
            'batches: for batch_result in batches.by_ref() {
                let batch = batch_result?;
                if self.cancel_requested.load(Ordering::Acquire) {
                    return Err("analytical file import cancelled".to_string());
                }
                scanned_rows = scanned_rows.saturating_add(batch.num_rows());
                scanned_bytes = scanned_bytes.saturating_add(batch.get_array_memory_size());
                match &request.selection {
                    ImportSelection::Full => {
                        approximate_bytes = approximate_bytes.saturating_add(batch.get_array_memory_size());
                        row_count += batch.num_rows();
                        appender.append_record_batch(batch)
                            .map_err(|error| format!("failed to append analytical file batch: {error}"))?;
                    }
                    ImportSelection::FirstN { rows: limit } => {
                        let remaining = limit.saturating_sub(row_count);
                        if remaining == 0 { break 'batches; }
                        let retained = batch.slice(0, remaining.min(batch.num_rows()));
                        approximate_bytes = approximate_bytes.saturating_add(retained.get_array_memory_size());
                        row_count += retained.num_rows();
                        appender.append_record_batch(retained)
                            .map_err(|error| format!("failed to append analytical file sample: {error}"))?;
                        if row_count == *limit { break 'batches; }
                    }
                    ImportSelection::Reservoir { rows: limit, .. } => {
                        for index in 0..batch.num_rows() {
                            let seen = scanned_rows - batch.num_rows() + index + 1;
                            let one = compact_arrow_row(&batch, index)?;
                            if reservoir.len() < *limit {
                                reservoir.push(one);
                            } else {
                                random_state ^= random_state << 13;
                                random_state ^= random_state >> 7;
                                random_state ^= random_state << 17;
                                let selected = (random_state % seen as u64) as usize;
                                if selected < *limit { reservoir[selected] = one; }
                            }
                        }
                    }
                }
                if approximate_bytes > MAX_DATASET_BYTES {
                    return Err(format!("analytical file exceeds the {MAX_DATASET_BYTES} byte dataset budget"));
                }
                self.update_progress(scanned_rows, match &request.selection {
                    ImportSelection::Reservoir { .. } => reservoir.len(),
                    _ => row_count,
                }, scanned_bytes);
            }
            if matches!(&request.selection, ImportSelection::Reservoir { .. }) {
                for row in reservoir {
                    approximate_bytes = approximate_bytes.saturating_add(row.get_array_memory_size());
                    if approximate_bytes > MAX_DATASET_BYTES {
                        return Err(format!("analytical file sample exceeds the {MAX_DATASET_BYTES} byte dataset budget"));
                    }
                    appender.append_record_batch(row)
                        .map_err(|error| format!("failed to append analytical file reservoir: {error}"))?;
                    row_count += 1;
                }
            }
            appender.flush().map_err(|error| format!("file dataset flush failed: {error}"))?;
        }
        let dataset = DatasetRef {
            id: id.clone(),
            workspace_id: request.workspace_id,
            name: request.name,
            relation_name,
            columns,
            row_count,
            approximate_bytes,
            created_at_ms: now_ms()?,
            coverage: match &request.selection {
                ImportSelection::Full => DatasetCoverage::Complete,
                ImportSelection::FirstN { .. } | ImportSelection::Reservoir { .. } => DatasetCoverage::Sampled,
            },
            selection: request.selection.clone(),
            retained_target: selection_target(&request.selection),
            scanned_rows,
            source_total: matches!(&request.selection, ImportSelection::Full | ImportSelection::Reservoir { .. }).then_some(scanned_rows),
            source_connection_id: None,
            source_sql: None,
            source_uri,
        };
        if dataset.workspace_id != "federated" { persist_dataset(&transaction, &dataset)?; }
        transaction.commit().map_err(|error| format!("file dataset commit failed: {error}"))?;
        inner.datasets.insert(id, dataset.clone());
        Ok(dataset)
    }

    fn import_json_file_inner(&self, request: FileImportRequest) -> Result<DatasetRef, String> {
        let temporary_path = self._temp_directory.0.join(format!("{}.parquet", random_id()?));
        let source_uri = request.path.to_string_lossy().into_owned();
        let escaped_source = request.path.to_string_lossy().replace('\'', "''");
        let escaped_target = temporary_path.to_string_lossy().replace('\'', "''");
        let convert = (|| {
            let reader = Connection::open_in_memory()
                .map_err(|error| format!("failed to open JSON reader: {error}"))?;
            reader.execute_batch(&format!("SET memory_limit = '{DEFAULT_MEMORY_LIMIT}'; SET threads = {DEFAULT_THREADS}; INSTALL json; LOAD json; INSTALL parquet; LOAD parquet;"))
                .map_err(|error| format!("failed to load JSON support: {error}"))?;
            reader.execute_batch(&format!("COPY (SELECT * FROM read_json_auto('{escaped_source}')) TO '{escaped_target}' (FORMAT PARQUET)"))
                .map_err(|error| format!("failed to read JSON file: {error}"))?;
            self.import_file_with_origin(FileImportRequest {
                operation_id: request.operation_id, workspace_id: request.workspace_id,
                name: request.name, path: temporary_path.clone(), format: FileFormat::Parquet,
                selection: request.selection,
            }, Some(source_uri))
        })();
        let _ = std::fs::remove_file(&temporary_path);
        convert
    }

    fn export_query_inner(&self, request: ExportRequest) -> Result<ExportResult, String> {
        validate_workspace_id(&request.workspace_id)?;
        let sql = validate_read_only_sql(&request.sql)?;
        validate_export_path(&request.path, request.format)?;
        let temporary_path = temporary_export_path(&request.path)?;
        let export = (|| {
            let inner = self.lock()?;
            ensure_workspace_relations(&inner, &request.workspace_id, sql)?;
            let mut statement = inner.connection.prepare(sql)
                .map_err(|error| format!("invalid analytical export SQL: {error}"))?;
            let mut batches = statement.stream_arrow([])
                .map_err(|error| format!("analytical export query failed: {error}"))?;
            let schema = batches.get_schema();
            let file = File::create_new(&temporary_path)
                .map_err(|error| format!("failed to create analytical export: {error}"))?;
            let mut rows = 0_usize;
            match request.format {
                ExportFormat::Csv => {
                    let mut writer = arrow::csv::WriterBuilder::new().with_header(true).build(file);
                    for batch in batches.by_ref() {
                        if self.cancel_requested.load(Ordering::Acquire) {
                            return Err("analytical export cancelled".to_string());
                        }
                        rows += batch.num_rows();
                        writer.write(&batch).map_err(|error| format!("CSV export failed: {error}"))?;
                        self.update_progress(rows, rows, 0);
                    }
                }
                ExportFormat::Parquet => {
                    let mut writer = parquet::arrow::ArrowWriter::try_new(file, schema, None)
                        .map_err(|error| format!("failed to start Parquet export: {error}"))?;
                    for batch in batches.by_ref() {
                        if self.cancel_requested.load(Ordering::Acquire) {
                            return Err("analytical export cancelled".to_string());
                        }
                        rows += batch.num_rows();
                        writer.write(&batch).map_err(|error| format!("Parquet export failed: {error}"))?;
                        self.update_progress(rows, rows, 0);
                    }
                    writer.close().map_err(|error| format!("failed to finish Parquet export: {error}"))?;
                }
                ExportFormat::ArrowIpc => {
                    let mut writer = arrow::ipc::writer::FileWriter::try_new(file, &schema)
                        .map_err(|error| format!("failed to start Arrow IPC export: {error}"))?;
                    for batch in batches.by_ref() {
                        if self.cancel_requested.load(Ordering::Acquire) {
                            return Err("analytical export cancelled".to_string());
                        }
                        rows += batch.num_rows();
                        writer.write(&batch).map_err(|error| format!("Arrow IPC export failed: {error}"))?;
                        self.update_progress(rows, rows, 0);
                    }
                    writer.finish().map_err(|error| format!("failed to finish Arrow IPC export: {error}"))?;
                }
            }
            Ok(rows)
        })();
        let rows = match export {
            Ok(rows) => rows,
            Err(error) => {
                let _ = std::fs::remove_file(&temporary_path);
                return Err(error);
            }
        };
        if request.path.exists() {
            std::fs::remove_file(&request.path)
                .map_err(|error| format!("failed to replace analytical export: {error}"))?;
        }
        std::fs::rename(&temporary_path, &request.path)
            .map_err(|error| format!("failed to publish analytical export: {error}"))?;
        let bytes = std::fs::metadata(&request.path)
            .map_err(|error| format!("failed to inspect analytical export: {error}"))?
            .len();
        self.update_progress(rows, rows, bytes as usize);
        Ok(ExportResult { path: request.path, rows, bytes })
    }

    fn query_inner(&self, request: QueryRequest) -> Result<AnalysisQueryResult, String> {
        validate_workspace_id(&request.workspace_id)?;
        if request.limit == 0 || request.limit > MAX_PREVIEW_ROWS {
            return Err(format!(
                "preview limit must be between 1 and {MAX_PREVIEW_ROWS}"
            ));
        }
        let sql = validate_read_only_sql(&request.sql)?;
        let inner = self.lock()?;
        ensure_workspace_relations(&inner, &request.workspace_id, sql)?;
        Self::query_preview(&inner.connection, sql, request.limit)
    }

    fn query_preview(connection: &Connection, sql: &str, limit: usize) -> Result<AnalysisQueryResult, String> {
        let bounded_sql = format!(
            "SELECT * FROM ({sql}) AS __omni_analysis_preview LIMIT {}",
            limit + 1
        );
        let mut statement = connection
            .prepare(&bounded_sql)
            .map_err(|error| format!("invalid analytical SQL: {error}"))?;
        let mut cursor = statement
            .query([])
            .map_err(|error| format!("analytical query failed: {error}"))?;
        let executed = cursor
            .as_ref()
            .ok_or_else(|| "analytical query did not expose result metadata".to_string())?;
        let column_count = executed.column_count();
        let columns = (0..column_count)
            .map(|index| QueryColumn {
                name: executed
                    .column_name(index)
                    .cloned()
                    .unwrap_or_else(|_| format!("column_{}", index + 1)),
                data_type: format!("{:?}", executed.column_type(index)),
                nullable: true,
            })
            .collect::<Vec<_>>();
        let mut rows = Vec::with_capacity(limit.min(1024));
        let mut serialized_bytes = 0_usize;
        let mut byte_limit_reached = false;
        while let Some(row) = cursor
            .next()
            .map_err(|error| format!("failed to read analytical result: {error}"))?
        {
            let values = (0..column_count)
                .map(|index| {
                    row.get_ref(index)
                        .map_err(|error| {
                            format!("failed to read result column {}: {error}", index + 1)
                        })
                        .and_then(value_ref_to_json)
                })
                .collect::<Result<Vec<_>, _>>()?;
            let row_bytes = measure_row(&values)?;
            if serialized_bytes.saturating_add(row_bytes) > MAX_PREVIEW_BYTES {
                byte_limit_reached = true;
                break;
            }
            serialized_bytes += row_bytes;
            rows.push(values);
        }
        let rows_more_available = byte_limit_reached || rows.len() > limit;
        rows.truncate(limit);
        Ok(AnalysisQueryResult {
            columns,
            rows,
            rows_more_available,
        })
    }

    pub fn cancel(&self, operation_id: &str) -> Result<bool, String> {
        let current = self
            .current_operation
            .lock()
            .map_err(|_| "analytical operation lock is poisoned".to_string())?;
        if current.as_deref() != Some(operation_id) {
            return Ok(false);
        }
        drop(current);
        self.cancel_requested.store(true, Ordering::Release);
        if let Ok(mut status) = self.operation_status.lock() {
            if let Some(status) = status.as_mut().filter(|status| status.operation_id == operation_id) {
                status.state = "cancelling".to_string();
            }
        }
        self.interrupt.interrupt();
        if let Ok(slot) = self.remote_interrupt.lock() {
            if let Some(remote) = slot.as_ref() { remote.interrupt(); }
        }
        let source = self.source_cancellation.lock()
            .map_err(|_| "source cancellation lock is poisoned".to_string())?
            .as_ref()
            .filter(|value| value.operation_id == operation_id)
            .cloned();
        if let Some(source) = source {
            let _ = cancel_backend_source(&source);
        }
        Ok(true)
    }

    fn arm_remote_interrupt(&self, connection: &Connection) -> Result<RemoteInterruptGuard<'_>, String> {
        *self.remote_interrupt.lock()
            .map_err(|_| "remote analytical interrupt lock is poisoned".to_string())? = Some(connection.interrupt_handle());
        Ok(RemoteInterruptGuard { slot: &self.remote_interrupt })
    }

    pub fn operation_status(&self, operation_id: &str) -> Result<Option<OperationStatus>, String> {
        validate_operation_id(operation_id)?;
        let status = self.operation_status.lock()
            .map_err(|_| "analytical operation status lock is poisoned".to_string())?;
        Ok(status.as_ref().filter(|status| status.operation_id == operation_id).cloned())
    }

    fn run_operation<T>(
        &self,
        operation_id: String,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        validate_operation_id(&operation_id)?;
        {
            let mut current = self
                .current_operation
                .lock()
                .map_err(|_| "analytical operation lock is poisoned".to_string())?;
            if current.is_some() {
                return Err("another analytical operation is already running".to_string());
            }
            *current = Some(operation_id.clone());
        }
        self.cancel_requested.store(false, Ordering::Release);
        *self.operation_status.lock()
            .map_err(|_| "analytical operation status lock is poisoned".to_string())? = Some(OperationStatus {
                operation_id: operation_id.clone(),
                state: "running".to_string(),
                scanned_rows: 0,
                retained_rows: 0,
                processed_bytes: 0,
                started_at_ms: now_ms()?,
                finished_at_ms: None,
            });
        let result = operation();
        if let Ok(mut status) = self.operation_status.lock() {
            if let Some(status) = status.as_mut().filter(|status| status.operation_id == operation_id) {
                status.state = if result.is_ok() {
                    "succeeded"
                } else if self.cancel_requested.load(Ordering::Acquire) {
                    "cancelled"
                } else {
                    "failed"
                }.to_string();
                status.finished_at_ms = now_ms().ok();
            }
        }
        if let Ok(mut current) = self.current_operation.lock() {
            if current.as_deref() == Some(&operation_id) {
                *current = None;
            }
        }
        result
    }

    fn update_progress(&self, scanned_rows: usize, retained_rows: usize, processed_bytes: usize) {
        if let Ok(mut status) = self.operation_status.lock() {
            if let Some(status) = status.as_mut() {
                status.scanned_rows = scanned_rows;
                status.retained_rows = retained_rows;
                status.processed_bytes = processed_bytes;
            }
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, EngineInner>, String> {
        self.inner
            .lock()
            .map_err(|_| "DuckDB data engine lock is poisoned".to_string())
    }
}

fn default_batch_size() -> usize {
    1_000
}

fn ensure_dataset_capacity(inner: &EngineInner) -> Result<(), String> {
    if inner.datasets.len() >= MAX_DATASETS {
        return Err(format!("analytical workspace reached the {MAX_DATASETS} dataset limit"));
    }
    Ok(())
}

fn validate_export_path(path: &Path, format: ExportFormat) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("analytical export path must be absolute".to_string());
    }
    let parent = path.parent().ok_or_else(|| "analytical export path has no parent".to_string())?;
    if !parent.is_dir() {
        return Err("analytical export directory does not exist".to_string());
    }
    let expected = match format {
        ExportFormat::Csv => "csv",
        ExportFormat::Parquet => "parquet",
        ExportFormat::ArrowIpc => "arrow",
    };
    if path.extension().and_then(|value| value.to_str()).is_none_or(|value| !value.eq_ignore_ascii_case(expected)) {
        return Err(format!("analytical export path must use the .{expected} extension"));
    }
    Ok(())
}

fn validate_import_path(path: &Path, format: FileFormat) -> Result<(), String> {
    if !path.is_absolute() || !path.is_file() {
        return Err("analytical import path must be an existing absolute file".to_string());
    }
    let expected = match format { FileFormat::Csv => "csv", FileFormat::Parquet => "parquet", FileFormat::Json => "json" };
    if path.extension().and_then(|value| value.to_str()).is_none_or(|value| !value.eq_ignore_ascii_case(expected)) {
        return Err(format!("analytical import path must use the .{expected} extension"));
    }
    Ok(())
}

type FileBatchIterator = Box<dyn Iterator<Item = Result<arrow::record_batch::RecordBatch, String>>>;

fn open_file_batches(
    path: &Path,
    format: FileFormat,
) -> Result<(arrow::datatypes::SchemaRef, FileBatchIterator), String> {
    match format {
        FileFormat::Csv => {
            let mut file = File::open(path).map_err(|error| format!("failed to open CSV file: {error}"))?;
            let format = arrow::csv::reader::Format::default().with_header(true);
            let (schema, _) = format.infer_schema(&mut file, Some(10_000))
                .map_err(|error| format!("failed to infer CSV schema: {error}"))?;
            file.rewind().map_err(|error| format!("failed to rewind CSV file: {error}"))?;
            let schema = Arc::new(schema);
            let reader = arrow::csv::ReaderBuilder::new(schema.clone())
                .with_header(true)
                .with_batch_size(1_000)
                .build(file)
                .map_err(|error| format!("failed to create CSV reader: {error}"))?;
            Ok((schema, Box::new(reader.map(|batch| batch.map_err(|error| format!("failed to read CSV batch: {error}"))))))
        }
        FileFormat::Parquet => {
            let file = File::open(path).map_err(|error| format!("failed to open Parquet file: {error}"))?;
            let builder = parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder::try_new(file)
                .map_err(|error| format!("failed to inspect Parquet file: {error}"))?;
            let schema = builder.schema().clone();
            let reader = builder.with_batch_size(1_000).build()
                .map_err(|error| format!("failed to create Parquet reader: {error}"))?;
            Ok((schema, Box::new(reader.map(|batch| batch.map_err(|error| format!("failed to read Parquet batch: {error}"))))))
        }
        FileFormat::Json => Err("JSON is imported through DuckDB's JSON reader".to_string()),
    }
}

fn compact_arrow_row(
    batch: &arrow::record_batch::RecordBatch,
    index: usize,
) -> Result<arrow::record_batch::RecordBatch, String> {
    let indices = arrow::array::UInt32Array::from(vec![index as u32]);
    let columns = batch.columns().iter().map(|column| {
        arrow::compute::take(column.as_ref(), &indices, None)
            .map_err(|error| format!("failed to sample analytical file row: {error}"))
    }).collect::<Result<Vec<_>, _>>()?;
    arrow::record_batch::RecordBatch::try_new(batch.schema(), columns)
        .map_err(|error| format!("failed to build analytical file sample: {error}"))
}

fn normalize_arrow_columns(fields: &arrow::datatypes::Fields) -> Result<Vec<DatasetColumn>, String> {
    let mut used = HashSet::new();
    fields.iter().enumerate().map(|(index, field)| {
        let original_name = field.name().clone();
        let base = if original_name.trim().is_empty() { format!("column_{}", index + 1) } else { original_name.trim().to_string() };
        let mut name = base.clone();
        let mut suffix = 2;
        while !used.insert(name.to_lowercase()) {
            name = format!("{base}_{suffix}");
            suffix += 1;
        }
        let data_type = arrow_type_to_sql(field.data_type())?;
        Ok(DatasetColumn {
            name,
            original_name,
            data_type,
            source_data_type: field.data_type().to_string(),
            nullable: field.is_nullable(),
        })
    }).collect()
}

fn arrow_type_to_sql(data_type: &arrow::datatypes::DataType) -> Result<String, String> {
    use arrow::datatypes::{DataType, TimeUnit};
    let value = match data_type {
        DataType::Null => "VARCHAR".to_string(),
        DataType::Boolean => "BOOLEAN".to_string(),
        DataType::Int8 => "TINYINT".to_string(),
        DataType::Int16 => "SMALLINT".to_string(),
        DataType::Int32 => "INTEGER".to_string(),
        DataType::Int64 => "BIGINT".to_string(),
        DataType::UInt8 => "UTINYINT".to_string(),
        DataType::UInt16 => "USMALLINT".to_string(),
        DataType::UInt32 => "UINTEGER".to_string(),
        DataType::UInt64 => "UBIGINT".to_string(),
        DataType::Float16 | DataType::Float32 => "FLOAT".to_string(),
        DataType::Float64 => "DOUBLE".to_string(),
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => "VARCHAR".to_string(),
        DataType::Binary | DataType::LargeBinary | DataType::BinaryView | DataType::FixedSizeBinary(_) => "BLOB".to_string(),
        DataType::Date32 => "DATE".to_string(),
        DataType::Date64 => "TIMESTAMP_MS".to_string(),
        DataType::Timestamp(unit, timezone) => {
            if timezone.is_some() { "TIMESTAMPTZ".to_string() } else { match unit {
                TimeUnit::Second => "TIMESTAMP_S",
                TimeUnit::Millisecond => "TIMESTAMP_MS",
                TimeUnit::Microsecond => "TIMESTAMP",
                TimeUnit::Nanosecond => "TIMESTAMP_NS",
            }.to_string() }
        }
        DataType::Time32(TimeUnit::Second) => "TIME_S".to_string(),
        DataType::Time32(TimeUnit::Millisecond) => "TIME_MS".to_string(),
        DataType::Time64(TimeUnit::Microsecond) => "TIME".to_string(),
        DataType::Time64(TimeUnit::Nanosecond) => "TIME_NS".to_string(),
        DataType::Decimal128(precision, scale) if *precision <= 38 => format!("DECIMAL({precision},{scale})"),
        other => return Err(format!("analytical file contains unsupported Arrow type: {other}")),
    };
    Ok(value)
}

fn temporary_export_path(path: &Path) -> Result<PathBuf, String> {
    let id = random_id()?;
    let file_name = path.file_name().and_then(|value| value.to_str())
        .ok_or_else(|| "analytical export filename is not valid UTF-8".to_string())?;
    Ok(path.with_file_name(format!(".{file_name}.{id}.part")))
}

fn read_stream_message(reader: &mut impl BufRead) -> Result<Option<StreamMessage>, String> {
    let mut line = String::new();
    let bytes = reader
        .read_line(&mut line)
        .map_err(|error| format!("failed to read analytical source batch: {error}"))?;
    if bytes == 0 {
        return Ok(None);
    }
    if bytes > 16 * 1024 * 1024 {
        return Err("analytical source batch exceeds 16 MiB".to_string());
    }
    serde_json::from_str(line.trim_end())
        .map(Some)
        .map_err(|error| format!("invalid analytical source batch: {error}"))
}

fn cancel_backend_source(source: &SourceCancellation) -> Result<(), String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("failed to create source cancellation client: {error}"))?
        .post(format!("http://127.0.0.1:{}/rpc", source.backend_port))
        .bearer_auth(&source.backend_token)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": source.operation_id,
            "method": "query.cancel",
            "params": { "connectionId": source.connection_id },
        }))
        .send()
        .map_err(|error| format!("failed to cancel analytical source query: {error}"))?;
    Ok(())
}

fn same_schema(left: &[ImportColumn], right: &[ImportColumn]) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(left, right)| {
            left.name == right.name
                && left.data_type == right.data_type
                && left.nullable == right.nullable
        })
}

fn validate_stream_row(row: &[JsonValue], column_count: usize, row_index: usize) -> Result<(), String> {
    if row.len() != column_count {
        return Err(format!("row {row_index} does not match the source schema"));
    }
    for value in row {
        if matches!(value, JsonValue::String(value) if value.len() > MAX_CELL_BYTES) {
            return Err(format!("row {row_index} contains a cell larger than {MAX_CELL_BYTES} bytes"));
        }
    }
    Ok(())
}

fn measure_row(row: &[JsonValue]) -> Result<usize, String> {
    serde_json::to_vec(row)
        .map(|encoded| encoded.len())
        .map_err(|error| format!("failed to measure source row: {error}"))
}

fn append_row(
    appender: &mut duckdb::Appender<'_>,
    row: &[JsonValue],
    columns: &[DatasetColumn],
    row_index: usize,
) -> Result<(), String> {
    let values = row
        .iter()
        .zip(columns)
        .enumerate()
        .map(|(column_index, (value, column))| {
            json_to_duckdb(value, &column.data_type).map_err(|error| {
                format!("row {row_index}, column {}: {error}", column_index + 1)
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    appender
        .append_row(appender_params_from_iter(values.iter()))
        .map_err(|error| format!("row {row_index}: source append failed: {error}"))
}

fn initialize_connection(connection: &Connection, temp_directory: &Path) -> Result<(), String> {
    let temp_directory = temp_directory.to_str()
        .ok_or_else(|| "analytical temporary path is not valid UTF-8".to_string())?
        .replace('\'', "''");
    connection
        .execute_batch(&format!(
            "SET temp_directory = '{temp_directory}';\
             SET max_temp_directory_size = '4GB';\
             SET enable_external_access = false;\
             SET autoinstall_known_extensions = false;\
             SET autoload_known_extensions = false;\
             SET allow_unsigned_extensions = false;\
             SET memory_limit = '{DEFAULT_MEMORY_LIMIT}';\
             SET threads = {DEFAULT_THREADS};\
             SET lock_configuration = true;"
        ))
        .map_err(|error| format!("failed to secure the DuckDB data engine: {error}"))
}

fn create_temp_directory() -> Result<PathBuf, String> {
    let root = std::env::temp_dir().join("omni-sql-analysis");
    cleanup_abandoned_temp_directories(&root);
    let path = root.join(random_id()?);
    std::fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create analytical temporary directory: {error}"))?;
    Ok(path)
}

fn cleanup_abandoned_temp_directories(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.len() != 32 || !name.chars().all(|value| value.is_ascii_hexdigit()) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        let old_enough = metadata.modified().ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age.as_secs() > 7 * 24 * 60 * 60);
        if metadata.is_dir() && old_enough {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn validate_import(request: &ImportResultRequest) -> Result<(), String> {
    validate_workspace_id(&request.workspace_id)?;
    if request.name.trim().is_empty() || request.name.len() > 128 {
        return Err("dataset name must contain between 1 and 128 characters".to_string());
    }
    if request.columns.is_empty() || request.columns.len() > 1024 {
        return Err("snapshot must contain between 1 and 1024 columns".to_string());
    }
    if request.rows.len() > MAX_SNAPSHOT_ROWS {
        return Err(format!(
            "snapshot exceeds the {MAX_SNAPSHOT_ROWS} row limit"
        ));
    }
    match request.selection {
        ImportSelection::Full => {}
        ImportSelection::FirstN { rows } | ImportSelection::Reservoir { rows, .. }
            if rows == 0 || rows > MAX_SNAPSHOT_ROWS =>
        {
            return Err(format!(
                "sample size must be between 1 and {MAX_SNAPSHOT_ROWS}"
            ));
        }
        ImportSelection::FirstN { .. } | ImportSelection::Reservoir { .. } => {}
    }
    for (index, row) in request.rows.iter().enumerate() {
        if row.len() != request.columns.len() {
            return Err(format!(
                "row {} does not match the snapshot schema",
                index + 1
            ));
        }
        for value in row {
            if let JsonValue::String(value) = value {
                if value.len() > MAX_CELL_BYTES {
                    return Err(format!(
                        "row {} contains a cell larger than {MAX_CELL_BYTES} bytes",
                        index + 1
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_selection(selection: &ImportSelection) -> Result<(), String> {
    match selection {
        ImportSelection::Full => Ok(()),
        ImportSelection::FirstN { rows } | ImportSelection::Reservoir { rows, .. }
            if *rows == 0 || *rows > MAX_SNAPSHOT_ROWS =>
        {
            Err(format!("sample size must be between 1 and {MAX_SNAPSHOT_ROWS}"))
        }
        ImportSelection::FirstN { .. } | ImportSelection::Reservoir { .. } => Ok(()),
    }
}

fn selection_target(selection: &ImportSelection) -> Option<usize> {
    match selection {
        ImportSelection::Full => None,
        ImportSelection::FirstN { rows } | ImportSelection::Reservoir { rows, .. } => Some(*rows),
    }
}

fn select_rows(
    rows: &[Vec<JsonValue>],
    selection: &ImportSelection,
) -> Result<Vec<Vec<JsonValue>>, String> {
    match *selection {
        ImportSelection::Full => Ok(rows.to_vec()),
        ImportSelection::FirstN { rows: size } => Ok(rows.iter().take(size).cloned().collect()),
        ImportSelection::Reservoir { rows: size, seed } => {
            let mut sample = rows.iter().take(size).cloned().collect::<Vec<_>>();
            let mut state = seed.max(1);
            for (index, row) in rows.iter().enumerate().skip(size) {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                let selected = (state % (index as u64 + 1)) as usize;
                if selected < size {
                    sample[selected] = row.clone();
                }
            }
            Ok(sample)
        }
    }
}

fn validate_workspace_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
    {
        return Err("invalid analytical workspace identifier".to_string());
    }
    Ok(())
}

fn validate_operation_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
    {
        return Err("invalid analytical operation identifier".to_string());
    }
    Ok(())
}

fn normalize_columns(columns: &[ImportColumn]) -> Result<Vec<DatasetColumn>, String> {
    let mut used = HashSet::new();
    columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            if column.name.len() > 256 {
                return Err(format!("column {} name exceeds 256 characters", index + 1));
            }
            let base = if column.name.trim().is_empty() {
                format!("column_{}", index + 1)
            } else {
                column.name.trim().to_string()
            };
            let mut name = base.clone();
            let mut suffix = 2;
            while !used.insert(name.to_lowercase()) {
                name = format!("{base}_{suffix}");
                suffix += 1;
            }
            Ok(DatasetColumn {
                name,
                original_name: column.name.clone(),
                data_type: analytical_type(&column.data_type),
                source_data_type: column.data_type.clone(),
                nullable: column.nullable,
            })
        })
        .collect()
}

fn analytical_type(source: &str) -> String {
    let source = source.to_ascii_lowercase();
    if source.contains("bool") || source == "bit" {
        "BOOLEAN".to_string()
    } else if source.contains("int") || source.contains("serial") {
        "BIGINT".to_string()
    } else if let Some(decimal) = parse_decimal_type(&source) {
        decimal
    } else if source.contains("double") || source.contains("float") || source.contains("real") {
        "DOUBLE".to_string()
    } else if source.contains("binary") || source.contains("blob") || source.contains("bytea") {
        "BLOB".to_string()
    } else {
        // Decimal and temporal values stay lossless at this initial JSON boundary.
        "VARCHAR".to_string()
    }
}

fn parse_decimal_type(source: &str) -> Option<String> {
    let start = source.find("decimal(").or_else(|| source.find("numeric("))?;
    let parameters = source[start..].split_once('(')?.1.split_once(')')?.0;
    let (precision, scale) = parameters.split_once(',')?;
    let precision = precision.trim().parse::<u8>().ok()?;
    let scale = scale.trim().parse::<u8>().ok()?;
    (precision > 0 && precision <= 38 && scale <= precision)
        .then(|| format!("DECIMAL({precision},{scale})"))
}

fn json_to_duckdb(value: &JsonValue, target_type: &str) -> Result<Value, String> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    if let Some((width, scale)) = parse_decimal_target(target_type) {
        let text = value.as_str().ok_or_else(|| "expected exact decimal text".to_string())?;
        let scaled = parse_scaled_decimal(text, scale)?;
        let decimal = duckdb::types::Decimal::new(width, scale, scaled)
            .map_err(|error| format!("invalid decimal: {error}"))?;
        return Ok(Value::Decimal(decimal));
    }
    match target_type {
        "BOOLEAN" => value
            .as_bool()
            .map(Value::Boolean)
            .ok_or_else(|| "expected a boolean".to_string()),
        "BIGINT" => match value {
            JsonValue::Number(number) => number
                .as_i64()
                .map(Value::BigInt)
                .ok_or_else(|| "integer is outside the signed 64-bit range".to_string()),
            JsonValue::String(value) => value
                .parse::<i64>()
                .map(Value::BigInt)
                .map_err(|_| "invalid signed 64-bit integer text".to_string()),
            _ => Err("expected an integer or exact integer text".to_string()),
        },
        "DOUBLE" => value
            .as_f64()
            .map(Value::Double)
            .ok_or_else(|| "expected a finite JSON number".to_string()),
        "BLOB" => value
            .as_array()
            .ok_or_else(|| "expected binary data as a byte array".to_string())?
            .iter()
            .map(|byte| {
                byte.as_u64()
                    .and_then(|value| u8::try_from(value).ok())
                    .ok_or_else(|| "binary byte must be between 0 and 255".to_string())
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Blob),
        _ => match value {
            JsonValue::String(value) => Ok(Value::Text(value.clone())),
            JsonValue::Number(value) => Ok(Value::Text(value.to_string())),
            JsonValue::Bool(value) => Ok(Value::Text(value.to_string())),
            value @ (JsonValue::Array(_) | JsonValue::Object(_)) => serde_json::to_string(value)
                .map(Value::Text)
                .map_err(|error| format!("failed to encode structured value: {error}")),
            JsonValue::Null => Ok(Value::Null),
        },
    }
}

fn parse_decimal_target(target: &str) -> Option<(u8, u8)> {
    let parameters = target.strip_prefix("DECIMAL(")?.strip_suffix(')')?;
    let (width, scale) = parameters.split_once(',')?;
    Some((width.parse().ok()?, scale.parse().ok()?))
}

fn parse_scaled_decimal(text: &str, scale: u8) -> Result<i128, String> {
    let (negative, unsigned) = text.strip_prefix('-').map_or((false, text), |value| (true, value));
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    if whole.is_empty() || !whole.chars().all(|value| value.is_ascii_digit())
        || !fraction.chars().all(|value| value.is_ascii_digit())
        || fraction.len() > usize::from(scale)
    {
        return Err("invalid exact decimal text".to_string());
    }
    let mut digits = format!("{whole}{fraction}");
    digits.extend(std::iter::repeat('0').take(usize::from(scale) - fraction.len()));
    let value = digits.parse::<i128>().map_err(|_| "decimal is outside the supported range".to_string())?;
    Ok(if negative { -value } else { value })
}

fn value_ref_to_json(value: duckdb::types::ValueRef<'_>) -> Result<JsonValue, String> {
    use duckdb::types::ValueRef;
    match value {
        ValueRef::Null => Ok(JsonValue::Null),
        ValueRef::Boolean(value) => Ok(JsonValue::Bool(value)),
        ValueRef::TinyInt(value) => Ok(value.into()),
        ValueRef::SmallInt(value) => Ok(value.into()),
        ValueRef::Int(value) => Ok(value.into()),
        ValueRef::BigInt(value) if value.unsigned_abs() <= 9_007_199_254_740_991 => {
            Ok(value.into())
        }
        ValueRef::BigInt(value) => Ok(JsonValue::String(value.to_string())),
        ValueRef::HugeInt(value) => Ok(JsonValue::String(value.to_string())),
        ValueRef::UHugeInt(value) => Ok(JsonValue::String(value.to_string())),
        ValueRef::UTinyInt(value) => Ok(value.into()),
        ValueRef::USmallInt(value) => Ok(value.into()),
        ValueRef::UInt(value) => Ok(value.into()),
        ValueRef::UBigInt(value) if value <= 9_007_199_254_740_991 => Ok(value.into()),
        ValueRef::UBigInt(value) => Ok(JsonValue::String(value.to_string())),
        ValueRef::Float(value) => serde_json::Number::from_f64(value.into())
            .map(JsonValue::Number)
            .ok_or_else(|| "non-finite FLOAT result is not JSON-compatible".to_string()),
        ValueRef::Double(value) => serde_json::Number::from_f64(value)
            .map(JsonValue::Number)
            .ok_or_else(|| "non-finite DOUBLE result is not JSON-compatible".to_string()),
        ValueRef::Decimal(value) => Ok(JsonValue::String(value.to_string())),
        ValueRef::Text(value) => String::from_utf8(value.to_vec())
            .map(JsonValue::String)
            .map_err(|_| "analytical text result is not valid UTF-8".to_string()),
        ValueRef::Blob(value) | ValueRef::Geometry(value) => Ok(JsonValue::Array(
            value.iter().map(|byte| JsonValue::from(*byte)).collect(),
        )),
        ValueRef::Date32(value) => Ok(JsonValue::String(value.to_string())),
        ValueRef::Timestamp(unit, value) | ValueRef::Time64(unit, value) => {
            Ok(JsonValue::String(format!("{unit:?}:{value}")))
        }
        ValueRef::Interval {
            months,
            days,
            nanos,
        } => Ok(JsonValue::String(format!(
            "{months} months {days} days {nanos} nanoseconds"
        ))),
        other => Err(format!(
            "unsupported analytical result type: {:?}",
            other.data_type()
        )),
    }
}

fn validate_read_only_sql(sql: &str) -> Result<&str, String> {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() || trimmed.len() > 1024 * 1024 {
        return Err("analytical SQL must contain between 1 byte and 1 MiB".to_string());
    }
    let tokens = sql_tokens(trimmed)?;
    if tokens
        .first()
        .is_none_or(|token| token != "select" && token != "with")
    {
        return Err("only SELECT or WITH analytical statements are allowed".to_string());
    }
    let denied = [
        "attach",
        "call",
        "copy",
        "create",
        "delete",
        "detach",
        "drop",
        "export",
        "import",
        "insert",
        "install",
        "load",
        "pragma",
        "set",
        "update",
        "vacuum",
        "read_csv",
        "read_csv_auto",
        "read_json",
        "read_json_auto",
        "read_ndjson",
        "read_parquet",
        "parquet_scan",
        "delta_scan",
        "iceberg_scan",
        "glob",
        "read_text",
        "read_blob",
        "read_xlsx",
        "read_csv_strict",
        "sqlite_scan",
        "postgres_scan",
    ];
    if let Some(token) = tokens.iter().find(|token| denied.contains(&token.as_str())) {
        return Err(format!("analytical SQL operation is not allowed: {token}"));
    }
    Ok(trimmed)
}

fn validate_s3_sql(sql: &str) -> Result<&str, String> {
    let sql = validate_read_only_sql(sql)?;
    // ponytail: direct URI literals are blocked; use a SQL parser if indirect readers become reachable.
    let lower = sql.to_ascii_lowercase();
    if ["s3://", "http://", "https://"].iter().any(|scheme| lower.contains(scheme)) {
        return Err("S3 analytical SQL must use registered sources".to_string());
    }
    Ok(sql)
}

fn sql_tokens(sql: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = sql.chars().peekable();
    let mut quote = None;
    while let Some(character) = chars.next() {
        if let Some(delimiter) = quote {
            if character == delimiter {
                if chars.peek() == Some(&delimiter) {
                    chars.next();
                } else {
                    quote = None;
                }
            }
            continue;
        }
        match character {
            '\'' | '"' => {
                if !token.is_empty() {
                    tokens.push(std::mem::take(&mut token));
                }
                quote = Some(character);
            }
            ';' => return Err("only one analytical SQL statement is allowed".to_string()),
            '-' if chars.peek() == Some(&'-') => {
                chars.next();
                for next in chars.by_ref() {
                    if next == '\n' {
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut closed = false;
                while let Some(next) = chars.next() {
                    if next == '*' && chars.peek() == Some(&'/') {
                        chars.next();
                        closed = true;
                        break;
                    }
                }
                if !closed {
                    return Err("unterminated SQL comment".to_string());
                }
            }
            character if character.is_ascii_alphanumeric() || character == '_' => {
                token.push(character.to_ascii_lowercase())
            }
            _ => {
                if !token.is_empty() {
                    tokens.push(std::mem::take(&mut token));
                }
            }
        }
    }
    if quote.is_some() {
        return Err("unterminated SQL string or identifier".to_string());
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    Ok(tokens)
}

fn ensure_workspace_relations(
    inner: &EngineInner,
    workspace_id: &str,
    sql: &str,
) -> Result<(), String> {
    let lowercase = sql.to_ascii_lowercase();
    for dataset in inner.datasets.values() {
        if dataset.workspace_id != workspace_id
            && !(workspace_id == "local-duckdb" && dataset.workspace_id == "federated")
            && lowercase.contains(&dataset.relation_name.to_ascii_lowercase())
        {
            return Err("analytical query references a dataset from another workspace".to_string());
        }
    }
    for (handle, relation_name) in inner.result_handles.values() {
        if handle.workspace_id != workspace_id && lowercase.contains(&relation_name.to_ascii_lowercase()) {
            return Err("analytical query references a stable result from another workspace".to_string());
        }
    }
    Ok(())
}

fn relation_query_columns(connection: &Connection, relation_name: &str) -> Result<Vec<QueryColumn>, String> {
    let mut statement = connection.prepare(&format!(
        "SELECT * FROM {} LIMIT 0", quote_identifier(relation_name)
    )).map_err(|error| format!("failed to inspect stable analytical result: {error}"))?;
    let cursor = statement.query([])
        .map_err(|error| format!("failed to inspect stable analytical result: {error}"))?;
    let executed = cursor.as_ref().ok_or_else(|| "stable analytical result has no metadata".to_string())?;
    Ok((0..executed.column_count()).map(|index| QueryColumn {
        name: executed.column_name(index).cloned().unwrap_or_else(|_| format!("column_{}", index + 1)),
        data_type: format!("{:?}", executed.column_type(index)),
        nullable: true,
    }).collect())
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn readable_relation_name(name: &str) -> String {
    let mut relation = String::with_capacity(name.len().min(64));
    let mut previous_was_separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            relation.push(character.to_ascii_lowercase());
            previous_was_separator = false;
        } else if !relation.is_empty() && !previous_was_separator {
            relation.push('_');
            previous_was_separator = true;
        }
        if relation.len() >= 56 { break; }
    }
    while relation.ends_with('_') { relation.pop(); }
    if relation.is_empty() { relation.push_str("dataset"); }
    else if relation.as_bytes()[0].is_ascii_digit() { relation.insert_str(0, "dataset_"); }
    relation
}

fn available_relation_name(inner: &EngineInner, name: &str, excluded_dataset_id: Option<&str>) -> String {
    let base = readable_relation_name(name);
    let occupied = inner.datasets.iter()
        .filter(|(id, _)| excluded_dataset_id != Some(id.as_str()))
        .map(|(_, dataset)| dataset.relation_name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut candidate = base.clone();
    let mut suffix = 2usize;
    while occupied.contains(&candidate.to_ascii_lowercase()) {
        candidate = format!("{base}_{suffix}");
        suffix += 1;
    }
    candidate
}

fn random_id() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("failed to generate dataset ID: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("system clock is before the Unix epoch: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_s3_csv_parquet_delta_and_iceberg_without_snapshot() {
        if std::env::var("OMNI_SQL_RUN_S3_INTEGRATION").as_deref() != Ok("1") { return; }
        let engine = DataEngine::open_in_memory().unwrap();
        let endpoint = std::env::var("OMNI_SQL_TEST_S3_ENDPOINT")
            .unwrap_or_else(|_| "http://127.0.0.1:9000".to_string());
        let access_key_id = std::env::var("AWS_ACCESS_KEY_ID").unwrap_or_else(|_| "omni_test".into());
        let secret_access_key = std::env::var("AWS_SECRET_ACCESS_KEY").unwrap_or_else(|_| "omni_test_secret".into());
        let objects = list_s3_objects(S3ListRequest {
            uri: "s3://omni-test".into(), region: "us-east-1".into(),
            endpoint: Some(endpoint.clone()), prefix: "csv/".into(),
            catalog: None,
            access_key_id: Some(access_key_id.clone()), secret_access_key: Some(secret_access_key.clone()),
        }).unwrap();
        assert!(objects.iter().any(|uri| uri == "s3://omni-test/csv/orders.csv"));
        let cases = [
            (S3Format::Csv, "s3://omni-test/csv/orders.csv"),
            (S3Format::Parquet, "s3://omni-test/parquet/orders.parquet"),
            (S3Format::Delta, "s3://omni-test/delta/orders"),
            (S3Format::Iceberg, "s3://omni-test/iceberg/orders/metadata/current.metadata.json"),
        ];
        for (index, (format, uri)) in cases.into_iter().enumerate() {
            let result = engine.query_s3(S3QueryRequest {
                operation_id: format!("s3-test-{index}"),
                workspace_id: "s3-integration".into(),
                uri: uri.into(),
                format,
                table_schema: None, table_name: None, catalog: None,
                region: "us-east-1".into(),
                endpoint: Some(endpoint.clone()),
                access_key_id: Some(access_key_id.clone()), secret_access_key: Some(secret_access_key.clone()),
                sql: "SELECT id, amount FROM s3_source WHERE id = 2".into(),
                limit: 1000,
            }).unwrap_or_else(|error| panic!("{uri}: {error}"));
            assert_eq!(result.rows, vec![vec![JsonValue::from(2), JsonValue::from(20)]], "{uri}");
            assert!(!result.rows_more_available);
            assert!(engine.list_datasets("s3-integration").unwrap().is_empty());
        }
    }

    #[test]
    fn s3_reader_rejects_local_files_and_redacts_bad_credentials() {
        if std::env::var("OMNI_SQL_RUN_S3_INTEGRATION").as_deref() != Ok("1") { return; }
        let engine = DataEngine::open_in_memory().unwrap();
        let endpoint = std::env::var("OMNI_SQL_TEST_S3_ENDPOINT")
            .unwrap_or_else(|_| "http://127.0.0.1:9000".into());
        let directory = create_temp_directory().unwrap();
        let local = directory.join("private.csv");
        std::fs::write(&local, "id\n1\n").unwrap();
        let request = |operation_id: &str, sql: String, secret: &str| S3QueryRequest {
            operation_id: operation_id.into(), workspace_id: "s3-boundary".into(),
            uri: "s3://omni-test/csv/orders.csv".into(), format: S3Format::Csv,
            table_schema: None, table_name: None, catalog: None,
            region: "us-east-1".into(), endpoint: Some(endpoint.clone()),
            access_key_id: Some("omni_test".into()), secret_access_key: Some(secret.into()),
            sql, limit: 10,
        };
        let local_sql = format!("SELECT * FROM '{}'", local.to_string_lossy().replace('\\', "/"));
        assert!(engine.query_s3(request("s3-local-blocked", local_sql, "omni_test_secret")).is_err());
        let secret = "invalid_secret_marker";
        let error = engine.query_s3(request("s3-bad-credentials", "SELECT * FROM s3_source".into(), secret)).unwrap_err();
        assert!(!error.contains(secret));
        assert!(engine.query_s3(request("s3-after-error", "SELECT count(*) FROM s3_source".into(), "omni_test_secret")).is_ok());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn joins_two_s3_buckets_with_a_local_duckdb_table() {
        if std::env::var("OMNI_SQL_RUN_S3_INTEGRATION").as_deref() != Ok("1") { return; }
        let engine = DataEngine::open_in_memory().unwrap();
        engine.import_result(ImportResultRequest {
            operation_id: "local-join-fixture".into(), workspace_id: "federated".into(), name: "thresholds".into(),
            columns: vec![ImportColumn { name: "id".into(), data_type: "INTEGER".into(), nullable: false }],
            rows: vec![vec![JsonValue::from(2)]], rows_more_available: false,
            source_connection_id: None, source_sql: None, selection: ImportSelection::Full,
        }).unwrap();
        let result = engine.query_s3_catalog(S3CatalogQueryRequest {
            operation_id: "s3-cross-bucket-join".into(), workspace_id: "s3-integration".into(),
            sources: vec![
                S3CatalogSource { schema: "omni-test".into(), name: "orders".into(), uri: "s3://omni-test/csv/orders.csv".into(), format: S3Format::Csv, table_schema: None, table_name: None, catalog: None },
                S3CatalogSource { schema: "omni-test".into(), name: "parquet_orders".into(), uri: "s3://omni-test/parquet/orders.parquet".into(), format: S3Format::Parquet, table_schema: None, table_name: None, catalog: None },
                S3CatalogSource { schema: "omni-test".into(), name: "delta_orders".into(), uri: "s3://omni-test/delta/orders".into(), format: S3Format::Delta, table_schema: None, table_name: None, catalog: None },
                S3CatalogSource { schema: "omni-test".into(), name: "iceberg_orders".into(), uri: "s3://omni-test/iceberg/orders/metadata/current.metadata.json".into(), format: S3Format::Iceberg, table_schema: None, table_name: None, catalog: None },
                S3CatalogSource { schema: "omni-extra".into(), name: "customers".into(), uri: "s3://omni-extra/csv/customers.csv".into(), format: S3Format::Csv, table_schema: None, table_name: None, catalog: None },
            ],
            region: "us-east-1".into(),
            endpoint: Some(std::env::var("OMNI_SQL_TEST_S3_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:9000".into())),
            access_key_id: Some(std::env::var("AWS_ACCESS_KEY_ID").unwrap_or_else(|_| "omni_test".into())),
            secret_access_key: Some(std::env::var("AWS_SECRET_ACCESS_KEY").unwrap_or_else(|_| "omni_test_secret".into())),
            sql: "SELECT c.name, o.amount FROM \"omni-test\".orders o JOIN \"omni-extra\".customers c ON c.id = o.id JOIN \"omni-test\".parquet_orders p ON p.id = o.id JOIN \"omni-test\".delta_orders d ON d.id = o.id JOIN \"omni-test\".iceberg_orders i ON i.id = o.id JOIN \"local\".\"thresholds\" t ON t.id = o.id".into(),
            limit: 1000,
        }).unwrap();
        assert_eq!(result.rows, vec![vec![JsonValue::from("Lin"), JsonValue::from(20)]]);
    }

    #[test]
    fn imports_s3_formats_with_bounded_local_selections() {
        if std::env::var("OMNI_SQL_RUN_S3_INTEGRATION").as_deref() != Ok("1") { return; }
        let engine = DataEngine::open_in_memory().unwrap();
        let endpoint = std::env::var("OMNI_SQL_TEST_S3_ENDPOINT")
            .unwrap_or_else(|_| "http://127.0.0.1:9000".into());
        for (index, (format, uri)) in [
            (S3Format::Csv, "s3://omni-test/csv/orders.csv"),
            (S3Format::Parquet, "s3://omni-test/parquet/orders.parquet"),
            (S3Format::Delta, "s3://omni-test/delta/orders"),
            (S3Format::Iceberg, "s3://omni-test/iceberg/orders/metadata/current.metadata.json"),
        ].into_iter().enumerate() {
            let dataset = engine.import_s3(S3ImportRequest {
                operation_id: format!("s3-import-{index}"), workspace_id: "s3-imports".into(),
                name: format!("orders_{index}"), uri: uri.into(), format, region: "us-east-1".into(),
                table_schema: None, table_name: None, catalog: None,
                endpoint: Some(endpoint.clone()), access_key_id: Some("omni_test".into()),
                secret_access_key: Some("omni_test_secret".into()),
                selection: ImportSelection::FirstN { rows: 2 },
            }).unwrap_or_else(|error| panic!("{uri}: {error}"));
            assert_eq!(dataset.row_count, 2, "{uri}");
            assert!(matches!(dataset.coverage, DatasetCoverage::Sampled));
            assert_eq!(dataset.source_uri.as_deref(), Some(uri));
        }
        let sampled = engine.import_s3(S3ImportRequest {
            operation_id: "s3-reservoir".into(), workspace_id: "s3-imports".into(),
            name: "reservoir_orders".into(), uri: "s3://omni-test/parquet/orders.parquet".into(),
            format: S3Format::Parquet, region: "us-east-1".into(), endpoint: Some(endpoint),
            table_schema: None, table_name: None, catalog: None,
            access_key_id: Some("omni_test".into()), secret_access_key: Some("omni_test_secret".into()),
            selection: ImportSelection::Reservoir { rows: 2, seed: 42 },
        }).unwrap();
        assert_eq!(sampled.row_count, 2);
        assert!(matches!(sampled.coverage, DatasetCoverage::Sampled));
    }

    #[test]
    fn local_duckdb_import_survives_restart() {
        let directory = create_temp_directory().unwrap();
        let path = directory.join("local.duckdb");
        {
            let engine = DataEngine::open_persistent(&path).unwrap();
            engine.import_result(ImportResultRequest {
                operation_id: "persistent-import".into(), workspace_id: "local-duckdb".into(), name: "customers".into(),
                columns: vec![ImportColumn { name: "id".into(), data_type: "INTEGER".into(), nullable: false }],
                rows: vec![vec![JsonValue::from(7)]], rows_more_available: false,
                source_connection_id: None, source_sql: None, selection: ImportSelection::Full,
            }).unwrap();
        }
        let reopened = DataEngine::open_persistent(&path).unwrap();
        assert_eq!(reopened.list_datasets("local-duckdb").unwrap().len(), 1);
        let result = reopened.query(QueryRequest {
            operation_id: "persistent-query".into(), workspace_id: "local-duckdb".into(),
            sql: "SELECT id FROM customers".into(), limit: 10,
        }).unwrap();
        assert_eq!(result.rows, vec![vec![JsonValue::from(7)]]);
        drop(reopened);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn persistent_registry_tracks_rename_drop_and_temporary_datasets() {
        let directory = create_temp_directory().unwrap();
        let path = directory.join("local.duckdb");
        {
            let engine = DataEngine::open_persistent(&path).unwrap();
            let mut durable = request("local-duckdb");
            durable.name = "original".into();
            let durable = engine.import_result(durable).unwrap();
            engine.rename_dataset("local-duckdb", &durable.id, "renamed").unwrap();
            let mut temporary = request("federated");
            temporary.name = "temporary".into();
            let temporary = engine.import_result(temporary).unwrap();
            engine.rename_dataset("federated", &temporary.id, "changed_temp").unwrap();
            let csv_path = directory.join("temporary.csv");
            std::fs::write(&csv_path, "id\n1\n").unwrap();
            engine.import_file(FileImportRequest {
                operation_id: "temporary-file-import".into(), workspace_id: "federated".into(),
                name: "csv_temp".into(), path: csv_path, format: FileFormat::Csv,
                selection: ImportSelection::Full,
            }).unwrap();
            assert_eq!(engine.list_datasets("federated").unwrap().len(), 2);
        }
        {
            let engine = DataEngine::open_persistent(&path).unwrap();
            let durable = engine.list_datasets("local-duckdb").unwrap();
            assert_eq!(durable.len(), 1);
            assert_eq!(durable[0].relation_name, "renamed");
            assert!(engine.list_datasets("federated").unwrap().is_empty());
            assert!(engine.drop_dataset("local-duckdb", &durable[0].id).unwrap());
        }
        let engine = DataEngine::open_persistent(&path).unwrap();
        assert!(engine.list_datasets("local-duckdb").unwrap().is_empty());
        drop(engine);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn clear_removes_only_the_requested_workspace_after_restart() {
        let directory = create_temp_directory().unwrap();
        let path = directory.join("local.duckdb");
        {
            let engine = DataEngine::open_persistent(&path).unwrap();
            engine.import_result(request("workspace-a")).unwrap();
            engine.import_result(request("workspace-b")).unwrap();
            let handle = engine.start_query(QueryStartRequest {
                operation_id: "clear-result".into(), workspace_id: "workspace-a".into(),
                sql: "SELECT * FROM orders".into(),
            }).unwrap();
            assert_eq!(engine.clear("workspace-a").unwrap(), 2);
            assert!(engine.list_datasets("workspace-a").unwrap().is_empty());
            assert!(!engine.drop_result_handle("workspace-a", &handle.id).unwrap());
            assert_eq!(engine.list_datasets("workspace-b").unwrap().len(), 1);
        }
        let engine = DataEngine::open_persistent(&path).unwrap();
        assert!(engine.list_datasets("workspace-a").unwrap().is_empty());
        assert_eq!(engine.list_datasets("workspace-b").unwrap().len(), 1);
        drop(engine);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn preserves_exact_values_across_snapshot_import_and_query() {
        let engine = DataEngine::open_in_memory().unwrap();
        let columns = [
            ("amount", "DECIMAL(30,8)"),
            ("identifier", "BIGINT"),
            ("payload", "BLOB"),
            ("occurred_at", "TIMESTAMP WITH TIME ZONE"),
            ("optional", "VARCHAR"),
        ].into_iter().map(|(name, data_type)| ImportColumn {
            name: name.into(), data_type: data_type.into(), nullable: true,
        }).collect();
        engine.import_result(ImportResultRequest {
            operation_id: "exact-values-import".into(), workspace_id: "local-duckdb".into(),
            name: "exact_values".into(), columns,
            rows: vec![vec![
                JsonValue::from("12345678901234567890.12345678"),
                JsonValue::from("9007199254740993"),
                serde_json::json!([0, 127, 255]),
                JsonValue::from("2026-09-25T12:34:56.123456+03:00"),
                JsonValue::Null,
            ]],
            rows_more_available: false, source_connection_id: None, source_sql: None,
            selection: ImportSelection::Full,
        }).unwrap();
        let result = engine.query(QueryRequest {
            operation_id: "exact-values-query".into(), workspace_id: "local-duckdb".into(),
            sql: "SELECT * FROM exact_values".into(), limit: 10,
        }).unwrap();
        assert_eq!(result.rows[0], vec![
            JsonValue::from("12345678901234567890.12345678"),
            JsonValue::from("9007199254740993"),
            serde_json::json!([0, 127, 255]),
            JsonValue::from("2026-09-25T12:34:56.123456+03:00"),
            JsonValue::Null,
        ]);
    }

    #[test]
    fn duckdb_can_sample_each_local_input_with_a_repeatable_seed() {
        let engine = DataEngine::open_in_memory().unwrap();
        let mut import = request("local-duckdb");
        import.rows = (0..20).map(|id| vec![JsonValue::from(id), JsonValue::from("1.00")]).collect();
        engine.import_result(import).unwrap();
        let sql = "SELECT id FROM orders USING SAMPLE reservoir(3 ROWS) REPEATABLE (42) ORDER BY id";
        let first = engine.query(QueryRequest {
            operation_id: "sample-query-1".into(), workspace_id: "local-duckdb".into(),
            sql: sql.into(), limit: 10,
        }).unwrap();
        let second = engine.query(QueryRequest {
            operation_id: "sample-query-2".into(), workspace_id: "local-duckdb".into(),
            sql: sql.into(), limit: 10,
        }).unwrap();
        assert_eq!(first.rows.len(), 3);
        assert_eq!(first.rows, second.rows);
    }

    #[test]
    fn imports_json_into_local_duckdb() {
        let directory = create_temp_directory().unwrap();
        let path = directory.join("customers.json");
        std::fs::write(&path, "[{\"id\":1,\"name\":\"Ada\"},{\"id\":2,\"name\":\"Lin\"}]").unwrap();
        let engine = DataEngine::open_in_memory().unwrap();
        let dataset = engine.import_file(FileImportRequest {
            operation_id: "json-import".into(), workspace_id: "local-duckdb".into(), name: "customers".into(),
            path: path.clone(), format: FileFormat::Json, selection: ImportSelection::Full,
        }).unwrap();
        assert_eq!(dataset.row_count, 2);
        assert_eq!(dataset.source_uri.as_deref(), Some(path.to_string_lossy().as_ref()));
        let result = engine.query(QueryRequest {
            operation_id: "json-query".into(), workspace_id: "local-duckdb".into(),
            sql: "SELECT name FROM customers WHERE id = 2".into(), limit: 10,
        }).unwrap();
        assert_eq!(result.rows, vec![vec![JsonValue::from("Lin")]]);
        drop(engine);
        std::fs::remove_dir_all(directory).unwrap();
    }
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::Arc,
        thread,
        time::Duration,
    };

    fn request(workspace_id: &str) -> ImportResultRequest {
        ImportResultRequest {
            operation_id: "import-1".to_string(),
            workspace_id: workspace_id.to_string(),
            name: "Orders".to_string(),
            columns: vec![
                ImportColumn {
                    name: "id".into(),
                    data_type: "bigint".into(),
                    nullable: false,
                },
                ImportColumn {
                    name: "amount".into(),
                    data_type: "decimal(18,2)".into(),
                    nullable: false,
                },
            ],
            rows: vec![vec![JsonValue::from(1), JsonValue::String("10.25".into())]],
            rows_more_available: true,
            source_connection_id: Some("connection-1".into()),
            source_sql: Some("SELECT id, amount FROM orders".into()),
            selection: ImportSelection::Full,
        }
    }

    fn source_request(selection: ImportSelection) -> SourceImportRequest {
        SourceImportRequest {
            operation_id: "source-import-1".into(),
            workspace_id: "workspace-stream".into(),
            name: "Streamed rows".into(),
            connection_id: "connection-1".into(),
            sql: "SELECT id FROM generated_rows".into(),
            selection,
            batch_size: 1_000,
        }
    }

    fn serve_stream(row_count: usize) -> (u16, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let read = socket.read(&mut buffer).unwrap();
                if read == 0 { break; }
                request.extend_from_slice(&buffer[..read]);
                if request.windows(4).any(|value| value == b"\r\n\r\n") { break; }
            }
            let request_text = String::from_utf8_lossy(&request).to_ascii_lowercase();
            assert!(request_text.contains("authorization: bearer test-token"));
            assert!(request_text.starts_with("post /analysis/stream "));

            let mut writer = std::io::BufWriter::new(socket);
            write!(writer, "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\n\r\n").unwrap();
            for start in (0..row_count).step_by(1_000) {
                let rows = (start..row_count.min(start + 1_000))
                    .map(|value| vec![JsonValue::from(value as i64)])
                    .collect::<Vec<_>>();
                writeln!(writer, "{}", serde_json::json!({
                    "type": "batch",
                    "columns": [{ "name": "id", "dataType": "bigint", "nullable": false }],
                    "rows": rows,
                })).unwrap();
            }
            writeln!(writer, "{{\"type\":\"complete\"}}").unwrap();
            writer.flush().unwrap();
        });
        (port, handle)
    }

    #[test]
    fn opens_an_in_memory_database_and_runs_a_query() {
        let engine = DataEngine::open_in_memory().unwrap();
        assert_eq!(engine.smoke_query().unwrap(), 1);
    }

    #[test]
    fn streams_a_full_source_larger_than_the_grid_limit_directly_into_duckdb() {
        let (port, server) = serve_stream(MAX_SNAPSHOT_ROWS + 25);
        let engine = DataEngine::open_in_memory().unwrap();
        let dataset = engine
            .import_source(source_request(ImportSelection::Full), "test-token", port)
            .unwrap();
        server.join().unwrap();
        assert_eq!(dataset.row_count, MAX_SNAPSHOT_ROWS + 25);
        assert!(matches!(dataset.coverage, DatasetCoverage::Complete));
        let result = engine.query(QueryRequest {
            operation_id: "source-count".into(),
            workspace_id: "workspace-stream".into(),
            sql: format!("SELECT count(*) FROM {}", dataset.relation_name),
            limit: 1,
        }).unwrap();
        assert_eq!(result.rows, vec![vec![JsonValue::from((MAX_SNAPSHOT_ROWS + 25) as i64)]]);
    }

    #[test]
    fn imports_only_the_requested_first_rows_from_a_source_stream() {
        let (port, server) = serve_stream(100);
        let engine = DataEngine::open_in_memory().unwrap();
        let dataset = engine
            .import_source(source_request(ImportSelection::FirstN { rows: 3 }), "test-token", port)
            .unwrap();
        server.join().unwrap();

        assert_eq!(dataset.row_count, 3);
        assert_eq!(dataset.scanned_rows, 3);
        assert!(matches!(dataset.coverage, DatasetCoverage::Sampled));
        assert_eq!(dataset.source_total, None);
        let result = engine.query(QueryRequest {
            operation_id: "first-rows".into(),
            workspace_id: "workspace-stream".into(),
            sql: format!("SELECT id FROM {} ORDER BY id", dataset.relation_name),
            limit: 10,
        }).unwrap();
        assert_eq!(result.rows, vec![
            vec![JsonValue::from(0)],
            vec![JsonValue::from(1)],
            vec![JsonValue::from(2)],
        ]);
    }

    #[test]
    fn imports_a_repeatable_reservoir_sample_from_a_source_stream() {
        let (port, server) = serve_stream(100);
        let engine = DataEngine::open_in_memory().unwrap();
        let selection = ImportSelection::Reservoir { rows: 10, seed: 42 };
        let dataset = engine
            .import_source(source_request(selection.clone()), "test-token", port)
            .unwrap();
        server.join().unwrap();

        assert_eq!(dataset.row_count, 10);
        assert_eq!(dataset.scanned_rows, 100);
        assert_eq!(dataset.source_total, Some(100));
        assert!(matches!(dataset.coverage, DatasetCoverage::Sampled));
        let result = engine.query(QueryRequest {
            operation_id: "reservoir-rows".into(),
            workspace_id: "workspace-stream".into(),
            sql: format!("SELECT id FROM {}", dataset.relation_name),
            limit: 20,
        }).unwrap();
        let expected = select_rows(
            &(0..100).map(|id| vec![JsonValue::from(id)]).collect::<Vec<_>>(),
            &selection,
        ).unwrap();
        assert_eq!(result.rows, expected);
    }

    #[test]
    #[ignore = "five-million-row throughput benchmark; run explicitly on release candidates"]
    fn benchmarks_five_million_streamed_rows_without_grid_materialization() {
        let rows = 5_000_000;
        let (port, server) = serve_stream(rows);
        let engine = DataEngine::open_in_memory().unwrap();
        let started = std::time::Instant::now();
        let dataset = engine.import_source(source_request(ImportSelection::Full), "test-token", port).unwrap();
        server.join().unwrap();
        assert_eq!(dataset.row_count, rows);
        eprintln!("five-million-row import: {:?}, {} bytes", started.elapsed(), dataset.approximate_bytes);
    }

    #[test]
    fn exports_and_reimports_complete_csv_and_parquet_files() {
        let engine = DataEngine::open_in_memory().unwrap();
        let dataset = engine.import_result(request("workspace-files")).unwrap();
        let base = std::env::temp_dir().join(format!("omni-sql-test-{}", random_id().unwrap()));
        let csv_path = base.with_extension("csv");
        let parquet_path = base.with_extension("parquet");
        let sql = format!("SELECT id, amount FROM {}", dataset.relation_name);
        for (operation_id, path, format) in [
            ("export-csv", csv_path.clone(), ExportFormat::Csv),
            ("export-parquet", parquet_path.clone(), ExportFormat::Parquet),
        ] {
            let exported = engine.export_query(ExportRequest {
                operation_id: operation_id.into(),
                workspace_id: "workspace-files".into(),
                sql: sql.clone(),
                path,
                format,
            }).unwrap();
            assert_eq!(exported.rows, 1);
            assert!(exported.bytes > 0);
        }

        let imported_csv = engine.import_file(FileImportRequest {
            operation_id: "import-csv".into(),
            workspace_id: "workspace-files".into(),
            name: "CSV copy".into(),
            path: csv_path.clone(),
            format: FileFormat::Csv,
            selection: ImportSelection::Full,
        }).unwrap();
        let imported_parquet = engine.import_file(FileImportRequest {
            operation_id: "import-parquet".into(),
            workspace_id: "workspace-files".into(),
            name: "Parquet copy".into(),
            path: parquet_path.clone(),
            format: FileFormat::Parquet,
            selection: ImportSelection::Full,
        }).unwrap();
        assert_eq!(imported_csv.row_count, 1);
        assert_eq!(imported_parquet.row_count, 1);
        let _ = std::fs::remove_file(csv_path);
        let _ = std::fs::remove_file(parquet_path);
    }

    #[test]
    fn disables_external_access_and_locks_the_configuration() {
        let engine = DataEngine::open_in_memory().unwrap();
        let inner = engine.inner.lock().unwrap();
        let external_access: bool = inner
            .connection
            .query_row(
                "SELECT current_setting('enable_external_access')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!external_access);
        assert!(inner
            .connection
            .execute_batch("SET enable_external_access = true")
            .is_err());
    }

    #[test]
    fn imports_queries_lists_and_drops_a_partial_snapshot() {
        let engine = DataEngine::open_in_memory().unwrap();
        let dataset = engine.import_result(request("workspace-a")).unwrap();
        assert_eq!(dataset.relation_name, "orders");
        assert!(matches!(dataset.coverage, DatasetCoverage::Truncated));
        assert_eq!(dataset.columns[1].data_type, "DECIMAL(18,2)");
        let result = engine
            .query(QueryRequest {
                operation_id: "query-1".into(),
                workspace_id: "workspace-a".into(),
                sql: format!("SELECT id, amount FROM {}", dataset.relation_name),
                limit: 10,
            })
            .unwrap();
        assert_eq!(
            result.rows,
            vec![vec![JsonValue::from(1), JsonValue::String("10.25".into())]]
        );
        assert_eq!(engine.list_datasets("workspace-a").unwrap().len(), 1);
        assert!(engine.drop_dataset("workspace-a", &dataset.id).unwrap());
        assert!(engine.list_datasets("workspace-a").unwrap().is_empty());
    }

    #[test]
    fn gives_imported_datasets_readable_unique_relation_names() {
        let engine = DataEngine::open_in_memory().unwrap();
        let first = engine.import_result(request("workspace-names")).unwrap();
        let second = engine.import_result(request("workspace-names")).unwrap();
        assert_eq!(first.relation_name, "orders");
        assert_eq!(second.relation_name, "orders_2");
    }

    #[test]
    fn renames_dataset_and_its_sql_relation_without_losing_rows() {
        let engine = DataEngine::open_in_memory().unwrap();
        let dataset = engine.import_result(request("workspace-rename")).unwrap();
        let renamed = engine.rename_dataset("workspace-rename", &dataset.id, "Quarterly Orders").unwrap();
        assert_eq!(renamed.name, "Quarterly Orders");
        assert_eq!(renamed.relation_name, "quarterly_orders");
        let result = engine.query(QueryRequest {
            operation_id: "query-renamed".into(), workspace_id: "workspace-rename".into(),
            sql: "SELECT count(*) AS total FROM quarterly_orders".into(), limit: 10,
        }).unwrap();
        assert_eq!(result.rows, vec![vec![JsonValue::from(1)]]);
    }

    #[test]
    fn materializes_stable_result_handles_and_pages_them_with_workspace_ownership() {
        let engine = DataEngine::open_in_memory().unwrap();
        let dataset = engine.import_result(request("workspace-pages")).unwrap();
        let handle = engine.start_query(QueryStartRequest {
            operation_id: "stable-start".into(),
            workspace_id: "workspace-pages".into(),
            sql: format!("SELECT id FROM {} UNION ALL SELECT 2 UNION ALL SELECT 3", dataset.relation_name),
        }).unwrap();
        assert_eq!(handle.row_count, 3);
        let page = engine.query_page(QueryPageRequest {
            operation_id: "stable-page".into(),
            workspace_id: "workspace-pages".into(),
            handle_id: handle.id.clone(),
            offset: 1,
            limit: 1,
        }).unwrap();
        assert_eq!(page.rows, vec![vec![JsonValue::from(2)]]);
        assert!(page.rows_more_available);
        assert!(engine.query_page(QueryPageRequest {
            operation_id: "stable-wrong-workspace".into(),
            workspace_id: "workspace-other".into(),
            handle_id: handle.id.clone(),
            offset: 0,
            limit: 1,
        }).is_err());
        assert!(engine.drop_result_handle("workspace-pages", &handle.id).unwrap());
    }

    #[test]
    fn enforces_workspace_ownership() {
        let engine = DataEngine::open_in_memory().unwrap();
        let dataset = engine.import_result(request("workspace-a")).unwrap();
        assert!(engine.drop_dataset("workspace-b", &dataset.id).is_err());
        assert!(engine
            .query(QueryRequest {
                operation_id: "query-2".into(),
                workspace_id: "workspace-b".into(),
                sql: format!("SELECT * FROM {}", dataset.relation_name),
                limit: 10,
            })
            .is_err());
    }

    #[test]
    fn rejects_multiple_or_unsafe_statements_before_preparing() {
        for sql in [
            "SELECT 1; DROP TABLE anything",
            "COPY (SELECT 1) TO 'result.csv'",
            "SELECT * FROM read_csv_auto('secret.csv')",
            "SELECT * FROM delta_scan('s3://other-bucket/data')",
            "SELECT * FROM glob('s3://other-bucket/*')",
            "PRAGMA enable_external_access=true",
        ] {
            assert!(validate_read_only_sql(sql).is_err(), "accepted {sql}");
        }
        assert!(validate_read_only_sql("WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
        assert!(validate_s3_sql("SELECT * FROM 's3://unregistered/private.parquet'").is_err());
        assert!(validate_s3_sql("SELECT * FROM 'https://unregistered/private.parquet'").is_err());
        assert!(validate_s3_sql("SELECT * FROM registered_orders").is_ok());
        assert!(validate_s3_uri("s3://bucket/path.parquet").is_ok());
        assert!(validate_s3_uri("s3://bucket@host/path.parquet").is_err());
        assert!(validate_s3_uri("s3://bucket/path\n.parquet").is_err());
    }

    #[test]
    fn rolls_back_failed_imports_and_disambiguates_duplicate_columns() {
        let engine = DataEngine::open_in_memory().unwrap();
        let mut import = request("workspace-a");
        import.columns[1].name = "id".into();
        import.rows[0][0] = JsonValue::String("not-an-integer".into());
        assert!(engine.import_result(import).is_err());
        assert!(engine.list_datasets("workspace-a").unwrap().is_empty());

        let mut import = request("workspace-a");
        import.operation_id = "import-2".into();
        import.columns[1].name = "id".into();
        let dataset = engine.import_result(import).unwrap();
        assert_eq!(dataset.columns[0].name, "id");
        assert_eq!(dataset.columns[1].name, "id_2");
    }

    #[test]
    fn interrupts_only_the_matching_active_operation() {
        let engine = Arc::new(DataEngine::open_in_memory().unwrap());
        let worker = Arc::clone(&engine);
        let query = thread::spawn(move || {
            worker.query(QueryRequest {
                operation_id: "long-query".into(),
                workspace_id: "workspace-a".into(),
                sql: "SELECT sum(i) FROM range(100000000000) AS values(i)".into(),
                limit: 10,
            })
        });

        for _ in 0..100 {
            if engine.current_operation.lock().unwrap().as_deref() == Some("long-query") {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        assert!(!engine.cancel("different-query").unwrap());
        assert!(engine.cancel("long-query").unwrap());
        assert!(query.join().unwrap().is_err());
        assert!(engine.current_operation.lock().unwrap().is_none());
        assert_eq!(engine.query(QueryRequest {
            operation_id: "after-cancel".into(), workspace_id: "workspace-a".into(),
            sql: "SELECT 1".into(), limit: 10,
        }).unwrap().rows, vec![vec![JsonValue::from(1)]]);
    }

    #[test]
    fn supports_first_n_and_repeatable_reservoir_samples() {
        let rows = (0..100)
            .map(|value| vec![JsonValue::from(value)])
            .collect::<Vec<_>>();
        let first = select_rows(&rows, &ImportSelection::FirstN { rows: 3 }).unwrap();
        assert_eq!(first, rows[..3]);
        let selection = ImportSelection::Reservoir { rows: 10, seed: 42 };
        let a = select_rows(&rows, &selection).unwrap();
        let b = select_rows(&rows, &selection).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 10);
        assert_ne!(a, rows[..10]);
    }
}
