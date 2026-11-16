#!/usr/bin/env bash
# End-to-end suites of every app against the throwaway test server, with the test doubles they need.
# Never point it at production: the Scheduling suite deletes every appointment in the workspace it is given.
# Usage: SERVER_URL=http://localhost:3001 [ROAD_ROUTING=off] tests/run-all.sh <keys dir> [suite ...]
# Suites: scheduling feedback campaigns team-chat documents. Feedback reuses Scheduling's appointments, so it runs after.
# The keys dir holds acme.key, glow.key, state.json (scheduling/setup.mjs) and campaigns-test-vars.env.
set -uo pipefail

: "${SERVER_URL:?Set SERVER_URL to the throwaway test server. Never run this against production.}"
keys=${1:?Usage: SERVER_URL=... tests/run-all.sh <keys dir> [suite ...]}
shift
keys=$(cd "$keys" && pwd)
cd "$(dirname "$0")"
suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(scheduling feedback campaigns team-chat documents)
workspace=${SERVER_URL/\/\/localhost/\/\/acme.localhost}
logs=$(mktemp -d)
started=()
trap '[ ${#started[@]} -eq 0 ] || kill "${started[@]}" 2>/dev/null' EXIT

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# A double that is already running is left alone, so a debugging session can keep its own.
double() {
  local port=$1
  shift
  listening "$port" && return 0
  "$@" >"$logs/double-$port.log" 2>&1 &
  started+=($!)
  for _ in $(seq 50); do listening "$port" && return 0; sleep 0.2; done
  echo "The test double on port $port did not start; see $logs/double-$port.log" >&2
  return 1
}

failed=()
step() {
  local name=$1
  shift
  echo "== $name"
  if "$@" >"$logs/$name.log" 2>&1; then :; else failed+=("$name"); fi
  grep -E '^(FAIL|SKIP|SUMMARY)|passed, [0-9]+ failed$' "$logs/$name.log" || tail -5 "$logs/$name.log"
}

for suite in "${suites[@]}"; do
  case $suite in
    scheduling)
      double 8095 node scheduling/mock-calendar-providers.mjs || exit 1
      step scheduling node scheduling/e2e.mjs "$keys/state.json" "$keys/acme.key" "$keys/glow.key"
      step scheduling-security node scheduling/security.mjs "$keys/state.json" "$keys/acme.key"
      step scheduling-restricted-role node scheduling/restricted-role.mjs "$keys/state.json" "$keys/acme.key"
      ;;
    feedback)
      step feedback node feedback/e2e.mjs "$keys/state.json" "$keys/acme.key"
      ;;
    campaigns)
      double 8097 env "$(grep '^WHATSAPP_GATEWAY_SECRET=' "$keys/campaigns-test-vars.env")" node campaigns/mock-resend.mjs || exit 1
      step campaigns node campaigns/e2e.mjs "$keys/acme.key" "$keys/campaigns-test-vars.env"
      ;;
    team-chat)
      step team-chat node team-chat/e2e.mjs "$keys/acme.key"
      ;;
    documents)
      double 8096 node commercial-docs/mock-payments.mjs || exit 1
      host=${workspace#*//}
      # These read and write inv-state.json in their own folder.
      step documents-quotes env --chdir=commercial-docs node inv1-quote-to-invoice.mjs "$keys/acme.key"
      step documents-rules env --chdir=commercial-docs node inv2-rules.mjs "$keys/acme.key" "${host%%:*}"
      step documents-payments env --chdir=commercial-docs node inv6-payments.mjs "$keys/acme.key" "$workspace"
      ;;
    *)
      echo "Unknown suite: $suite" >&2
      exit 2
      ;;
  esac
done

echo
echo "Full output: $logs"
if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "All suites passed."
