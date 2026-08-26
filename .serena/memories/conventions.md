# Conventions
- Functional React components/hooks; do not use experimental React 19 APIs. Use Fluent UI v9 in the desktop UI.
- Preserve strict TypeScript constraints and explicit `.ts` in cross-package imports. Contracts belong in `packages/backend/src/protocol.ts`; do not invent incompatible UI/backend payloads.
- Tests: backend and packages use Node's test runner; desktop uses Vitest/jsdom. ESLint 9 flat config.
- SQL completion is context-sensitive lexer + metadata; CTE relations originate from sidecar scope resolution and must retain tier-1 fallback behavior.
- Metadata SQL respects database dialects; PostgreSQL metadata uses information_schema/pg_catalog, query execution uses cursors and JSON EXPLAIN. SQL Server planning uses SHOWPLAN in a separate transaction.
- Do not assume production file keyring fallback: it needs `OMNI_SQL_DEV_KEYRING_FILE` or `OMNI_SQL_DEV_KEYRING=1`.