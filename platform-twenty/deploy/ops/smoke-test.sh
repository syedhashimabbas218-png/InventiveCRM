#!/usr/bin/env bash
# Usage: ops/smoke-test.sh
# Checks the server answers and, with SMOKE_KEYS_DIR set, that each canary workspace's API key can read its records.
. "$(dirname "$0")/lib.sh"

curl -fsS --max-time 10 "$SERVER_HEALTH_URL" >/dev/null || die "smoke: health check failed"
base=${SERVER_HEALTH_URL%/healthz}
curl -fsS --max-time 20 "$base/" | grep -q '<div id="root"' || die "smoke: the web app did not load"

for key_file in "${SMOKE_KEYS_DIR:-/nonexistent}"/*.key; do
  [ -f "$key_file" ] || continue
  answer=$(curl -sS --max-time 20 "$base/graphql" -H 'Content-Type: application/json' -H @<(printf 'Authorization: Bearer %s\n' "$(tr -d '\n' <"$key_file")") \
    -d '{"query":"{ companies(first: 1) { totalCount } }"}')
  jq -e '.data.companies.totalCount >= 0' <<<"$answer" >/dev/null || die "smoke: $(basename "$key_file") could not read its workspace: $answer"
done
log "smoke: ok"
