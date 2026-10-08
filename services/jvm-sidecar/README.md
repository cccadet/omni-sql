# JVM sidecar

Kotlin + JDK HTTP server + Apache Calcite. Tauri starts the JAR on loopback
port 41921 and shuts it down with the desktop. Java 21 or newer is required.

| Endpoint | Purpose |
| --- | --- |
| `/health` | Process health and request counts |
| `/scope/resolve` | CTE output column names for autocomplete |
| `/query/editability` | Query editability analysis |
| `/jdbc/*` | Connect, query/stream, cancel, close, schemas and introspection |

All endpoints require `Authorization: Bearer <token>`. Standalone startup requires
`OMNI_SQL_AUTH_TOKEN`; Tauri supplies its per-run token automatically. Never
commit tokens or include them in diagnostic artifacts.

## Build and run

See [Development](../../docs/DEVELOPMENT.md) for bootstrap and build commands,
and [Troubleshooting](../../docs/TROUBLESHOOTING.md) for ports and Gradle SSL.
The artifact is `build/libs/omni-sql-sidecar.jar`. Run it with `java -jar`;
when using the desktop, let Tauri manage the process. Avoid `gradlew run`, whose
Gradle daemon can retain the port after the launcher exits.

The shell selects Java through `OMNI_SQL_JAVA_HOME`, `JAVA_HOME`, known Windows
installations, then PATH. `OMNI_SIDE_CAR_PORT` overrides port 41921.

## Scope resolution limits

`CteTextScanner` isolates balanced CTE bodies, including quoted text and comments.
Calcite parses each complete body independently of the unfinished outer query.
Aliases and identifiers produce output column names; real catalog types,
`SELECT *` expansion and complete `CalciteSchemaAdapter` validation remain future
work. Backend scope calls time out after 250 ms; failure or invalid responses
fall back to lexer/metadata autocomplete. JDBC still requires a working sidecar.
