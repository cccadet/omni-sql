# services/jvm-sidecar

Sidecar JVM (Kotlin) com dois endpoints HTTP:
1. **`/health`**: heart-beat (pid, uptime, contagem de requests). Base do
   spike de Fase 0 — validou cold-start < 1.5s e que o Tauri mata o processo
   no teardown da janela (`on_window_event` em `apps/desktop/src-tauri/src/lib.rs`).
2. **`/scope/resolve`** (Fase 3): resolve colunas de CTEs (`WITH nome AS
   (...)`) via Apache Calcite — ver `dev.omnisql.sidecar.scope.ScopeResolver`.
   Parsing puramente sintático (sem schema/catálogo): extrai só os NOMES das
   colunas de saída de cada CTE, não seus tipos. Alimenta o tier2 do
   autocomplete (`packages/backend/src/sidecar-client.ts` →
   `packages/autocomplete-engine`'s `MetadataSource.resolveRelation`).

Stack minúscula de propósito: Kotlin + `com.sun.net.httpserver` (JDK puro) +
Calcite para parsing SQL. Ktor/Coroutines continuam de fora — o server
síncrono do JDK é suficiente para o volume de requests do autocomplete.

## Rodar

### Bootstrap (uma vez) — gera o Gradle Wrapper
```bash
cd services/jvm-sidecar
./bootstrap.sh
```
O script baixa `gradle-wrapper.jar` (~60KB) se você não tem `gradle` instalado.

### Build do jar (obrigatório antes de abrir o app)
O Tauri **não** usa `gradlew run` — ele roda `java -jar build/libs/omni-sql-sidecar.jar`
direto (ver `apps/desktop/src-tauri/src/lib.rs`). Motivo: `gradlew run` sobe um
Gradle Daemon que sobrevive à morte do processo que o lançou, então matar a
janela do Tauri não mata o Daemon — o processo real que segurava a porta 41921
fica órfão e a próxima subida quebra com `BindException: Address already in
use`. Gere/atualize o jar (sem sufixo de versão, nome fixo) sempre que mexer
em `Main.kt`:
```bash
./gradlew jar
```

### Teste manual interativo (opcional)
```bash
./gradlew run
# ou, se tem gradle no PATH:
gradle run
```
Útil pra iterar rápido no `Main.kt` sem rebuildar o jar a cada mudança, mas
**não** é o caminho que o app usa — lembre de `Ctrl+C`/matar o processo (ou o
Daemon) manualmente ao terminar, senão a porta fica presa pro próximo `java -jar`.

### Validar cold-start
```bash
time java -jar build/libs/omni-sql-sidecar.jar &
sleep 1
curl http://127.0.0.1:41921/health
```
Critério de saída do spike: `uptimeMs` no JSON < 1500ms e `pid` presente.

### Troubleshooting: SSL ao baixar a distribuição do Gradle
Se `./bootstrap.sh`/`./gradlew jar` falhar com
`PKIX path building failed: unable to find valid certification path`, a rede
está atrás de um proxy com SSL inspection (ex.: Fortinet) cuja CA não está no
`cacerts` do JDK — mas já está no trust store do Windows (por isso `curl`/`npm`
funcionam normal). Não desative validação de certificado; aponte o Java pro
trust store do Windows, que já confia nessa CA:
```bash
JAVA_OPTS=-Djavax.net.ssl.trustStoreType=Windows-ROOT ./gradlew jar
```
(`gradlew`/`gradlew.bat` já repassam `JAVA_OPTS`.)

## `/scope/resolve` — como funciona

`dev.omnisql.sidecar.scope.ScopeResolver` **não** tenta um parse tolerante do
statement inteiro (o "spike tolerant-vs-fragment" cogitado originalmente para
a Fase 3, via `SqlParser.parseStatementFragment` + recovery custom). Isso foi
deliberadamente evitado: quando o autocomplete dispara, a query externa
(depois do `WITH`) costuma estar incompleta/inválida — é o que o usuário está
digitando —, mas o corpo de cada CTE (`AS ( ... )`) já está completo. Então:

1. `CteTextScanner` isola cada bloco `nome [(cols)] AS ( corpo )` via
   varredura textual balanceada (parênteses/strings/identificadores
   quotados/comentários) — sem qualquer parser SQL.
2. Cada `corpo` (uma query completa e válida por si só) é parseado
   isoladamente pelo `SqlParser` do Calcite.
3. Os nomes das colunas de saída vêm de `SqlValidatorUtil.getAlias` por item
   da select-list (`AS alias`, identificador, ou `EXPR$n`). `SELECT *` é
   detectado e descartado (expandir `*` exigiria schema real — fora de
   escopo; ver abaixo).

Sem `CalciteSchemaAdapter`/catálogo real: só nomes de coluna, não tipos, e não
expande `*`. Um adapter completo (schema real introspectado, validação,
tipos) fica como trabalho futuro caso o produto precise de mais do que nomes
de coluna para CTEs.

## Notas de risco
- `OMNI_SIDE_CAR_PORT` default **41921** — distinta do Node backend (41920).
- Integração Tauri: o Rust shell já spawna o sidecar em background no boot
  (`apps/desktop/src-tauri/src/lib.rs`, não bloqueia a janela) e mata no
  fechamento — mas via `java -jar`, exige o jar buildado (`./gradlew jar`).
  Se o jar não existir, o app segue normal em tier1 (autocomplete só TS).
- `packages/backend/src/sidecar-client.ts` chama `/scope/resolve` com
  timeout de 250ms antes de rodar o tier1; qualquer falha (sidecar fora do
  ar, timeout, resposta malformada) faz `completion.get` seguir 100% tier1,
  sem CTEs — nunca quebra o autocomplete.