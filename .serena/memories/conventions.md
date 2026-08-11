Use functional React components with hooks and Fluent UI React v9. Keep TypeScript strict. Preserve backend RPC type safety through `packages/backend/src/protocol.ts`; cross-package imports use `workspace:*` and explicit `.ts` extensions.

Autocomplete tier1 consumes dialect descriptors and metadata. CTE completion may call JVM `/scope/resolve`; sidecar unavailable, timeout, invalid JSON, or invalid SQL response must return to tier1 without breaking completion. Scope resolver isolates balanced CTE bodies and parses them with Calcite; real schema/catalog, `SELECT *` expansion, and correlated subquery scope remain outside current scope.

Validate untrusted query limits and MCP payloads before adapters/UI bridge. `query.run` defaults to 1,000 rows and caps at 10,000; `query.cancel` delegates to adapter cancellation where supported. MCP HTTP stays loopback, authenticated, session-bounded, and payload-bounded.

Frontend tabs/history/theme persist in `localStorage`; connection records persist in SQLite and passwords come from OS keyring. Frontend/backend communication stays localhost JSON-RPC. Related maps: `mem:frontend/core`, `mem:backend/core`, `mem:mcp-server/core`.
