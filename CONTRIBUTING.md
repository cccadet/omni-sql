# Contributing

## Workflow

1. Install the prerequisites in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
2. Install dependencies with `pnpm install`.
3. Make the smallest change that matches existing package boundaries and
   conventions.
4. Run the validation commands below before sharing a change.

No branch naming or commit-message policy is imposed by this repository.

## Validation

```bash
pnpm verify
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

`pnpm verify` runs recursive TypeScript typechecks, lint, and tests. Package
specific commands and desktop workflows are documented in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Code conventions

- TypeScript is strict, targets ES2022, and uses ESM imports with `.ts`
  extensions for workspace packages.
- Keep React code functional and use React 19 APIs with Fluent UI React v9.
- Keep adapter behavior behind the shared adapter contracts.
- Keep backend communication on the typed HTTP JSON-RPC protocol.
- Prefer existing utilities and package patterns; avoid speculative
  abstractions.
- Preserve input validation, error handling, and accessibility basics.
- Rust changes must pass `cargo check`.

Do not commit generated build output, credentials, database data, or local
runtime resources.
