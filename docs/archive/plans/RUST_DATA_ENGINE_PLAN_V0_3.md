> Historical plan archived on 2026-09-24. Its session-only and standalone-workspace assumptions are superseded by the [current plan](../../RUST_DATA_ENGINE_PLAN.md). Measurements below describe the original implementation, not the current build.

# Rust Data Engine Plan

Status: analytical MVP shipped; M0–M4 functionality is substantially implemented,
but some original acceptance criteria remain open. M5 is optional and deferred.

Delivery: merged into `main` for v0.3.0

Last updated: 2026-09-23

## Implementation record

The analytical MVP is implemented in the desktop application. The shipped path uses
DuckDB 1.10505 through `duckdb-rs`, Arrow/Parquet 58, an authenticated bounded
NDJSON source stream, Arrow batches for local file I/O, and Tauri commands under
the `analysis_` prefix. PostgreSQL, Oracle, MySQL/MariaDB, SQL Server, and generic
JDBC now implement live-source streaming. Cross-dialect type-fidelity and failure
recovery evidence still needs to be completed before declaring every original
per-adapter acceptance criterion satisfied.

The completed implementation includes:

- bounded snapshot imports and direct Appender-based source ingestion;
- full, first-N, and seeded reservoir selection with coverage provenance;
- progress counters, coordinated source/DuckDB cancellation, transactional
  rollback, one active operation, and bounded frames, datasets, previews, and
  stable result handles;
- local joins across multiple database sources and CSV/Parquet datasets in one
  workspace, plus workspace ownership and cleanup;
- read-only SQL policy, locked DuckDB configuration, 512 MiB memory, two threads,
  a 4 GiB owned spill directory, and cleanup of current/stale owned artifacts;
- complete streaming CSV/Parquet export, Arrow IPC export, and scoped
  CSV/Parquet import using Arrow record batches;
- a desktop workflow that distinguishes displayed rows from a newly executed
  source query and explains full/prefix/reservoir cost semantics.

The database-to-Rust transport remains typed NDJSON rather than Arrow IPC.
The drivers currently produce row objects, so converting those rows to
Arrow in Node and immediately decoding them in Rust would add another conversion
and dependency without a measured source-side benefit. Arrow IPC is implemented
for local export, while source transport can change behind the same batch
contract after a producer benchmark demonstrates an improvement.

Verification on Windows x64 with rustc 1.98.0 and cargo 1.98.0:

- `cargo test --lib`: 36 passed;
- explicit five-million-row streaming benchmark: 5,000,000 rows in 24.32 s in
  the debug test profile, 43,888,890 retained JSON bytes, with both test producer
  and Rust consumer operating in batches;
- desktop Vitest: 172 passed; backend: 64 passed; the monorepo typecheck and lint
  completed without errors (existing warnings remain);
- production frontend build completed in 42.68 s;
- cold `cargo build --release` completed in 25m16s; the resource-bundled Tauri
  rebuild completed in 3m53s;
- packaged executable: 59,660,288 bytes; MSI: 148,457,437 bytes; NSIS installer:
  97,881,632 bytes. MSI and NSIS packaging both completed successfully.

The original M0–M4 text below records the intended milestones; it should not be
read as a claim that every deliverable and exit test passed. In particular,
per-dataset sampling at local query time, user-configurable analytical budgets,
a dedicated worker/queue, and the broader cross-dialect fidelity and stress-test
matrix remain open. The prioritized, evidence-based checklist is in
[current TODO](../../RUST_DATA_ENGINE_TODO.md).

M5 was not started. No measured product or operational benefit currently
justifies replacing the mature Node adapters, which is the explicit M5 gate.

## Decision

Add a Rust data engine dedicated to local analytics, DuckDB, Arrow, and
large-dataset movement without rewriting the existing Node/TypeScript backend.
The Node backend remains the owner of database connections, metadata,
autocomplete, MCP, security policy, and the current JSON-RPC API.

This is an incremental architectural extension, not a commitment to a backend
rewrite. Adapter migration remains optional and requires measured benefit and
behavioral parity. Rust enforces its own analytical access/resource policy;
Node's security boundary does not automatically cover direct Tauri commands.

Visualization limits and analytical capacity are separate. The current
10,000-row interactive cap protects the grid and JSON transport. It must not
become the analytical dataset limit. Large ingestion streams directly from Node
source adapters to Rust, with authentication and backpressure, bypassing React,
the grid, and the existing materialized QueryResult path.

Users choose full load or sample during ingestion, and all loaded rows or an
explicit sample during local analysis. Preview output limits are independent of
both selections. M2 is a snapshot preview; M3 is required to complete the
large-volume analytical MVP.

## Goals

- Embed DuckDB in the desktop application without requiring a system install.
- Provide an `Analyze locally` workflow for existing query results.
- Establish bounded dataset lifecycle, cancellation, progress, and cleanup.
- Create a path from row-based imports to Arrow batch streaming.
- Keep the existing frontend and Node backend operational throughout the work.
- Preserve the option to migrate database adapters to Rust individually later.
- Analyze millions of rows without materializing the source dataset in Node/UI.
- Join snapshots from different connections and disclose their source coverage.
- Offer full/sample ingestion and analytical input selection with explicit semantics.

## Non-goals for the initial delivery

- Rewriting all database adapters in Rust.
- Removing the Node backend or JVM/Calcite sidecar.
- Sending millions of rows through the current `QueryResult` JSON contract.
- Implementing cross-source joins directly against live remote databases.
- Allowing unrestricted DuckDB extension installation or arbitrary file access.

## Target architecture

```text
React UI
   |
   +-- HTTP JSON-RPC --> Node backend
   |                      +-- existing database adapters
   |                      +-- metadata/autocomplete
   |                      +-- MCP and security policy
   |
   +-- Tauri commands --> Rust data engine
                          +-- DuckDB runtime
                          +-- local datasets
                          +-- analytical queries
                          +-- Parquet/CSV export
                          +-- direct authenticated batch ingestion from Node (M3)
                          +-- Arrow IPC when validated against a baseline
```

The Rust engine is not a second general-purpose application backend. Its API is
restricted to local dataset and analytical operations.

## API boundary

The first API is exposed through Tauri commands. Names are prefixed with
`analysis_` to avoid confusing them with the existing backend RPC methods.

Initial commands:

- `analysis_import_result`: create a temporary dataset from a bounded
  `QueryResult`-shaped payload.
- `analysis_query`: execute a read-only query against local datasets with a
  required output preview limit and explicit full/sample input selection.
- `analysis_list_datasets`: return dataset identity, schema, row count, and
  creation time.
- `analysis_drop_dataset`: remove one temporary dataset.
- `analysis_clear`: remove every temporary dataset owned by the current app
  workspace.
- `analysis_cancel`: cancel a specific operationId, including source ingestion.
- `analysis_operation_status`: state and scanned/retained/output row and byte counts.

M3 adds a source-ingestion command with full/sample selection and result handles
for bounded stable paging. M4 adds scoped file import/export commands. All commands
validate workspace ownership. Long operations return handles promptly and emit
throttled progress; percentage is absent when total size is unknown.

A dedicated worker owns the DuckDB connection and Appender. Initially use one
active operation and a bounded queue. Cancellation must access an interrupt
handle without waiting for the connection mutex held by execution. Guard operation
identity so a late cancel cannot interrupt the next queued query. States are
queued, running, cancelling, succeeded, cancelled, and failed. Coordinate drop,
workspace close, and cancellation with active work and release source cursors on
every exit. Keep engine logic independent of the Tauri wrapper where practical.

The initial result contract remains JSON-compatible and bounded. Arrow is an
internal/future transport, not a breaking replacement for `QueryResult`.

## Full load, sampling, and preview semantics

Offer three entry points:

1. Analyze displayed result: import the existing bounded grid snapshot.
2. Analyze source query: run a new source execution with full or sample selection.
3. Analyze local datasets: use all loaded rows or an explicit per-dataset sample.

Source ingestion is a new execution, not a continuation or guaranteed identical
snapshot of the displayed result. All loaded rows may still represent only a
sample of the original source. Local sampling cannot recover omitted source rows.

The versioned selection contract distinguishes:

- Full: consume the source to exhaustion, subject to analytical resource budgets.
- First N: retain at most N rows and close the cursor when satisfied. This is a
  deliberately selected prefix, not a random or representative sample. Without
  ordering, the selected rows may vary.
- Reservoir: retain up to N randomly selected rows with bounded storage while
  scanning the complete source result. It reduces retained data but normally
  does not reduce source scan/network cost. Record the seed; reproducibility
  also requires stable source data and row order.

Validate sample sizes and budgets. Source-native percentage/block sampling may
be added through explicit adapter capabilities with its own semantics; never
silently substitute methods or append sampling syntax to arbitrary SQL.

At ingestion start, show full/sample choices, method, requested rows, and expected
scan behavior. While running, show scanned and retained rows/bytes and allow
cancel/restart with another selection. Do not relabel an interrupted full-load
prefix as a random sample. Do not run an expensive COUNT just to show progress.

For local analysis, selection applies to input relations before aggregation or
joins. Configure selection per dataset for joins and disclose that sampling can
change matches. Keep the selected sample stable within an operation/result handle;
do not resample on each output page. Sample aggregates describe the sample: no
automatic population extrapolation or confidence intervals in this scope.

Full-load budget exhaustion fails and rolls back; it never silently becomes a
successful partial load. First-N completion is successful intentional selection;
reservoir completion requires source exhaustion. Preview limits constrain output
only: SUM over five million fully loaded rows includes all five million even if
the UI can display only 1,000 result rows. Changing preview size cannot change
aggregate values; changing input selection can.

## Dataset model

Every dataset has:

- an opaque generated identifier;
- a user-visible name independent of the DuckDB table name;
- an ordered schema with source type metadata;
- row count and approximate byte count;
- creation timestamp;
- lifetime policy (`session` initially);
- provenance describing the source connection/query when provided.
- workspace ownership and copyable generated SQL relation name;
- selection method, seed where applicable, target/actual retained rows, scanned
  rows, known source total, and inherited fidelity limitations;
- requested-selection completion separately from source coverage: complete,
  sampled, truncated, or unknown.

Preserve rowsMoreAvailable on grid imports and visibly label partial snapshots,
for example: "Analyzing the first 10,000 rows; more rows exist at the source."
Complete means complete for the source query, including its own SQL LIMIT, not
the entire table. A sample can be successfully loaded without complete source
coverage. Descendant results retain selection/coverage provenance from all inputs.
Record source execution times: cross-connection joins do not imply a shared
transactional snapshot. Provenance excludes credentials.

Preserve original column labels separately and deterministically disambiguate
duplicate or empty names. Expose safe SQL names in the schema browser.

User-provided names are never interpolated into SQL. Internal table names are
generated by the engine and identifiers are quoted defensively.

## Type policy

Define a versioned analytical DataSchema and encoding before M1. The current
QueryResult's generic dataType labels and unknown[][] are not a lossless wire
format. Include integer width/signedness, decimal precision/scale, temporal
precision/timezone semantics, binary encoding, and nullability. Encode large
integers and decimals as exact strings at JSON boundaries, binary as base64, and
floating-point special values explicitly. Distinguish civil timestamps from
instants. Preserve unsupported decimal precision as text with a visible need
for explicit conversion before numerical operations.

Audit driver settings and producer conversions before precision is lost. Allow
compatible metadata/encoding additions to existing adapters and contracts. Rust
cannot restore information already lost in a grid snapshot: reject ambiguous
unsupported values or clearly disclose inherited limitations. Full-query
ingestion uses the fidelity-preserving producer path. Test each enabled source
before rollout rather than postponing all fidelity checks until Arrow.

The initial implementation must preserve common analytical types:

- null and boolean;
- signed integers;
- floating-point values;
- strings;
- binary values;
- dates and timestamps represented losslessly at the API boundary;
- JSON as validated text when a direct mapping is unavailable.

`DECIMAL` must not be silently converted to floating point. Until arbitrary
precision transport is implemented, decimal values are stored using a declared
DuckDB decimal when precision/scale are known, otherwise as lossless text with
source type metadata.

Unsupported or ambiguous values produce an explicit import error containing
the row and column index. They are never silently stringified.

## Safety and resource limits

- Snapshot imports accept available grid rows (currently at most 10,000), plus
  explicit payload/cell byte caps. Full analytical ingestion has no grid row cap.
- Preview responses/pages have output row and serialized-byte caps. Full export
  streams complete selected-query output under storage budgets, not preview caps.
- SQL accepted by `analysis_query` is read-only in the initial UI workflow.
- DuckDB external access and extension installation are disabled by default.
- Memory and temporary-directory limits are configured explicitly.
- Dataset removal and application shutdown release DuckDB resources.
- Partial imports run in a transaction and roll back completely on failure.
- File reads and exports require a path selected through the existing native
  file-dialog workflow.

M0 must specify concrete defaults and validated ranges for snapshot/cell bytes,
preview rows/bytes, memory/threads, dataset count, queue length, result-handle
retention, and interactive deadlines. M3 validates batch rows/bytes, in-flight
capacity, long-ingestion deadlines, dataset/spill storage quotas, and minimum
free disk; M4 validates export budgets. Each stage must settle its defaults before
shipping. Expose analytical budget configuration within validated ranges.

DuckDB memory_limit is not a hard process RSS cap. Account for driver buffers,
IPC copies, serialization, and other allocations; measure peak memory/disk and
use bounded queues/backpressure. Implement crash-safe owned-artifact cleanup as
soon as temporary files are introduced. Never materialize all output then truncate.

Read-only policy uses DuckDB-compatible statement parsing/metadata, permits one
approved statement, and rejects writes, ATTACH, COPY, INSTALL/LOAD, configuration
changes, and unsupported commands. A SELECT prefix check is insufficient, and
read-only table functions may still access files. Disable external access and
extension autoload/install, lock configuration after initialization, and test
bypass attempts against the pinned version.

Use dedicated path-scoped file commands; do not globally enable external access
for user SQL. Validate coexistence with locked settings, using a separate
restricted context if needed. Appender is used from M1, including row imports:
explicitly flush and check errors before commit; destructor flush is insufficient.
Do not publish a dataset before commit. Errors identify batch/row/column without
including values. Cleanup touches only artifacts owned by the engine.

## Delivery milestones

### M0 — Architecture and build spike

Initial Windows measurements on the development machine (2026-09-21; cold local
cache, dev profile) were 22m25s for `cargo check` and 10m14s for the first test
executable build after that check. These are observations, not CI targets. Cache
`libduckdb-sys` native artifacts and record hardware/toolchain details in formal
benchmarks before setting performance gates.

Deliverables:

- this decision document;
- pinned `duckdb-rs` dependency with the `bundled` feature;
- successful `cargo check` and test build on Windows;
- measurement of build time and release binary-size impact;
- documented compatibility between Rust, DuckDB, and Arrow versions.
- worker/interrupt, Appender flush/rollback, and SQL policy prototypes;
- concrete M1 type/resource defaults and benchmark protocol for streaming;
- authenticated Node-to-Rust transport candidates and in-process failure boundary:
  native crashes or process memory exhaustion can affect the shell. Evaluate a
  separate Rust worker only if reliability measurements justify it.

Exit criteria:

- DuckDB opens an in-memory database and executes a smoke query in a Rust test;
- the normal desktop build still succeeds.
- interruption works during execution and M1 contract/limit decisions are recorded.

### M1 — Bounded local-analysis engine

Deliverables:

- isolated Rust `data_engine` module;
- managed engine state and generated dataset identifiers;
- transactional bounded import;
- read-only bounded queries;
- list, drop, clear, and cancel operations;
- unit tests for identifiers, types, limits, rollback, and lifecycle;
- TypeScript wrapper for the Tauri commands.

Exit criteria:

- a frontend test can import a `QueryResult`, run an aggregate query, and drop
  the dataset;
- existing callers and interactive behavior remain compatible; additive producer
  metadata/encoding changes are allowed when required for fidelity;
- completeness, sampling provenance, ownership, cancel races, and byte caps are tested;
- Rust, frontend typecheck, lint, and tests pass.

### M2 — `Analyze locally` user workflow

Deliverables:

- action in the results grid;
- local-analysis workspace/editor state;
- dataset name and schema presentation;
- progress, cancellation, errors, and empty-result handling;
- clear indication that the imported data is a snapshot;
- localization and accessibility coverage.
- join two local snapshots, including from different source connections;
- full-loaded-input versus local sample selection with explicit per-input semantics;
- visible sampling/truncation provenance, safe SQL names, and duplicate-column handling.

Exit criteria:

- users can analyze a result without modifying the source connection;
- closing the workspace releases its session datasets;
- UI tests cover success, cancellation, limits, and failure.
- sample/full local execution and cross-snapshot joins are tested. This milestone
  is a snapshot preview, not completion of large-volume analytics.

### M3 — Full/sample streaming analytical MVP

Deliverables:

- backend batch-source abstraction with backpressure;
- dataset-sink abstraction in the Rust engine;
- progress in rows and bytes;
- coordinated cancellation of source read and DuckDB ingest;
- disk spill policy and crash-safe cleanup;
- integration test using a dataset larger than the results-grid cap.
- separate adapter batch API independent of interactive query.run limits, using
  real cursor/stream reads rather than materializing the source before yielding;
- direct authenticated/versioned Node-to-Rust transport with bounded frames,
  backpressure, operation ownership, and disconnect cleanup;
- full, first-N, and reservoir source ingestion with UI selection and cost disclosure;
- bounded stable output paging/result handles and resource configuration;
- per-adapter streaming, fidelity, and cancellation capability gates.

The conceptual contracts are:

```ts
interface BatchSource {
  schema(): Promise<DataSchema>;
  read(signal: AbortSignal): AsyncIterable<DataBatch>;
  close(): Promise<void>;
}

interface DatasetSink {
  begin(schema: DataSchema, context: IngestContext): Promise<void>;
  append(batch: DataBatch): Promise<void>; // waits for bounded capacity
  commit(): Promise<DatasetRef>;
  rollback(): Promise<void>;
}
```

The coordinator applies selection, closes the source on every exit, and rolls
back unsuccessful ingestion. Cancellation/deadlines also cover backpressure waits.
Evaluate Arrow IPC first against a simple bounded typed-batch baseline. Adopt it
in M3 when appropriate; do not require a proprietary binary intermediate. Never
collect the complete stream into an array of rows or RecordBatches.

Exit criteria:

- Analyze at least five million representative rows on documented hardware without
  full Node/UI materialization; benchmark wide and large-cell data separately.
- Verify full aggregates against a reference including rows beyond the grid cap;
  varying preview size must not change values.
- Verify sample sizes, method/seed behavior on stable inputs, small/empty sources,
  scanned/retained counters, and no hidden population extrapolation.
- Demonstrate bounded buffers, spill under constrained memory, and quota failures
  without publishing incomplete data as a successful full load.
- Test cancel during read/backpressure/append/query, disconnect/crash recovery,
  and a successful next operation. Meet recorded resource budgets and report
  throughput; row count alone is not a performance guarantee.

### M4 — File workflows, export, and Arrow optimization

Deliverables:

- Arrow `RecordBatch` ingestion into DuckDB;
- Arrow IPC transport between producers and the Rust engine;
- streaming Parquet export;
- benchmarks against the row-based path;
- type-fidelity suite across PostgreSQL, MySQL, SQL Server, and Oracle.
- scoped CSV/Parquet imports with full/sample selection and joins with local datasets;
- complete streaming CSV/Parquet query exports independent of preview limits,
  retaining sampled-input provenance in metadata/sidecar where applicable.

Arrow work applies here only where not already adopted in M3. Measure actual
copy/conversion costs; Arrow does not imply zero-copy from existing drivers.
Exporting all result rows does not undo input sampling.

Exit criteria:

- measurable memory or throughput improvement justifies Arrow complexity;
- decimal, timestamp, binary, JSON, null, and large-string cases round-trip
  according to the documented policy.

### M5 — Optional adapter migration

Database adapters move to Rust only when there is a demonstrated product or
operational benefit. Suggested order:

1. PostgreSQL;
2. MySQL/MariaDB;
3. SQL Server;
4. Oracle;
5. generic JDBC remains in the JVM unless separately replaced.

Each migrated adapter must pass the existing behavioral and integration suite
before the Node implementation is removed. Autocomplete and MCP are migrated
independently and are not coupled to adapter migration.

## Testing strategy

- Rust unit tests for type conversion, query classification, limits, and state.
- Rust integration tests against an in-memory DuckDB database.
- Contract tests for Tauri command serialization.
- Vitest coverage for the TypeScript wrapper and UI workflow.
- Existing `pnpm verify` remains mandatory.
- `cargo test` and `cargo check` remain mandatory.
- Release packaging is tested on every supported target before enabling the
  feature by default.

## Observability

Record structured events for:

- dataset creation and deletion;
- imported row and byte counts;
- import/query duration;
- cancellation and rollback;
- memory-limit or disk-limit failures;
- startup cleanup of abandoned temporary artifacts.
- selection method, coverage, scanned versus retained rows, queue depth, and
  measured memory/disk peaks. Routine logs also exclude SQL text.

Logs must not contain query result values or credentials.

## Rollout

1. Keep the feature behind a desktop feature flag during M0 and M1.
2. Enable it for development builds after contract tests pass.
3. Ship `Analyze locally` as an opt-in preview after M2.
4. Add large-result streaming only after M3 resource and cancellation tests.
5. Do not begin a general backend rewrite based solely on completion of M1–M4.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Larger or slower native builds | Pin versions, cache native builds, measure release artifacts in M0 |
| Two execution paths confuse ownership | Restrict Rust API to `analysis_*`; Node remains source-database owner |
| Type loss during import | Explicit type policy and cross-database fidelity tests |
| Memory exhaustion | Layer-specific byte budgets, bounded batches, measured RSS, disk quotas/spill |
| Misleading aggregates | Separate input selection, source coverage, and output preview caps |
| Biased or costly sampling | Explicit method, scan-cost disclosure, seed and provenance |
| SQL or file-system escape | Read-only workflow, disabled external access, native path selection |
| Orphaned temporary data | Session ownership, transactional import, startup/shutdown cleanup |
| Premature Arrow complexity | Ship bounded row-based workflow first and require benchmark evidence |

## Completion definition

M2 completes the opt-in snapshot preview. M3 is required to complete the analytical
MVP: users can choose full or sampled large-source ingestion, analyze/join local
datasets, inspect bounded output, cancel work, and clean up within tested budgets.
Enable full/sample ingestion only for adapters passing fidelity, streaming, and
cancellation gates. M4/M5 have separate acceptance and do not block M3 completion.

## Technical references

Validate behavior against the pinned version during implementation:

- [Connection and interruption](https://docs.rs/duckdb/latest/duckdb/struct.Connection.html)
- [Appender and explicit flush](https://docs.rs/duckdb/latest/duckdb/struct.Appender.html)
- [Security and configuration locking](https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview)
- [Memory-limit caveats](https://www.duckdb.org/docs/current/guides/performance/oom)
