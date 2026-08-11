## Current SQL formatter decision

Use `sql-formatter` (`apps/desktop/package.json`, currently `^15.8.2`) in React desktop frontend. No custom formatter.

Integration lives in React paths:
- `apps/desktop/src/lib/format-sql.ts` maps project dialect IDs to formatter languages, applies settings, and formats SQL.
- `apps/desktop/src/lib/monaco-config.ts` registers Monaco document formatting provider.
- `apps/desktop/src/components/FormatSettings.tsx` provides settings/preview; `apps/desktop/src/App.tsx` loads and saves settings.

Default shortcut is `Ctrl+Alt+L`; settings persist under `omni-sql:formatterSettings` in `localStorage`. Supported mappings include PostgreSQL, MySQL/MariaDB, SQL Server (`transactsql`), Oracle (`plsql`), and generic SQL.
