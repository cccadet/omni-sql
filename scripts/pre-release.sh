#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm verify:push
if cmp -s .cache/coverage-checkpoint.json .cache/release-checkpoint.json; then
  echo "Release integration checkpoint already passed for these files; not repeated."
  exit 0
fi
docker compose version > /dev/null
./services/jvm-sidecar/gradlew -p services/jvm-sidecar jar

compose=(docker compose -p "omni-sql-prerelease-$$" -f docker/test-dbs/docker-compose.yml)
cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then "${compose[@]}" logs --tail 80 || true; fi
  if [[ -n "${sidecar_pid:-}" ]]; then kill "$sidecar_pid" || true; fi
  "${compose[@]}" down -v || true
  return "$status"
}
trap cleanup EXIT

"${compose[@]}" up -d --build --wait postgres mysql mssql oracle h2
"${compose[@]}" run --rm mssql-init
"${compose[@]}" run --rm h2-init

export OMNI_SIDE_CAR_PORT="${OMNI_SIDE_CAR_PORT:-41922}"
export OMNI_SQL_SIDECAR_URL="http://127.0.0.1:${OMNI_SIDE_CAR_PORT}"
OMNI_SQL_AUTH_TOKEN=integration-auth-token java -jar services/jvm-sidecar/build/libs/omni-sql-sidecar.jar > sidecar-integration.log 2>&1 &
sidecar_pid=$!
for attempt in {1..60}; do
  if curl --silent --fail --header 'Authorization: Bearer integration-auth-token' "$OMNI_SQL_SIDECAR_URL/health" > /dev/null; then break; fi
  sleep 1
done
curl --silent --fail --header 'Authorization: Bearer integration-auth-token' "$OMNI_SQL_SIDECAR_URL/health" > /dev/null
(
  cd docker/test-dbs
  OMNI_SQL_RUN_INTEGRATION=1 node --test ./smoke-test.ts
  OMNI_SQL_RUN_INTEGRATION=1 node --test ./integration-test.ts
)

cp .cache/coverage-checkpoint.json .cache/release-checkpoint.json
