#!/usr/bin/env bash
# Idle cost of the scheduled app jobs on the throwaway test server: samples server, worker and database CPU and tallies
# every app function run the worker processed in the window, per app.
# Usage: tests/perf/idle-jobs.sh [minutes=30] [worker container] [server container] [db container]
set -euo pipefail

minutes=${1:-30}
worker=${2:-inventivecrm-test-worker-1}
server=${3:-inventivecrm-test-server-1}
db=${4:-inventivecrm-test-db-1}
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
samples=$(mktemp)
trap 'rm -f "$samples"' EXIT

end=$((SECONDS + minutes * 60))
while [ $SECONDS -lt $end ]; do
  docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' "$server" "$worker" "$db" | tr -d '%' >>"$samples"
  sleep 5
done

declare -A APPS=([992fae47]='Campaign Studio' [54c65493]='Scheduling' [93ae1d55]='Quotes & Invoices' [f69757a9]='Feedback' [6c6eba62]='Team chat' [23e5cd3d]='WhatsApp')
echo "Window: $started, $minutes minutes"
awk -v server="$server" -v worker="$worker" -v db="$db" '
  { sum[$1] += $2; count[$1]++ }
  END { printf "CPU, average share of one core: server %.1f%%, worker %.1f%%, database %.1f%%\n", sum[server] / count[server], sum[worker] / count[worker], sum[db] / count[db] }
' "$samples"
docker logs --since "$started" "$worker" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' |
  grep -oE 'LogicFunctionTriggerJob processed on queue logic-function-queue in [0-9.]+ms \[workspace=[0-9a-f-]+ application=[0-9a-f]{8}' |
  awk '{ ms = $7; sub("ms", "", ms); split($NF, part, "="); app = part[2]; split($(NF-1), ws, "="); runs[app]++; time[app] += ms
      if (!((app, ws[2]) in seen)) { seen[app, ws[2]] = 1; spaces[app]++ } }
    END { for (app in runs) printf "%s %d %.0f %d\n", app, runs[app], time[app], spaces[app] }' |
  while read -r app runs ms spaces; do
    printf '%-18s %4d runs in %d workspaces, %6.1f runs per workspace per hour, %5.1f s of run time per workspace per hour\n' \
      "${APPS[$app]:-$app}" "$runs" "$spaces" "$(echo "$runs / $spaces * 60 / $minutes" | bc -l)" "$(echo "$ms / 1000 / $spaces * 60 / $minutes" | bc -l)"
  done
