# JVM sidecar
- `services/jvm-sidecar`: Kotlin/JDK 21 Gradle sidecar, main `dev.omnisql.sidecar.MainKt`; emits a fat jar consumed via `java -jar`.
- Apache Calcite resolves CTE scope at `/scope/resolve`. It isolates each CTE body with balanced `CteTextScanner` before parsing, avoiding tolerant parsing of incomplete outer SQL.
- Current scope is syntactic: real schema/catalog adapter, SELECT-star expansion, complete validation, and correlated-subquery scope remain outside scope.
- JVM HTTP layer uses JDK HttpServer; Calcite log binding is slf4j-nop. Tests run through Gradle.
- System interactions: backend behavior and fallback are documented in `mem:backend/core`; project map in `mem:core`.