# Testing and release gates

Read this before push/release validation or when changing coverage gates.
Day-to-day rules for choosing tests live in [CLAUDE.md](../CLAUDE.md).

## Where checks run

| Stage | Checks |
| --- | --- |
| Commit (optional hooks, `git config core.hooksPath .githooks`) | `pnpm precommit`: staged whitespace and TS/JS lint |
| Push of a branch (pre-push hook) | `pnpm typecheck`, `pnpm lint`, `pnpm test:fast` |
| Push to `main` (pre-push hook) | `pnpm verify:push` (uses the cached checkpoint) |
| Push of a `v*` tag (pre-push hook) | Only checks that `docs/releases/vX.Y.Z.md` exists in the tagged commit |
| PR CI | Typecheck, lint, full TypeScript coverage, frontend build, `cargo check` and the SonarCloud gate |
| CI on `main` | The PR checks plus real database integration, in parallel |
| Release workflow | Waits for CI on `main` for the exact tagged commit, then only builds |

`test:fast` runs Vitest with the `threads` pool: on Windows, `forks` workers
with jsdom often time out while starting.

Windows/macOS installer preflights do not run on `main` because the release
builds every platform. On PRs they run only when packaging inputs change (Tauri
shell, JVM sidecar, manifests, lockfile, backend bundler, packaging scripts or
the workflows); otherwise start them with workflow dispatch.

## Coverage preflight (`pnpm verify:push`)

Branch pushes do not need it; PR CI covers coverage. Run it locally to diagnose
coverage before a PR. It resolves the SonarCloud main-branch new-code baseline,
generates TypeScript LCOV, Rust LCOV and JVM JaCoCo XML, and checks combined
new-code line/condition coverage against Sonar's threshold.

- It is a coverage estimate, not a substitute for affected typecheck/lint, and
  only SonarCloud confirms the real gate. Overall TypeScript coverage (>=80%)
  says nothing about new-code coverage.
- A successful checkpoint is reused while tracked code, configuration and the
  Sonar baseline are unchanged; `--force` regenerates it. Missing reports, or
  changed production files absent from reports, fail.
- If Sonar's baseline API is unavailable, use `--base <commit>` only with an
  explicitly established reference; never silently substitute HEAD or the
  latest tag. `--reports-only` inspects existing reports for diagnosis and does
  not record a checkpoint.
- Native coverage needs Java 21, Python 3, Docker, `cargo-llvm-cov`
  (`cargo install cargo-llvm-cov --locked`) and `llvm-tools-preview`
  (`rustup component add llvm-tools-preview`). No Sonar token is stored locally.

Related commands: `pnpm test:coverage` (TypeScript only) and
`pnpm coverage:native` (JVM JaCoCo and Rust LCOV, including isolated S3 fixtures).

## Database integration

`pnpm test:integration` runs real database integration without regenerating
coverage. It is optional locally (CI runs it on `main`) and needs Java 21,
Node 22, pnpm, Rust and Docker; on Linux also the Tauri build packages and
`unixodbc-dev` from [BUILDING.md](BUILDING.md). Fixtures are described in
[docker/test-dbs](../docker/test-dbs/README.md).

It covers PostgreSQL, MySQL, MariaDB, SQL Server, Oracle and H2/JDBC through
adapters and HTTP JSON-RPC, MongoDB through HTTP and SQL translation, ODBC in an
isolated SQLite container, security regressions against real databases, and S3
in an isolated container on a random loopback port.

Evidence (TAP results, logs, commit/working-tree state, tool and fixture
versions) is written to `artifacts/release-integration`; a fresh run removes old
evidence and CI uploads it even on failure. The runner rejects empty, failing,
cancelled and TODO suites and unexpected skips. The RPC suite allows exactly six
unsupported JDBC cases, and the Rust Mongo SQL test must execute and pass.
