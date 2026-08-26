# Stack
- Node >=22; pnpm locked to 11.17.0; ESM TypeScript 5.7. TS base config is strict, ES2022/ESNext + Bundler resolution, `noUncheckedIndexedAccess`, `noImplicitOverride`; workspace imports use explicit `.ts`.
- Desktop: Tauri 2 (Rust) + Vite, React 19, Fluent UI React v9, Monaco. Backend: Node/TypeScript HTTP JSON-RPC.
- Packages: unified types, dialect descriptors, adapter core and PG/MySQL/MSSQL/Oracle/JDBC drivers, autocomplete engine, SQLite metadata cache, backend, MCP server.
- Metadata cache uses built-in `node:sqlite`; passwords use `@napi-rs/keyring` (development file fallback is explicitly opt-in).
- JVM sidecar: Kotlin 2.1, JDK 21, Gradle, Apache Calcite 1.37; scope parsing is syntactic, not schema-backed yet.
- DB drivers: pg; mysql2/promise; mssql/Tedious; oracledb thin; generic JDBC. MCP uses `@modelcontextprotocol/sdk`.