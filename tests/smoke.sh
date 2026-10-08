#!/bin/sh

set -eu

BASE_URL="${1:-http://localhost:8787}"
PROJECT_ID=""

cleanup() {
  if [ -n "$PROJECT_ID" ]; then
    curl -fsS -X DELETE "$BASE_URL/api/projects/$PROJECT_ID" >/dev/null || true
  fi
}
trap cleanup EXIT

curl -fsS "$BASE_URL/api/health" | jq -e '.status == "ok"' >/dev/null

PROJECT=$(curl -fsS -X POST "$BASE_URL/api/projects" \
  -H 'Content-Type: application/json' \
  --data "{\"name\":\"Automated demo\",\"targetUrl\":\"$BASE_URL/demo.html\"}")
PROJECT_ID=$(printf '%s' "$PROJECT" | jq -er '.project.id')

SCAN=$(curl -fsS -X POST "$BASE_URL/api/scans" \
  -H 'Content-Type: application/json' \
  --data "{\"projectId\":\"$PROJECT_ID\"}")
SCAN_ID=$(printf '%s' "$SCAN" | jq -er '.scan.id')

ATTEMPT=0
while [ "$ATTEMPT" -lt 45 ]; do
  REPORT=$(curl -fsS "$BASE_URL/api/scans/$SCAN_ID")
  STATUS=$(printf '%s' "$REPORT" | jq -r '.scan.status')
  [ "$STATUS" = 'completed' ] && break
  if [ "$STATUS" = 'failed' ]; then
    printf '%s\n' "$REPORT" >&2
    exit 1
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done

test "$STATUS" = 'completed'
printf '%s' "$REPORT" | jq -e '.scan.summary.total > 0' >/dev/null
printf '%s' "$REPORT" | jq -e '.scan.summary.byCategory.responsive > 0' >/dev/null
printf '%s' "$REPORT" | jq -e '.scan.summary.byCategory.accessibility > 0' >/dev/null
printf '%s' "$REPORT" | jq -e '.scan.summary.byCategory.runtime > 0' >/dev/null
printf '%s' "$REPORT" | jq -e '.scan.evidence | length == 3' >/dev/null

SCREENSHOT=$(printf '%s' "$REPORT" | jq -er '.scan.evidence[0].screenshot')
curl -fsS "$BASE_URL$SCREENSHOT" >/dev/null

curl -fsS "$BASE_URL/api/scans/$SCAN_ID/prompt" | grep -q 'Buttons must have discernible text'

INVALID_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/projects" \
  -H 'Content-Type: application/json' --data '{"name":"Invalid","targetUrl":"file:///etc/passwd"}')
test "$INVALID_STATUS" = '422'

printf 'RenderLint smoke test passed with %s verified findings.\n' "$(printf '%s' "$REPORT" | jq -r '.scan.summary.total')"
