#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_SHA:?}"
: "${RELEASE_BRANCH:?}"
# The tag must reference a commit whose normal CI (including Sonar) succeeded.
for attempt in {1..90}; do
  result=$(gh api --method GET "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs" \
    -f head_sha="$GITHUB_SHA" -f branch="$RELEASE_BRANCH" -f event=push \
    --jq '.workflow_runs[0] | if . == null then "missing" else [.status, (.conclusion // "pending"), .html_url] | join(" ") end')
  case "$result" in
    'completed success '*) echo "Release CI approved: $result"; exit 0 ;;
    'completed '*) echo "Release blocked: no successful CI for this exact commit ($result)." >&2; exit 1 ;;
  esac
  echo "Waiting for CI of $GITHUB_SHA: $result"
  sleep 20
done
echo 'Release blocked: CI did not finish within 30 minutes.' >&2
exit 1
