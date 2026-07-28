# Troubleshooting

## Build prerequisites

Confirm Node `>=22`, pnpm `11.17.0`, Rust stable, Tauri 2, and JDK 21. On
Ubuntu install the exact Tauri packages from
[`DEVELOPMENT.md`](DEVELOPMENT.md). On Windows install Visual Studio Build
Tools and WebView2. Re-run `pnpm install --frozen-lockfile` after changing
checkout state.

## Gradle `PKIX path building failed`

This usually means corporate SSL inspection CA is trusted by Windows but not
the JDK. Do not disable certificate validation. Point Gradle's Java process at
the Windows root trust store:

```bash
JAVA_OPTS=-Djavax.net.ssl.trustStoreType=Windows-ROOT ./gradlew jar
```

In PowerShell:

```powershell
$env:JAVA_OPTS='-Djavax.net.ssl.trustStoreType=Windows-ROOT'
.\gradlew.bat jar
```

This workaround is for Windows trust configuration; use your organization's
approved JDK trust-store procedure on other platforms.

## Sidecar missing or unavailable

The desktop app can start without
`services/jvm-sidecar/build/libs/omni-sql-sidecar.jar`. Autocomplete then uses
tier 1 and omits CTE column resolution. For tier 2, run the wrapper `jar`
task, then restart Tauri. Check that `127.0.0.1:41921` is free. Use
`curl http://127.0.0.1:41921/health` for a manual health check.

Do not start the sidecar with `gradlew run` while using Tauri. Build the JAR and
let Tauri run `java -jar`; this avoids an orphan Gradle daemon holding the
port.

## Ports and backend

The backend uses `127.0.0.1:41920`; the JVM sidecar uses `127.0.0.1:41921`.
Tauri refuses to reuse an occupied port. Stop an old omni-sql process rather
than attaching to an unknown service. Check backend health at
`http://127.0.0.1:41920/health` with the per-run authorization token available
to the desktop shell.

## Connections and drivers

- Verify host, port, database, username, password, and TLS settings with the
  database vendor's client first.
- Native adapters require their database server to be reachable and use their
  documented driver behavior; inspect backend logs for the original driver
  error.
- JDBC requires a readable driver JAR, exact driver class name, compatible
  JDBC URL, and a running sidecar. `driver-missing`, credentials, network, and
  SQL-state errors identify common failure classes.
- Generic JDBC does not provide `EXPLAIN`, definitions, or complete portable
  metadata. Use the native adapter when one exists.

## Release package contents

Release builds need prepared, validated resources and the sidecar JAR. The
bundle includes backend, native Node runtime, normalized JRE, and sidecar under
the Tauri resources directory. If a release build reports missing resources,
run `pnpm prepare:resources` and `pnpm validate:resources` on the target host;
source builds do not cross-build another host's native runtime.
