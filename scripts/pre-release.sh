#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm verify:push
artifact_dir="${OMNI_SQL_INTEGRATION_ARTIFACT_DIR:-$PWD/artifacts/release-integration}"
evidence_complete=1
for file in run.txt smoke.tap rpc.tap mongo.tap security.tap mongo-sql.log odbc.tap; do
  if [[ ! -s "$artifact_dir/$file" ]]; then evidence_complete=0; fi
done
if [[ "$evidence_complete" -eq 1 ]] && grep -q '^exit_status=0$' "$artifact_dir/run.txt" && cmp -s .cache/coverage-checkpoint.json .cache/release-checkpoint.json; then
  echo "Release integration checkpoint already passed for these files; not repeated."
  exit 0
fi
bash scripts/integration-release.sh

cp .cache/coverage-checkpoint.json .cache/release-checkpoint.json
