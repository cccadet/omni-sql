Node >=22; package manager locked to pnpm 11.17.0. TypeScript 5.7 uses strict checks, ES2022, Bundler resolution, `noUncheckedIndexedAccess`, `noImplicitOverride`, and explicit `.ts` workspace imports.

Desktop stack: React 19, Fluent UI React v9, Monaco, Vite, and Tauri Rust. Backend stack: Node/TypeScript HTTP JSON-RPC. Data stack: builtin `node:sqlite` metadata cache and OS keyring for connection passwords. Sidecar: Kotlin/Gradle with Apache Calcite.

The 12 `packages/*` workspaces are `ts-types`, `dialect-descriptors`, `adapters-core`, `adapters-pg`, `adapters-mysql`, `adapters-mssql`, `adapters-oracle`, `adapters-jdbc`, `autocomplete-engine`, `metadata-cache`, `backend`, and `mcp-server`. Adapter drivers include `pg`, `mysql2/promise`, `mssql`/Tedious, Oracle thin `oracledb`, and generic JDBC. MCP details: `mem:mcp-server/core`.
