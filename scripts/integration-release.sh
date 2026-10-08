#!/usr/bin/env bash
# Full database integration without regenerating coverage.
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_BUILD_JOBS=2
artifact_dir="${OMNI_SQL_INTEGRATION_ARTIFACT_DIR:-$PWD/artifacts/release-integration}"
mkdir -p "$artifact_dir"
artifact_dir=$(cd "$artifact_dir" && pwd)
rm -f -- "$artifact_dir"/{integration.log,database.log,sidecar.log,run.txt,smoke.tap,rpc.tap,mongo.tap,security.tap,mongo-sql.log,odbc.tap}
exec > >(tee "$artifact_dir/integration.log") 2>&1
compose=(docker compose -p "omni-sql-prerelease-$$" -f docker/test-dbs/docker-compose.yml)
finish() {
  local status=$?
  trap - EXIT
  set +e
  "${compose[@]}" logs --no-color > "$artifact_dir/database.log" 2>&1
  if [[ -n "${sidecar_pid:-}" ]]; then kill "$sidecar_pid"; wait "$sidecar_pid"; fi
  "${compose[@]}" down -v
  printf 'exit_status=%s\nfinished_utc=%s\n' "$status" "$(date -u +%FT%TZ)" >> "$artifact_dir/run.txt"
  exit "$status"
}
trap finish EXIT
{
  printf 'commit=%s\nstarted_utc=%s\ncommand=bash scripts/integration-release.sh\n' "$(git rev-parse HEAD)" "$(date -u +%FT%TZ)"
  printf 'working_tree_sha256=%s\n' "$(git diff HEAD --binary | sha256sum | cut -d ' ' -f 1)"
  git status --porcelain
  sha256sum scripts/integration-release.sh scripts/check-integration-tap.mjs
  printf 'platform=%s\n' "$(uname -a)"
  node --version
  pnpm --version
  java -version 2>&1
  cargo --version
} > "$artifact_dir/run.txt"
docker compose version
docker --version >> "$artifact_dir/run.txt"
./services/jvm-sidecar/gradlew -p services/jvm-sidecar jar
export OMNI_SQL_TEST_PG_PORT=0
"${compose[@]}" up -d --build --wait postgres mysql mariadb mssql oracle h2 mongo
for container in $("${compose[@]}" ps -q); do
  docker inspect --format '{{.Name}} image={{.Config.Image}} image_id={{.Image}}' "$container" >> "$artifact_dir/run.txt"
done
OMNI_SQL_TEST_PG_PORT=$("${compose[@]}" port postgres 5432 | sed 's/.*://')
export PG_TEST_CONNECTION_STRING="postgresql://omni:omni@127.0.0.1:${OMNI_SQL_TEST_PG_PORT}/omni_test"
export OMNI_SQL_RUN_INTEGRATION=1 OMNI_SQL_RUN_SECURITY_INTEGRATION=1
"${compose[@]}" run --rm mssql-init
"${compose[@]}" run --rm h2-init
export OMNI_SIDE_CAR_PORT="${OMNI_SIDE_CAR_PORT:-41922}"
export OMNI_SQL_SIDECAR_URL="http://127.0.0.1:${OMNI_SIDE_CAR_PORT}"
OMNI_SQL_AUTH_TOKEN=integration-auth-token java -jar services/jvm-sidecar/build/libs/omni-sql-sidecar.jar > "$artifact_dir/sidecar.log" 2>&1 &
sidecar_pid=$!
for attempt in {1..60}; do
  if curl --silent --fail --header 'Authorization: Bearer integration-auth-token' "$OMNI_SQL_SIDECAR_URL/health" > /dev/null; then break; fi
  sleep 1
done
curl --silent --fail --header 'Authorization: Bearer integration-auth-token' "$OMNI_SQL_SIDECAR_URL/health" > /dev/null
(
  cd docker/test-dbs
  node --test --test-reporter=tap ./smoke-test.ts | tee "$artifact_dir/smoke.tap"
  node ../../scripts/check-integration-tap.mjs "$artifact_dir/smoke.tap"
  node --test --test-reporter=tap ./integration-test.ts | tee "$artifact_dir/rpc.tap"
  # JDBC deliberately omits six unsupported metadata/DDL/plan scenarios.
  # Any additional skip (including CTE resolution unavailable) fails the gate.
  node ../../scripts/check-integration-tap.mjs "$artifact_dir/rpc.tap" 6
  node --test --test-reporter=tap ../../packages/backend/test/mongo.integration.test.ts | tee "$artifact_dir/mongo.tap"
  node ../../scripts/check-integration-tap.mjs "$artifact_dir/mongo.tap"
  node --test --test-reporter=tap ../../packages/backend/test/security-postgres.integration.test.ts ../../packages/backend/test/security-row-update.integration.test.ts | tee "$artifact_dir/security.tap"
  node ../../scripts/check-integration-tap.mjs "$artifact_dir/security.tap"
  sh ./test-mongo-sql.sh | tee "$artifact_dir/mongo-sql.log"
  node ../../scripts/check-integration-tap.mjs "$artifact_dir/mongo-sql.log" --mongo-sql
)
docker build -t omni-sql-odbc-test -f docker/odbc-test/Dockerfile .
docker run --rm omni-sql-odbc-test node --test --test-reporter=tap packages/adapters-odbc/src/integration.test.ts | tee "$artifact_dir/odbc.tap"
node scripts/check-integration-tap.mjs "$artifact_dir/odbc.tap"
