# services/jvm-sidecar — Spike Fase 0

Sidecar JVM (Kotlin) que validará:
1. **Cold-start**: tempo de boot do processo + HTTP server (`/health`).
2. **Lifecycle**: Tauri deve conseguir matar o processo no teardown da janela
   (já coberto pelo `on_window_event` em `apps/desktop/src-tauri/src/lib.rs`).
3. **Contrato HTTP**: `/health` é a base sobre a qual a Fase 3 adicionará
   `/scope/resolve` (Calcite/ANTLR).

Stack minúscula de propósito: Kotlin + `com.sun.net.httpserver` (JDK puro, zero
deps externas). Ktor/Coroutines entram só na decisão Calcite vs ANTLR (Fase 3).

## Rodar

### Bootstrap (uma vez) — gera o Gradle Wrapper
```bash
cd services/jvm-sidecar
./bootstrap.sh
```
O script baixa `gradle-wrapper.jar` (~60KB) se você não tem `gradle` instalado.

### Com gradle instalado localmente
```bash
./gradlew run
# ou, se tem gradle no PATH:
gradle run
```

### Validar cold-start
```bash
time ./gradlew run &
sleep 2
curl http://127.0.0.1:41921/health
```
Critério de saída do spike: `uptimeMs` no JSON < 1500ms e `pid` presente.

## Próxima fase (3)

Substituir `Main.kt` por módulos:
- `dev.omnisql.sidecar.scope.ScopeResolver` — `/scope/resolve`
- `dev.omnisql.sidecar.calcite.CalciteSchemaAdapter` — modelo unificado → `Schema` Calcite
- Spike de 5 dias: tolerant-parse de `SELECT t.<cursor> FROM ...` via `SqlParser.parseStatementFragment` + recovery custom.

## Notas de risco
- `OMNI_SIDE_CAR_PORT` default **41921** — distinta do Node backend (41920).
- Integration Tauri: o Rust shell ainda não spawna o sidecar; só em Fase 3
  conectaremos o motor de autocomplete (tier2) a ele via HTTP localhost.