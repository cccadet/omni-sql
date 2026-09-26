# Rust data engine: prioritized remaining work

Updated: 2026-09-25. Reviewed against main at `71630a8` plus this working tree.
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

- [x] **P1.2 — Durable dataset lifecycle.** Reconcile persistent storage with old
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

- [x] **P1.4 — Type/provenance contract across entry points.** Document NDJSON
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

- [x] **P2.3 — Main-editor/workspace consistency.** Check imports, full/sample
  choices, progress/cancel, dataset management, identifier completion, and full
  export across reachable flows. Engine support does not imply UI parity.
  **Done when:** import preserves SQL where intended, selection semantics are
  consistent, grid export and full analytical export are distinguishable, and
  S3 full-export support is explicitly decided/documented. Remove duplicate UI
  only after its useful behavior is covered by the replacement.

- [x] **P2.4 — Product and architecture documentation.** Refresh README,
  ARCHITECTURE, and relevant troubleshooting/build guidance for persistent DuckDB,
  S3 readers, formats, extension requirements, and validated limitations.
  **Done when:** diagrams and instructions match tested entry points and historical
  measurements remain clearly separated from current evidence.

## P3 — Implement when demand or measurements justify it

The user requested work through P3 on 2026-09-25. Keep these items open until
their acceptance checks are implemented and measured; the existing result-handle
API alone does not complete UI paging.

- [x] **Stable paging in the UI:** Analyze Locally materializes a stable result
  on demand, reads 1,000-row pages, and releases the handle on query change or exit.
- [x] **Validated budget controls — decision:** keep fixed limits for now. The
  measured wide-row run completed within the 512 MB DuckDB memory limit; no
  supported-machine requirement yet justifies user-facing controls. Reopen if
  P2.2 measurements or real workloads show a restrictive limit.
- [x] **Local per-dataset sampling:** use DuckDB's native
  `USING SAMPLE ... REPEATABLE` on each input subquery. A regression confirms
  the same seed returns the same rows; README explains join/aggregate semantics.
  Add a separate UI control only if users need it.
- [x] **Dedicated worker/bounded queue — decision:** retain current serialization.
  Cancellation and retry tests pass; no measured responsiveness or concurrency
  problem justifies a second worker architecture. Reopen on evidence.

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
  MySQL uses per-query big-number and date strings, PostgreSQL uses a per-query
  temporal text parser, and Oracle uses a per-query NUMBER fetch handler.
  SQL Server's Tedious decoder rounds large DECIMAL/NUMERIC;
  detected unsafe values now fail explicitly, with a source-query VARCHAR cast
  workaround. SQL Server and Oracle timestamp values that would lose
  sub-millisecond precision are also rejected with explicit cast guidance.
  Real adapter tests cover temporal, binary, JSON, null, and long strings on
  PostgreSQL, MySQL, SQL Server, and Oracle. H2/JDBC integration now verifies
  exact decimal, large integer, and microsecond timestamp through the real
  backend stream. ODBC refuses driver-decoded decimal and date/time values of
  uncertain precision; the available legacy SQL Server ODBC driver connects
  but fails even to fetch `SELECT 1`. MariaDB, a working ODBC driver, and
  end-to-end real-source Rust imports remain to be checked.
  Analytical previews now convert nested STRUCT/LIST/ARRAY/MAP values to JSON,
  retaining decimal digits as text; local and S3 regression queries cover STRUCT.
  A typed NDJSON-to-DuckDB regression covers decimal, large integer, temporal
  text, binary, JSON, and null, but still uses a synthetic source stream.
- P1.2: snapshot, source, and file imports now commit the dataset table and
  registry entry together; rename/drop/clear are transactional. Federated file
  imports and renames remain temporary. Restart and workspace-isolation tests
  pass. Malformed and disconnected imports publish no partial dataset.
- P1.3: direct Delta, Iceberg, glob, and additional file-reader functions are
  rejected by the analytical SQL guard. S3 editor SQL also rejects direct S3/HTTP
  URI literals, so ordinary queries must use registered sources. Every catalog
  URI now receives the shared S3 validation. Three real S3 tests passed against
  the reachable local endpoint (CSV, Parquet, Delta, Iceberg, join, import).
  A fourth real test blocks local-file access, checks invalid-credential error
  redaction, and confirms a later valid query succeeds. Offline extension
  failure and broader credential cases remain open.
- P1.4: file and S3 imports now retain their original path/URI in durable
  dataset metadata. Streamed-source imports record their individual start and
  finish times; older registry entries load without these optional fields.
  The analytical provenance guide now documents entry-point coverage, NDJSON
  encodings, and independent source snapshots. Analyze Locally warns when any
  workspace dataset is sampled/truncated before joins or full exports. Coverage
  accompanies local full exports in a `.omni.json` companion file.
- P2.3: S3 join staging now uses the actual workspace of each local dataset.
  The main DuckDB editor now offers full CSV export beside grid export, using
  the executed SQL and existing cancellation path. An empty schema is now kept
  in the sidebar so the first table can be created; its focused test passes.
  Analyze Locally now offers stable paging on demand, with handle cleanup.
  Adding a file or database source to an existing workspace keeps the SQL under
  edit; the new dataset appears in the list for explicit selection.
  S3 direct queries remain bounded previews; the documented full-export path
  imports the source locally before exporting it.
- P2.2: completed S3 import and local join staging files are checked against
  the dataset byte budget before they are read. This is a post-write check;
  peak disk use during COPY still requires measurement and an earlier limit.
  The existing debug benchmark imported 5,000,000 narrow rows in 53.66 s
  (43,888,890 encoded bytes) on an HP ProBook 440 G9, 12 logical CPUs,
  16 GB RAM, Rust 1.98.0, main `f52c766` plus working-tree changes,
  512 MB DuckDB limit and 2 threads. It did not measure peak memory/disk.
- P2.4: README and ARCHITECTURE now describe durable local datasets, temporary
  federated datasets, ODBC/JDBC limitations, S3 extension requirements, and
  analytical provenance. Historical measurements are labeled separately.
- P2.1: local query cancellation regression now checks that a new query works in
  the same workspace. Malformed and oversized source frames, and source
  disconnects after a valid batch, have rollback/retry coverage. Failed export
  publication restores the prior data and provenance pair. Startup removes
  abandoned spill directories older than seven days; live S3 bad-credential
  recovery passes. Forced crash and remote-scan cancellation remain untested.
- P2.2: NDJSON frames are now limited while reading, before a long line can be
  fully allocated. A 20,000-row × 8 KiB persistent import took 25.42 s and
  wrote 165,687,296 DuckDB bytes for 164,028,890 encoded source bytes on the
  same 16 GB Windows host, with the 512 MB memory limit and two DuckDB threads.
  A separate run of that benchmark sampled the Rust test process every 200 ms:
  peak working set was 346,632,192 bytes and peak private memory 328,818,688
  bytes; it completed in 23.58 s. This is process sampling, not a combined
  Node/Rust peak. Node memory, temporary disk, low-disk behavior, and S3/local
  join overhead remain unmeasured.
- In the initial validation, Docker CLI was outside PATH, but local test services were reachable.
  Adapter smoke tests passed 96/96 across PostgreSQL, MySQL, SQL Server, and
  Oracle when the SQL Server suite was rerun alone after one introspection
  timeout under concurrent benchmark load. The JSON-RPC integration suite
  passed 78 tests with 4 CTE/sidecar checks skipped. H2/JDBC ran with the
  rebuilt local JVM sidecar: 16 passed, 5 unsupported-feature checks skipped.
- Rust engine unit suite: 31 passed before the final provenance restart test,
  which passed separately; 2 benchmarks remain ignored by default. A real local S3
  integration test passed with a nested STRUCT result. Typecheck and lint
  passed. Full TypeScript coverage found two sidebar failures (one stale test
  setup and one real empty-schema bug); both were corrected. The subsequent
  coverage suite passed at 86.1% total TypeScript line coverage. `pnpm verify`
  completed typecheck/lint and package tests but its frontend Vitest phase
  stalled on this Windows host; full coverage and focused frontend suites ran
  successfully as separate commands.

### Release 0.5.0 validation (2026-09-26)

- Full `scripts/pre-release.sh` passed with isolated Docker services: JVM tests,
  57 Rust tests (including S3; 2 benchmarks ignored), 96 adapter smoke tests,
  and 118 JSON-RPC integration tests (5 unsupported JDBC feature checks skipped).
- Full TypeScript coverage passed at 86.1%, including all 206 frontend tests.
- Fixed the cancellation startup race exposed by the full Rust run; the regression
  test now holds the connection until cancellation arrives, then verifies recovery.
- Docker CLI was found outside PATH. The pre-release uses a separate JVM port,
  allows MySQL initialization time, and prints container logs on failure.
- Real MariaDB/modern ODBC, forced crash, low-disk and the broader resource/security
  validations listed above remain open; these checks do not close those items.
