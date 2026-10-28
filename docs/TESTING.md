# Test and release gates

Read this before running push/release gates or changing coverage configuration.
Daily test-selection rules live in [CLAUDE.md](../CLAUDE.md).

## Coverage and release workflow

- PR CI runs coverage and the SonarCloud gate, so branch pushes do not need a
  local `pnpm verify:push`; use it to diagnose coverage before opening a PR, and
  the pre-push hook runs it for direct pushes to `main`. It resolves the
  current SonarCloud main-branch new-code baseline, generates TypeScript LCOV,
  Rust LCOV and JVM JaCoCo XML, and checks combined new-code line/condition
  coverage against Sonar's configured threshold. Do not substitute overall
  TypeScript coverage for new-code coverage.
- `verify:push` is a coverage preflight, not a substitute for the affected
  typecheck/lint checks required by CLAUDE.md. Keep full multi-database integration and desktop
  lifecycle validation at release or when the affected path requires them;
  do not add them to the per-edit or precommit loop.
- The checkpoint reuses a successful result while tracked/nonignored code and
  configuration plus the Sonar baseline remain unchanged. `--force` regenerates
  coverage. Missing reports or changed production files absent from reports fail.
  It is a local estimate; only SonarCloud confirms the exact metrics and full gate.
- Prerequisites for native coverage: Java 21, Python 3, Docker, cargo-llvm-cov
  (`cargo install cargo-llvm-cov --locked`) and llvm-tools-preview
  (`rustup component add llvm-tools-preview`). No Sonar token is stored locally.
- If Sonar's baseline API is unavailable, use `pnpm verify:push --base <commit>`
  only with an explicitly established reference. Never silently use HEAD or the
  latest tag. `--reports-only` inspects existing reports and does not record a
  successful checkpoint; it is for diagnosis, not final validation.
- The pre-push hook runs `pnpm typecheck`, `pnpm lint` and `pnpm test:fast` for
  branches other than `main`. `test:fast` runs the desktop libraries with
  Vitest's `threads` pool: on Windows, `forks` workers with jsdom often time out
  while starting, which failed pushes without any failing test. Pushes to `main` run `pnpm verify:push`, which uses
  the cached checkpoint. A `v*` release tag only checks that its release notes
  exist in the tagged commit; CI on `main` already ran the full gate.
- Release validation tests PostgreSQL/MySQL/MariaDB/SQL Server/Oracle and JDBC
  through adapters and HTTP JSON-RPC, MongoDB through HTTP/SQL translation,
  and ODBC in an isolated SQLite container. Security regressions run with the
  real database fixtures. S3 coverage runs in an isolated container using a
  random loopback port. CI uses the same JVM/Rust coverage generator.
- CI runs full TypeScript coverage once and reuses its reports for SonarCloud.
  On pushes to `main`, CI also runs real database integration in parallel
  (PRs skip it). Release publication requires that CI run to succeed for the
  exact tagged commit on the default branch, then only builds; it waits for that
  run, so the tag can be pushed right after the merge. Integration runs
  independently of optional local hooks and does not repeat native coverage.
- The SonarCloud job caches the instrumented Rust build (`llvm-cov-target`), so
  native coverage recompiles only workspace crates. CI also builds the desktop
  frontend with Vite.
- Windows/macOS installer preflights do not run on `main`, since the release
  builds every platform. On PRs they run only when packaging inputs change
  (Tauri shell, JVM sidecar, manifests, lockfile, backend bundler, packaging
  scripts or the workflow itself); otherwise run them with workflow dispatch.
  Evidence is saved under `artifacts/release-integration` and uploaded even on failure.


## Commands and evidence

- `pnpm test:coverage`: overall TypeScript line coverage >=80%; this alone does not predict the Sonar gate.
- `pnpm coverage:native`: JVM JaCoCo and Rust LCOV, including isolated S3 fixtures.
- `pnpm test:integration`: real database integration only, without regenerating coverage (CI runs it on `main`).

The integration runner saves TAP results, logs, commit/working-tree state and tool/fixture versions.
It rejects empty, failing, cancelled and TODO suites and unexpected skips.
The RPC suite allows exactly six unsupported JDBC cases; the Rust Mongo SQL gate
requires the named integration test to execute and pass.
A fresh run removes old evidence. The CI workflow uploads evidence even on failure.

See [BUILDING.md](BUILDING.md#release-flow) for host dependencies and release artifacts.
