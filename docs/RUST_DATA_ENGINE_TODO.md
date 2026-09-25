# Rust data engine: prioritized remaining work

Updated: 2026-09-25. Reviewed against main at `f52c766`.
Scope: the [current consolidation plan](RUST_DATA_ENGINE_PLAN.md), including
main-editor DuckDB/S3 flows. Items are ordered within each priority.
Unchecked items indicate work or missing evidence, not confirmed defects.
Reuse existing tests and record results before marking acceptance complete.

## Existing foundation — do not reimplement

- [x] Embedded Rust/DuckDB engine and analytical command API.
- [x] Bounded source streaming with full/first-N/reservoir ingestion.
- [x] Dataset operations, local queries, cancellation/status APIs, and export.
- [x] Main IDE integration for local DuckDB and S3 Objects/query execution.
- [x] Persistent local database and dataset registry implementation.
- [x] Docker source-stream smoke tests and ODBC streaming unit coverage.

These implementation checks do not assert all acceptance criteria passed. The
Docker streaming smoke test checks five rows and completion; it does not establish
Rust ingestion fidelity, large-volume behavior, or failure recovery.

## P1 — Correctness and lifecycle

- [ ] **P1.1 — Source-to-DuckDB type fidelity.** Run a real-source matrix for
  PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, JDBC, and ODBC where available.
  Cover exact decimals, large integers, temporal precision/time zones, binary,
  JSON, null, and large strings; cover file imports separately.
  **Done when:** imported query/export values match declared source semantics;
  unsupported conversions fail explicitly; driver versions and unavailable
  combinations are recorded instead of claiming blanket support.

- [ ] **P1.2 — Durable dataset lifecycle.** Reconcile persistent storage with old
  session/workspace assumptions. Verify restart, rename/drop/clear, ownership,
  and registry/table consistency across local and federated workspaces.
  **Done when:** intended datasets survive restart, deletion removes intended data
  and metadata, failed imports publish no partial datasets, and documentation/UI
  distinguish durable datasets from temporary handles and staging files.

- [ ] **P1.3 — S3 boundaries and extension behavior.** Test permitted registered
  sources, blocked local-file access and writes, prohibited SQL, credential error
  handling, and extension installation/loading failures. Include CSV, Parquet,
  Delta, Iceberg, and custom endpoints.
  **Done when:** allowed operations work, prohibited operations have regression
  coverage, secrets stay out of errors/logs, and installed/offline extension
  requirements are documented. Fix any findings; local restrictions alone are
  not evidence that the remote reader has equivalent protection.

- [ ] **P1.4 — Type/provenance contract across entry points.** Document NDJSON
  encodings, source execution times, selection semantics, and complete/sampled/
  truncated/unknown coverage for grid, stream, file, S3, join, and export paths.
  **Done when:** partial inputs and independent source snapshots are identifiable;
  bounded imports are not presented as full-table copies, and provenance survives
  restart and accompanies exports where needed to interpret their results.

## P2 — Recovery, capacity, and IDE consistency

- [ ] **P2.1 — Cancellation and failure recovery.** Exercise source reads,
  backpressure, append, local queries, S3 scans, join staging, and exports. Include
  disconnects, malformed/oversized frames, crash cleanup, and rollback.
  **Done when:** cursors and owned temporary artifacts are released, durable data
  stays consistent, and the next operation succeeds in the same workspace.

- [ ] **P2.2 — Realistic resource envelope.** Extend the narrow-row benchmark with
  wide rows, large cells, constrained-memory spill, and S3/local joins. Measure
  Node/Rust memory, temporary/persistent disk, throughput, and staging overhead;
  audit budgets on every path and force quota/low-disk failures.
  **Done when:** failures are controlled and clean up; results record hardware,
  toolchain, commit, inputs, and limits. Use evidence to decide whether staging
  changes or configurable budgets are needed.

- [ ] **P2.3 — Main-editor/workspace consistency.** Check imports, full/sample
  choices, progress/cancel, dataset management, identifier completion, and full
  export across reachable flows. Engine support does not imply UI parity.
  **Done when:** import preserves SQL where intended, selection semantics are
  consistent, grid export and full analytical export are distinguishable, and
  S3 full-export support is explicitly decided/documented. Remove duplicate UI
  only after its useful behavior is covered by the replacement.

- [ ] **P2.4 — Product and architecture documentation.** Refresh README,
  ARCHITECTURE, and relevant troubleshooting/build guidance for persistent DuckDB,
  S3 readers, formats, extension requirements, and validated limitations.
  **Done when:** diagrams and instructions match tested entry points and historical
  measurements remain clearly separated from current evidence.

## P3 — Implement when demand or measurements justify it

The user requested work through P3 on 2026-09-25. Keep these items open until
their acceptance checks are implemented and measured; the existing result-handle
API alone does not complete UI paging.

- [ ] **Stable paging in the UI:** connect existing result handles/pages when
  bounded previews impede inspection; preserve stable results and release handles.
- [ ] **Validated budget controls:** expose memory, threads, storage, and timeout
  settings if P2.2 shows fixed defaults are restrictive; define safe ranges.
- [x] **Local per-dataset sampling:** use DuckDB's native
  `USING SAMPLE ... REPEATABLE` on each input subquery. A regression confirms
  the same seed returns the same rows; README explains join/aggregate semantics.
  Add a separate UI control only if users need it.
- [ ] **Dedicated worker/bounded queue:** change current serialization if evidence
  identifies responsiveness, concurrency, or cancellation problems.

## Deferred architectural options — not consolidation requirements

- **Arrow IPC source transport:** require an end-to-end benchmark improvement,
  including row-producing driver conversion costs, before replacing typed NDJSON.
- **Rust adapters:** require measured product/operational benefit and per-adapter
  behavioral/integration parity. Keep Node as relational source/metadata/MCP owner.

Recommended execution order: P1.1 → P1.2 → P1.3 → P1.4 → P2.1 → P2.2 → P2.3 →
P2.4. Update documentation alongside each item; P2.4 is the final consistency pass.

## Work in progress (2026-09-25)

- P1.1: an engine regression now checks exact decimal, integer beyond JavaScript's
  safe range, binary, temporal text, and null in one snapshot round-trip. This
  does not replace the real-source adapter matrix. Real adapter smoke tests now
  check exact decimal, large integer, and null for PostgreSQL, MySQL, and Oracle.
  MySQL uses per-query big-number strings and Oracle uses a per-query NUMBER
  fetch handler. SQL Server's Tedious decoder rounds large DECIMAL/NUMERIC;
  detected unsafe values now fail explicitly, with a source-query VARCHAR cast
  workaround. Temporal, binary, JSON, long strings, MariaDB, JDBC, ODBC, and
  end-to-end Rust imports remain to be checked.
- P1.2: snapshot, source, and file imports now commit the dataset table and
  registry entry together; rename/drop/clear are transactional. Federated file
  imports and renames remain temporary. Restart and workspace-isolation tests
  pass. Failure-injection coverage remains open.
- P1.3: direct Delta, Iceberg, glob, and additional file-reader functions are
  rejected by the analytical SQL guard. S3 editor SQL also rejects direct S3/HTTP
  URI literals, so ordinary queries must use registered sources. Every catalog
  URI now receives the shared S3 validation. Three real S3 tests passed against
  the reachable local endpoint (CSV, Parquet, Delta, Iceberg, join, import).
  A fourth real test blocks local-file access, checks invalid-credential error
  redaction, and confirms a later valid query succeeds. Offline extension
  failure and broader credential cases remain open.
- P1.4: file and S3 imports now retain their original path/URI in durable
  dataset metadata. Coverage propagation through joins/exports and source
  snapshot timing remain open.
- P2.3: S3 join staging now uses the actual workspace of each local dataset.
  The main DuckDB editor now offers full CSV export beside grid export, using
  the executed SQL and existing cancellation path. Other UI parity and S3
  full-export behavior remain open.
- P2.2: completed S3 import and local join staging files are checked against
  the dataset byte budget before they are read. This is a post-write check;
  peak disk use during COPY still requires measurement and an earlier limit.
  The existing debug benchmark imported 5,000,000 narrow rows in 53.66 s
  (43,888,890 encoded bytes) on an HP ProBook 440 G9, 12 logical CPUs,
  16 GB RAM, Rust 1.98.0, main `f52c766` plus working-tree changes,
  512 MB DuckDB limit and 2 threads. It did not measure peak memory/disk.
- P2.4: README and ARCHITECTURE now describe durable local datasets, temporary
  federated datasets, and S3 extension requirements. Final consistency review
  follows integration evidence.
- P2.1: local query cancellation regression now checks that a new query works in
  the same workspace. Source disconnect and remote recovery cases remain open.
- Docker CLI is unavailable, but the local test services were reachable.
  Adapter smoke tests passed 88/88 across PostgreSQL, MySQL, SQL Server, and
  Oracle. The JSON-RPC integration suite passed 78 tests with 4 CTE/sidecar
  checks skipped. H2/JDBC was not run because the JVM sidecar was unavailable.
- Rust engine unit suite: 24 passed, 1 ignored benchmark. Typecheck and lint
  phases of `pnpm verify` passed; the frontend Vitest phase stalled on this
  Windows host, so focused frontend tests were run separately.
