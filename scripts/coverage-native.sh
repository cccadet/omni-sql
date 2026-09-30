#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
cargo llvm-cov --version >/dev/null
./services/jvm-sidecar/gradlew -p services/jvm-sidecar test jacocoTestReport

# A random loopback port avoids collisions with development databases.
image=$(sed -n 's/^    image: //p' docker/test-dbs/docker-compose.s3-moto.yml)
s3_container=$(docker run --rm -d -p 127.0.0.1::9000 --entrypoint moto_server "$image" -H 0.0.0.0 -p 9000)
trap 'docker rm -f "$s3_container" >/dev/null' EXIT
port=$(docker port "$s3_container" 9000/tcp | sed 's/.*://')
export OMNI_SQL_TEST_S3_ENDPOINT="http://127.0.0.1:$port"
for attempt in {1..60}; do
  if curl --silent --fail "$OMNI_SQL_TEST_S3_ENDPOINT" >/dev/null; then break; fi
  sleep 1
done
curl --silent --fail "$OMNI_SQL_TEST_S3_ENDPOINT" >/dev/null
docker build -t omni-sql-s3-fixtures docker/test-dbs/s3-fixtures
docker run --rm --network "container:$s3_container" \
  -e AWS_ACCESS_KEY_ID=omni_test -e AWS_SECRET_ACCESS_KEY=omni_test_secret \
  -e AWS_DEFAULT_REGION=us-east-1 -e AWS_ENDPOINT_URL=http://127.0.0.1:9000 omni-sql-s3-fixtures
mkdir -p apps/desktop/src-tauri/coverage
OMNI_SQL_RUN_S3_INTEGRATION=1 cargo llvm-cov --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --lcov --output-path apps/desktop/src-tauri/coverage/lcov.info
