# Contributing

1. Follow [Development](docs/DEVELOPMENT.md) to install and run the project.
2. Follow package boundaries and conventions in [AGENTS.md](AGENTS.md).
   Preserve validation, error handling and accessibility.
3. At completion, run typecheck, lint and tests for affected packages. Shared
   contracts require consumer checks; Rust/JVM changes require native checks.
   Driver, persistence and protocol changes need affected-path integration.
4. Follow [Testing](docs/TESTING.md) before pushing completed code or releasing.

Optional hooks (`git config core.hooksPath .githooks`) check staged whitespace
and TS/JS lint at commit. They do not replace completion checks.
Do not commit credentials, database data, local tool state or generated output.
