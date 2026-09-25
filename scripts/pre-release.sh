#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose version > /dev/null
./services/jvm-sidecar/gradlew -p services/jvm-sidecar test jar

compose=(docker compose -p "omni-sql-prerelease-$$" -f docker/test-dbs/docker-compose.yml -f docker/test-dbs/docker-compose.s3-moto.yml)
cleanup() {
  if [[ -n "${sidecar_pid:-}" ]]; then kill "$sidecar_pid" || true; fi
  "${compose[@]}" down -v || true
}
trap cleanup EXIT

"${compose[@]}" up -d --build --wait postgres mysql mssql oracle h2 minio
"${compose[@]}" run --rm mssql-init
"${compose[@]}" run --rm h2-init
"${compose[@]}" run --build --rm minio-fixtures
OMNI_SQL_RUN_S3_INTEGRATION=1 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

OMNI_SQL_AUTH_TOKEN=integration-auth-token java -jar services/jvm-sidecar/build/libs/omni-sql-sidecar.jar > sidecar-integration.log 2>&1 &
sidecar_pid=$!
for attempt in {1..60}; do
  if curl --silent --fail --header 'Authorization: Bearer integration-auth-token' http://127.0.0.1:41921/health > /dev/null; then break; fi
  sleep 1
done
curl --silent --fail --header 'Authorization: Bearer integration-auth-token' http://127.0.0.1:41921/health > /dev/null
(
  cd docker/test-dbs
  OMNI_SQL_RUN_INTEGRATION=1 node --test ./smoke-test.ts
  OMNI_SQL_RUN_INTEGRATION=1 node --test ./integration-test.ts
)
