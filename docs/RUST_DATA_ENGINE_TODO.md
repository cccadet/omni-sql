# Local analysis: remaining work

Updated: 2026-09-23. This checklist distinguishes work needed to substantiate
the shipped analytical MVP from enhancements that were described in the original
[Rust data engine plan](RUST_DATA_ENGINE_PLAN.md). A missing test is listed as a
validation gap, not automatically as a product defect.

## Necessary before claiming every M0–M4 acceptance criterion is met

- [ ] **Cross-dialect fidelity:** run a documented type matrix through real
  PostgreSQL, Oracle, MySQL/MariaDB, SQL Server, and JDBC streaming sources.
  Assert exact decimal, large integer, timestamp/time zone, binary, JSON, null,
  and large-string behavior against the source. Fix any conversion that loses
  information or report an explicit unsupported-type error. Adapter streaming
  unit tests exist, but they do not establish this end-to-end matrix.
- [ ] **Failure and cancellation recovery:** exercise cancellation during source
  reads, backpressure, DuckDB append, local query, and export; then run another
  successful operation in the same workspace. Include source disconnects,
  malformed/oversized batches, crash cleanup, and transaction rollback. Verify
  that a failed full load never appears as a complete dataset.
- [ ] **Resource-envelope tests:** measure peak process memory, stream buffers,
  spill disk use, and throughput for wide rows and large cells as well as the
  existing five-million-row narrow benchmark. Force dataset/spill quota and
  low-free-disk failures and confirm bounded behavior and cleanup. Record the
  hardware, toolchain, query, and limits with each benchmark result.
- [ ] **Documented type and provenance contract:** specify the source-to-Rust
  encodings and the meaning of `complete`, `sampled`, and `truncated` for each
  import path. Surface inherited limitations from a bounded grid snapshot and
  source execution time where they affect interpretation of cross-source joins.

These are primarily validation and correctness gates. The current feature can be
used without waiting for a general rewrite of the backend.

## Product improvements; prioritize from usage feedback

- [ ] **Local input sampling per dataset:** let users sample already imported
  datasets independently before joins or aggregation, with a stable sample for
  each operation. This is distinct from the full/first-N/reservoir choice at
  ingestion. The ingestion choice already covers the common load-size need, so
  implement this only if users need to compare multiple local sample scenarios.
- [ ] **Budget controls:** expose validated settings for memory, threads,
  dataset/spill capacity, and timeouts if fixed defaults prove restrictive on
  supported machines. Keep safe defaults and reject out-of-range values.
- [ ] **Dedicated engine worker/queue:** the current engine serializes access
  through a mutex and supports one active operation. Add a bounded queue only
  when concurrency or cancellation measurements show a user-visible problem.
- [ ] **Stable paging in the UI:** the engine exposes result handles and pages;
  the current workspace uses bounded `analysis_query` previews. Connect paging
  to the UI if users need to inspect large local results interactively.

## Explicitly optional or deferred

- [ ] **Arrow IPC for database-to-Rust transport:** the shipped bounded NDJSON
  path works with row-producing drivers. Change it only after a representative
  benchmark shows a material memory or throughput improvement after conversion
  costs are included. Arrow file I/O and export already exist.
- [ ] **Rust database adapters (M5):** keep Node as the database/metadata/MCP
  owner unless measured product or operational benefit justifies migrating an
  individual adapter and its full behavior and integration suite passes in Rust.

The local editor's unnecessary identifier quotes are addressed separately in
the application: ordinary DuckDB identifiers are inserted without quotes, while
reserved words or names with spaces/special characters retain required quotes.
