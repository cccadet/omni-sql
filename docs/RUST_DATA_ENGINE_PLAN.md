# Rust data engine: current architecture and consolidation plan

Updated: 2026-09-25. Reviewed against main at `f52c766`.

The Rust/DuckDB analytical engine is implemented. The next phase consolidates
correctness, recovery, and the integrated IDE workflows. Node remains the owner
of relational connections, adapters, metadata, autocomplete orchestration, and MCP.

The original M0–M5 milestones and historical measurements are preserved in the
[original plan](archive/plans/RUST_DATA_ENGINE_PLAN_V0_3.md). They are historical
acceptance targets, not evidence that every criterion passed. The
[prioritized TODO](RUST_DATA_ENGINE_TODO.md) is the active delivery checklist.

## Current architecture

```text
React / main SQL editor / Objects
   |
   +-- JSON-RPC --> Node backend
   |                 +-- relational adapters, metadata, MCP
   |                 +-- authenticated bounded NDJSON source stream
   |                                      |
   +-- Tauri analysis_* commands ----------+--> Rust / DuckDB
                                               +-- persistent local.duckdb
                                               +-- dataset registry
                                               +-- local file import/export
                                               +-- separate S3 reader connections
```

Rust owns analytical execution, local datasets, file operations, and S3 scans.
S3 credentials are obtained through the backend connection flow and passed to
Rust readers; they must not enter dataset provenance or routine logs.
The engine uses a mutex and one active operation, with interruption/status APIs.
A dedicated worker/queue is conditional on measured need.

## Implemented paths and acceptance focus

| Path | Current behavior | Remaining focus |
|---|---|---|
| Displayed result | Bounded grid snapshot import | Truncation and inherited type limitations |
| Relational source | Typed NDJSON; full, first-N, seeded reservoir ingestion | End-to-end fidelity and recovery per adapter |
| Local files | CSV, JSON, Parquet import; engine selection support | Consistent UI choices and provenance |
| Local SQL | Main editor queries local DuckDB with bounded previews | Lifecycle, export parity, optional paging |
| S3 SQL | Registered CSV/Parquet/Delta/Iceberg scans | Reader restrictions, extensions, cancellation, budgets |
| S3 + local joins | Temporary Parquet staging into the reader connection | Cost, cleanup, interruption, input coverage |

The main IDE now integrates S3 and local DuckDB connections and Objects. The
AnalysisWorkspace component also remains in the code; acceptance must account
for reachable entry points rather than assuming only the original workspace.

## Decisions that still apply

- Grid output limits are independent from ingestion and analytical input size.
  Changing a preview limit must not change an aggregate over all loaded rows.
- Full, first-N, and reservoir have distinct semantics. First-N is a prefix;
  reservoir scans the source while retaining fewer rows. A failed full import
  must not silently become a successful partial dataset.
- Preserve exact large integers/decimals, temporal semantics, binary and nulls.
  Explicitly report unsupported conversions and inherited snapshot limitations.
- Keep bounded typed NDJSON until benchmarks justify Arrow IPC including producer
  conversion costs. Arrow file I/O and export already exist.
- Maintain ownership, cancellation identity, rollback, bounded responses, and
  publication of imported datasets only after successful completion.
- Ordinary editor identifiers may omit quotes; engine-generated SQL must still
  escape identifiers safely. Names needing quotes retain them.
- Keep sampled/truncated provenance through joins and exports. Full output export
  does not restore rows excluded during ingestion.
- Rust adapter migration requires measured benefit and behavioral parity.

## Revised lifecycle and security model

The application opens persistent `local.duckdb` and reloads dataset metadata from
`omni_local_dataset_registry`. The original session-only assumption is obsolete.
Define and verify separate lifetimes for durable datasets, workspace state,
result handles, and temporary staging. Closing an editor must not be assumed to
mean deleting durable data. Restart, rename/drop/clear, and registry consistency
require explicit acceptance coverage.

The local analytical connection uses restricted configuration. S3 uses separate
connections with external access required for remote scans. Readers install/load
required extensions and register sources before disabling automatic extension
loading/installation, disabling LocalFileSystem, and locking configuration for
editor execution. A blanket claim that all connections disable external access
is therefore inaccurate.

Verify allowed-source boundaries, prohibited SQL, credentials handling, extension
failures, and installed/offline behavior in the remote context as well as locally.
This is missing acceptance evidence, not a claim of a confirmed security defect.

## Resource model

Current constants include a 512 MB DuckDB memory limit, two threads, a 10,000-row
preview ceiling, a 16 MiB preview byte ceiling, and a 4 GiB per-dataset byte budget.
They do not establish a process-wide RSS or total-disk guarantee.

Measure local and remote connections, driver buffers, temporary Parquet staging,
and persistent storage together. Audit which budgets cover each path. Add budget
controls only when measurements and supported-machine needs justify them.

## Consolidation phases

1. **P1 — Correctness and lifecycle:** type fidelity, durable dataset lifecycle,
   S3 execution boundaries, and provenance across current entry points.
2. **P2 — Recovery, capacity, and IDE consistency:** cancellation/failure coverage,
   realistic resource measurements, import/export parity, and documentation.
3. **P3 — Demand-driven improvements:** UI paging, budget controls, local per-input
   sampling, and worker/queue changes where justified.

Existing Docker source-stream smoke tests and unit tests are useful evidence,
but do not prove exact types after Rust ingestion or the complete stress matrix.
A missing test is not automatically a product defect.

## Validation and completion

Test source → transport → DuckDB → query/export. Include PostgreSQL,
MySQL/MariaDB, SQL Server, Oracle, JDBC, and ODBC with real available test sources;
record untested combinations explicitly. Cover local files and S3 formats separately.

For implementation changes, run targeted tests and repository-required checks,
including `pnpm verify` and relevant Rust checks/tests. Record commit, environment,
fixtures, and results for integration/performance evidence. Historical benchmark
and packaging numbers must not be presented as current measurements.

Consolidation is complete when the TODO P1/P2 criteria have evidence, documented
limitations are visible where they affect results, and instructions match current
IDE flows. Arrow transport and Rust adapter migration do not block completion.
