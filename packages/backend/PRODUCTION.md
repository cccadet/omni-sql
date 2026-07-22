# Backend production artifact

Run `pnpm --filter backend build` and execute `dist/index.mjs` with Node.js.
The output is a self-contained ESM bundle for the backend and workspace
packages. `dist/external-layout.json` lists packages that the resource
packager must copy under `dist/node_modules/`:

- `@napi-rs/keyring` (native keyring binary)
- `oracledb` (Oracle native/thin-mode resources)
- `@polyglot-sql/sdk` (includes adjacent `polyglot_sql.wasm`)

The `pg`, `mysql2`, and `mssql` drivers and their pure-JavaScript dependencies
are bundled. Node.js, the JVM/Calcite sidecar, and database servers remain
external runtime resources.
