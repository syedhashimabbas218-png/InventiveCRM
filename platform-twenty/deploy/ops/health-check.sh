#!/usr/bin/env bash
# Usage: ops/health-check.sh [--test-alert]
# Every 15 minutes from cron. Checks the server, the containers, the worker log, backups, disk, certificates and
# waiting releases; prints one line per check, writes state/health.json and exits 1 on any FAIL. Alerts go out only
# when the set of failing checks changes; the heartbeat is pinged after every run without a FAIL. See MONITORING.md.
# --test-alert sends a test alert through every channel set in ops.env and leaves the recorded state alone.
. "$(dirname "$0")/lib.sh"

test_alert=0
case "${1:-}" in
  '') ;;
  --test-alert) test_alert=1 ;;
  *) die "unknown option $1" ;;
esac

exec 6>"$STATE_DIR/health.lock"
flock -n 6 || die "another health check is running"

status_file="$STATE_DIR/health.json"
started=$(date -u +%FT%TZ)
now=$(date +%s)
host=$(hostname)
results=()
lines=()

epoch() { [ -n "$1" ] && date -d "$1" +%s 2>/dev/null || echo 0; }
iso() { date -u -d "@$1" +%FT%TZ; }
age_text() { if [ "$1" -ge 172800 ]; then printf '%d days' $(($1 / 86400)); else printf '%dh' $(($1 / 3600)); fi; }
worst() { case "$1/$2" in FAIL/* | */FAIL) echo FAIL ;; WARN/* | */WARN) echo WARN ;; *) echo OK ;; esac; }
join() {
  local out=$1 item
  shift
  for item in "$@"; do out+=", $item"; done
  printf '%s' "$out"
}

result() {
  local detail=${3//[$'\t\n']/ }
  results+=("$1"$'\t'"$2"$'\t'"$detail")
  lines+=("$(printf '%-4s %-13s %s' "$2" "$1" "$detail")")
  printf '%s\n' "${lines[-1]}"
}

check_healthz() {
  local error
  if error=$(curl -fsS --max-time 10 -o /dev/null "$SERVER_HEALTH_URL" 2>&1); then
    result healthz OK "$SERVER_HEALTH_URL answered"
  else
    result healthz FAIL "$SERVER_HEALTH_URL: ${error#curl: }"
  fi
}

check_containers() {
  local services states service state health level=OK problems=()
  if ! services=$(compose config --services 2>/dev/null) || ! states=$(compose ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null); then
    result containers FAIL "docker compose could not list the stack"
    return
  fi
  for service in $services; do
    read -r state health <<<"$(awk -v service="$service" '$1 == service { print $2, $3; exit }' <<<"$states")"
    case "${state:-missing}/${health:-}" in
      running/ | running/healthy) ;;
      running/starting) problems+=("$service: starting"); level=$(worst "$level" WARN) ;;
      *) problems+=("$service: ${health:-${state:-no container}}"); level=FAIL ;;
    esac
  done
  if [ ${#problems[@]} -eq 0 ]; then
    result containers OK "all $(wc -w <<<"$services") services running"
  else
    result containers "$level" "$(join "${problems[@]}")"
  fi
}

# Twenty 2.55 logs a failed job as an ERROR line or an "Exception Captured" block, and a dead worker's job as "stalled".
check_worker() {
  local since=$1 log failures count contexts level=WARN
  if ! log=$(compose logs --no-log-prefix --no-color --since "$since" worker 2>&1); then
    result worker FAIL "could not read the worker log"
    return
  fi
  failures=$(sed 's/\x1b\[[0-9;]*m//g' <<<"$log" | grep -E 'ERROR \[|Exception Captured|\[BullMQDriver\] .*\b(failed|stalled)\b' || true)
  if [ -z "$failures" ]; then
    result worker OK "no failed jobs or errors since $since"
    return
  fi
  count=$(wc -l <<<"$failures")
  # Only the logger names leave the server: the messages can hold client data.
  contexts=$(sed -E 's/.*Exception Captured.*/uncaught exception/; s/.*(ERROR|WARN|LOG) +\[([^]]+)\].*/\2/' <<<"$failures" |
    sort | uniq -c | sort -rn | head -3 | awk '{ count = $1; sub(/^ *[0-9]+ /, ""); printf "%s%s x%s", (NR > 1 ? ", " : ""), $0, count }')
  [ "$count" -lt "${HEALTH_WORKER_ERRORS_FAIL:-10}" ] || level=FAIL
  result worker "$level" "$count failed jobs or errors since $since: $contexts"
}

check_backup() {
  local newest created age last stamp level=OK notes=()
  newest=$(resolve_backup latest)
  if [ -z "$newest" ]; then
    result backup FAIL "no backup in $BACKUP_DIR"
    return
  fi
  created=$(epoch "$(jq -r .createdAt "$newest/manifest.json" 2>/dev/null)")
  age=$((now - created))
  [ "$age" -le $((${HEALTH_BACKUP_MAX_AGE_HOURS:-26} * 3600)) ] || { level=FAIL; notes+=("over the ${HEALTH_BACKUP_MAX_AGE_HOURS:-26}h limit"); }
  # backup.sh leaves its .partial folder behind when it fails, until the next backup succeeds.
  last=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort | tail -1)
  if [[ $last == *.partial ]]; then
    stamp=$(basename "$last")
    stamp="${stamp:0:4}-${stamp:4:2}-${stamp:6:2}T${stamp:9:2}:${stamp:11:2}:${stamp:13:2}Z"
    [ $((now - $(epoch "$stamp"))) -lt 10800 ] || { level=FAIL; notes+=("the backup started $stamp did not finish"); }
  fi
  if [ -z "${BACKUP_OFFSITE_COMMAND:-}" ]; then
    level=$(worst "$level" WARN)
    notes+=("no off-site copy (BACKUP_OFFSITE_COMMAND is empty)")
  elif grep -qF "offsite copy failed for $newest (" "$STATE_DIR/history.log" 2>/dev/null; then
    level=FAIL
    notes+=("its off-site copy failed")
  fi
  result backup "$level" "$(join "$(basename "$newest"), $(age_text "$age") old, verified when taken" "${notes[@]}")"
}

# verify-backup.sh logs a passed restore drill and every failed verification; a failure stays until a drill passes.
check_backup_verify() {
  local line stamp age
  line=$(grep -E 'restore drill: |ERROR: (checksum mismatch in|database dump in|file archive in|DKIM archive in|restore drill failed for) ' \
    "$STATE_DIR/history.log" 2>/dev/null | grep -vF .partial | tail -1 || true)
  if [ -z "$line" ]; then
    result backup-verify WARN "no full restore drill recorded; run ops/verify-backup.sh latest --full"
    return
  fi
  stamp=${line%% *}
  age=$((now - $(epoch "$stamp")))
  if [[ $line == *' ERROR: '* ]]; then
    result backup-verify FAIL "${line#* ERROR: } ($stamp); clears when ops/verify-backup.sh latest --full passes"
  elif [ "$age" -gt $((${HEALTH_DRILL_MAX_AGE_DAYS:-35} * 86400)) ]; then
    result backup-verify WARN "the last full restore drill passed $(age_text "$age") ago"
  else
    result backup-verify OK "the last full restore drill passed ${stamp%T*}, $(age_text "$age") ago"
  fi
}

check_disk() {
  local name=$1 path=$2 used free level=OK
  read -r used free <<<"$(df -h --output=pcent,avail "$path" | tail -1)"
  used=${used%\%}
  [ "$used" -lt "${HEALTH_DISK_WARN_PERCENT:-80}" ] || level=WARN
  [ "$used" -lt "${HEALTH_DISK_FAIL_PERCENT:-90}" ] || level=FAIL
  result "$name" "$level" "$path $used% used, $free free"
}

# Site names from the Caddyfile; a wildcard is checked through the sign-in subdomain.
caddy_hosts() {
  grep -E '^[a-z0-9*][^#{]*\{$' "$DEPLOY_DIR/caddy/Caddyfile" 2>/dev/null | tr -d '{,' | tr -s ' \t' '\n' | sed 's/^\*\./app./' | grep . || true
}

check_tls() {
  local name output end days code level=OK problems=() shortest=
  if [ -z "$(ss -Hltn 'sport = :443')" ]; then
    result tls OK "skipped: nothing listens on port 443 yet"
    return
  fi
  for name in ${HEALTH_TLS_HOSTS:-$(caddy_hosts)}; do
    output=$(timeout 15 openssl s_client -connect 127.0.0.1:443 -servername "$name" -verify_hostname "$name" </dev/null 2>/dev/null || true)
    if ! end=$(openssl x509 -noout -enddate <<<"$output" 2>/dev/null); then
      problems+=("$name: no certificate")
      level=FAIL
      continue
    fi
    days=$((($(epoch "${end#notAfter=}") - now) / 86400))
    [ -n "$shortest" ] && [ "$shortest" -le "$days" ] || shortest=$days
    code=$(grep -oE 'Verify return code: [0-9]+ \([^)]*\)' <<<"$output" | tail -1 || true)
    if [ "$code" != 'Verify return code: 0 (ok)' ]; then
      problems+=("$name: ${code#Verify return code: }")
      level=FAIL
    elif [ "$days" -lt "${HEALTH_TLS_WARN_DAYS:-21}" ]; then
      problems+=("$name expires in $days days")
      level=$(worst "$level" WARN)
      [ "$days" -ge "${HEALTH_TLS_FAIL_DAYS:-7}" ] || level=FAIL
    fi
  done
  if [ ${#problems[@]} -eq 0 ]; then
    result tls OK "certificates valid; the first expires in ${shortest:-?} days"
  else
    result tls "$level" "$(join "${problems[@]}")"
  fi
}

check_release() {
  local file="$STATE_DIR/update-status.json" level=OK detail age
  [ "${HEALTH_RELEASE_CHECK:-on}" != off ] || return 0
  if [ ! -f "$file" ]; then
    result release OK "no update check has run yet"
    return
  fi
  case "$(jq -r .verdict "$file")" in
    ready) level=WARN detail="$(jq -r .candidate "$file") passed both rehearsals and waits for: $(jq -r .next "$file")" ;;
    not-ready) detail="$(jq -r '.latestRelease // "a new release" | sub("^twenty/v"; "Twenty ")' "$file") is out but not ready (ops/auto-update.sh --status)" ;;
    *) detail="production runs the newest Twenty release" ;;
  esac
  age=$((now - $(epoch "$(jq -r .checkedAt "$file")")))
  if [ "$age" -gt $((8 * 86400)) ]; then
    level=WARN
    detail+="; the weekly update check last ran $(age_text "$age") ago"
  fi
  result release "$level" "$detail"
}

send_email() {
  local subject=$1 text=$2 from smtp_url=${ALERT_SMTP_URL:-} relay message
  from=$(env_value EMAIL_FROM_ADDRESS)
  from=${from:-root@$(hostname -f)}
  message=$(printf 'From: InventiveCRM monitor <%s>\nTo: %s\nSubject: %s\nDate: %s\nMessage-ID: <health.%s.%s@%s>\nContent-Type: text/plain; charset=utf-8\n\n%s\n' \
    "$from" "$ALERT_EMAIL" "$subject" "$(date -R)" "$now" "$$" "${from#*@}" "$text")
  if [ -z "$smtp_url" ] && relay=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$(compose ps -q mail 2>/dev/null)" 2>/dev/null); then
    smtp_url="smtp://${relay%% *}:587"
  fi
  if [ -n "$smtp_url" ] && curl -sS --max-time 30 --crlf --url "$smtp_url" --mail-from "$from" --mail-rcpt "$ALERT_EMAIL" --upload-file - <<<"$message" >/dev/null 2>&1; then
    return 0
  fi
  command -v sendmail >/dev/null && sendmail -t -f "$from" <<<"$message" 2>/dev/null
}

send_alerts() {
  local title=${1:-} text outcome sent=() failed=()
  if [ -z "$title" ]; then
    title="InventiveCRM on $host: recovered"
    [ "$failing" = '[]' ] || title="InventiveCRM on $host: failing ($(jq -r 'join(", ")' <<<"$failing"))"
  fi
  text=$(printf '%s\n\n' "$title"; printf '%s\n' "${lines[@]}")
  text=${text:0:1900}
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    if jq -n --arg title "$title" --arg text "$text" --arg status "$overall" --argjson failing "$failing" --arg host "$host" --arg checkedAt "$started" \
      '{title: $title, text: $text, content: $text, status: $status, failing: $failing, host: $host, checkedAt: $checkedAt}' |
      curl -fsS -g --max-time 15 --retry 2 -H 'Content-Type: application/json' --data-binary @- -o /dev/null "$ALERT_WEBHOOK_URL" 2>/dev/null; then
      sent+=(webhook)
    else
      failed+=(webhook)
    fi
  fi
  if [ -n "${ALERT_EMAIL:-}" ]; then
    if send_email "$title" "$text"; then sent+=(email); else failed+=(email); fi
  fi
  if [ ${#sent[@]} -gt 0 ]; then
    outcome="alert sent by ${sent[*]}"
  elif [ ${#failed[@]} -eq 0 ]; then
    outcome="no alert channel is set in ops.env"
  else
    outcome="no alert sent"
  fi
  [ ${#failed[@]} -eq 0 ] || outcome+="; ${failed[*]} failed"
  log "health: ${title#*: }; $outcome"
}

since=$(jq -r '.checkedAt // empty' "$status_file" 2>/dev/null || true)
[ -n "$since" ] || since=$(iso $((now - 900)))
[ "$(epoch "$since")" -ge $((now - 86400)) ] || since=$(iso $((now - 86400)))

check_healthz
check_containers
check_worker "$since"
check_backup
check_backup_verify
check_disk disk /
check_disk backup-disk "$BACKUP_DIR"
check_tls
check_release

checks=$(printf '%s\n' "${results[@]}" | jq -R 'split("\t") | {name: .[0], status: .[1], detail: .[2]}' | jq -s .)
failing=$(jq -c '[.[] | select(.status == "FAIL") | .name]' <<<"$checks")
overall=$(jq -r 'if any(.[]; .status == "FAIL") then "fail" elif any(.[]; .status == "WARN") then "warn" else "ok" end' <<<"$checks")
previous=$(jq -c '.failing // []' "$status_file" 2>/dev/null || echo '[]')

if [ "$test_alert" = 1 ]; then
  send_alerts "InventiveCRM on $host: test alert"
elif [ "$failing" != "$previous" ]; then
  send_alerts
fi
if [ "$overall" != fail ] && [ -n "${HEARTBEAT_URL:-}" ]; then
  if curl -fsS -g --max-time 10 --retry 3 -o /dev/null "$HEARTBEAT_URL" 2>/dev/null; then
    [ "$test_alert" = 0 ] || echo "health: heartbeat sent" >&2
  else
    echo "health: the heartbeat ping failed" >&2
  fi
fi
[ "$test_alert" = 0 ] || exit 0

jq -n --arg checkedAt "$started" --arg status "$overall" --argjson failing "$failing" --argjson checks "$checks" '$ARGS.named' >"$status_file.new"
mv "$status_file.new" "$status_file"
[ "$overall" != fail ] || exit 1
