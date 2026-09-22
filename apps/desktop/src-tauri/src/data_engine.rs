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

#[derive(Debug, Clone, Serialize)]
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetColumn {
    pub name: String,
    pub original_name: String,
    pub data_type: String,
    pub source_data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
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
    current_operation: Mutex<Option<String>>,
    operation_status: Mutex<Option<OperationStatus>>,
    source_cancellation: Mutex<Option<SourceCancellation>>,
    cancel_requested: AtomicBool,
    // Declared last so the DuckDB connection is dropped before spill cleanup.
    _temp_directory: TempDirectory,
}

impl DataEngine {
    pub fn open_in_memory() -> Result<Self, String> {
        let temp_directory = TempDirectory(create_temp_directory()?);
        let connection = Connection::open_in_memory()
            .map_err(|error| format!("failed to open the DuckDB data engine: {error}"))?;
        initialize_connection(&connection, &temp_directory.0)?;
        let interrupt = connection.interrupt_handle();
        Ok(Self {
            inner: Mutex::new(EngineInner {
                connection,
                datasets: HashMap::new(),
                result_handles: HashMap::new(),
            }),
            interrupt,
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
            "CREATE TABLE {} ({})",
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
        transaction
            .commit()
            .map_err(|error| format!("snapshot commit failed: {error}"))?;

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
        };
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
            return Err(format!("analytical source stream failed with HTTP {}", response.status()));
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
            "CREATE TABLE {} ({})",
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
        transaction.commit()
            .map_err(|error| format!("source dataset commit failed: {error}"))?;

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
        };
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
        if relation_name != old_relation_name {
            inner.connection.execute_batch(&format!(
                "ALTER TABLE {} RENAME TO {}", quote_identifier(&old_relation_name), quote_identifier(&relation_name)
            )).map_err(|error| format!("failed to rename analytical dataset: {error}"))?;
        }
        let dataset = inner.datasets.get_mut(dataset_id)
            .ok_or_else(|| "analytical dataset was not found".to_string())?;
        dataset.name = name.to_string();
        dataset.relation_name = relation_name;
        Ok(dataset.clone())
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
        inner
            .connection
            .execute_batch(&format!("DROP TABLE {}", quote_identifier(&relation_name)))
            .map_err(|error| format!("failed to drop analytical dataset: {error}"))?;
        inner.datasets.remove(dataset_id);
        Ok(true)
    }

    pub fn clear(&self, workspace_id: &str) -> Result<usize, String> {
        let ids = self
            .list_datasets(workspace_id)?
            .into_iter()
            .map(|dataset| dataset.id)
            .collect::<Vec<_>>();
        let mut dropped = 0;
        for id in ids {
            dropped += usize::from(self.drop_dataset(workspace_id, &id)?);
        }
        let handle_ids = {
            let inner = self.lock()?;
            inner.result_handles.values()
                .filter(|(handle, _)| handle.workspace_id == workspace_id)
                .map(|(handle, _)| handle.id.clone())
                .collect::<Vec<_>>()
        };
        for id in handle_ids {
            dropped += usize::from(self.drop_result_handle(workspace_id, &id)?);
        }
        Ok(dropped)
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

    fn import_file_inner(&self, request: FileImportRequest) -> Result<DatasetRef, String> {
        validate_workspace_id(&request.workspace_id)?;
        if request.name.trim().is_empty() || request.name.len() > 128 {
            return Err("dataset name must contain between 1 and 128 characters".to_string());
        }
        validate_selection(&request.selection)?;
        validate_import_path(&request.path, request.format)?;
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
            "CREATE TABLE {} ({})",
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
        transaction.commit().map_err(|error| format!("file dataset commit failed: {error}"))?;
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
        };
        inner.datasets.insert(id, dataset.clone());
        Ok(dataset)
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
        let bounded_sql = format!(
            "SELECT * FROM ({sql}) AS __omni_analysis_preview LIMIT {}",
            request.limit + 1
        );
        let mut statement = inner
            .connection
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
        let mut rows = Vec::with_capacity(request.limit.min(1024));
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
        let rows_more_available = byte_limit_reached || rows.len() > request.limit;
        rows.truncate(request.limit);
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
    let expected = match format { FileFormat::Csv => "csv", FileFormat::Parquet => "parquet" };
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
        "sqlite_scan",
        "postgres_scan",
    ];
    if let Some(token) = tokens.iter().find(|token| denied.contains(&token.as_str())) {
        return Err(format!("analytical SQL operation is not allowed: {token}"));
    }
    Ok(trimmed)
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
            "PRAGMA enable_external_access=true",
        ] {
            assert!(validate_read_only_sql(sql).is_err(), "accepted {sql}");
        }
        assert!(validate_read_only_sql("WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
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
