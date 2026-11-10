# Troubleshooting

## Using the app

### Connections fail

- Check host, port, database, user, password and TLS settings with the
  database vendor's own client first.
- Read the error in the UI and the logs (on Windows,
  `%LOCALAPPDATA%\dev.omnisql\logs`). Diagnostics deliberately omit sensitive
  driver details.
- Generic JDBC needs a readable driver JAR, the exact driver class name, a
  compatible JDBC URL and a running sidecar. `driver-missing`, credential,
  network and SQL-state errors identify the usual causes.
- ODBC needs a 64-bit driver for the target database; the driver manager alone
  is not enough.

### Linux: the editor stays on "Loading..."

The backend could not start. On v0.21.0 this happened when `libodbc.so.2` was
missing; install `libodbc2` (`sudo apt install libodbc2`) or upgrade. Current
packages depend on it, and a missing ODBC library only affects ODBC connections.

### Analytical import rejected a value

The driver cannot preserve the value's precision. Cast the column to text in the
source SQL; see [type fidelity](LOCAL-ANALYSIS.md#type-fidelity).

### MCP client cannot connect

Copy a fresh configuration from the **MCP** status bar item after each start:
runtime paths change every run. See [MCP.md](MCP.md#verifying-the-setup).

## Development

### Build prerequisites

Confirm Node `>=22`, pnpm `11.17.0`, Rust stable, Tauri CLI 2 and JDK 21, plus
the platform packages in [BUILDING.md](BUILDING.md#host-dependencies). Re-run
`pnpm install --frozen-lockfile` after switching branches.

### Gradle `PKIX path building failed`

A corporate SSL inspection CA is usually trusted by Windows but not the JDK. Do
not disable certificate validation; point Gradle at the Windows trust store:

```powershell
$env:JAVA_OPTS='-Djavax.net.ssl.trustStoreType=Windows-ROOT'
.\gradlew.bat jar
```

On other platforms, follow your organization's JDK trust-store procedure.

### Sidecar missing or unavailable

Without `services/jvm-sidecar/build/libs/omni-sql-sidecar.jar` the app still
starts, but CTE column completion and JDBC are unavailable. Build it with the
wrapper's `jar` task and restart Tauri. Do not start it with `gradlew run`
while using Tauri; the Gradle daemon can hold the port.

Health checks need the per-run token: `GET http://127.0.0.1:41921/health` with
`Authorization: Bearer <token>`. Standalone startup requires
`OMNI_SQL_AUTH_TOKEN`; Tauri supplies it automatically. Keep tokens out of logs.

### Ports

The backend uses `127.0.0.1:41920`, the sidecar `41921` and optional MCP HTTP
`41922`. Tauri refuses to reuse an occupied port: stop the old omni-sql process
instead of attaching to an unknown service.

### Missing release resources

If a release build reports missing resources, run `pnpm prepare:resources` and
`pnpm validate:resources` on the target host; another host's native runtime
cannot be reused.
