#!/usr/bin/env bash
# Usage: ops/rehearse-apps.sh <image:tag>
# Runs every app test suite against a throwaway copy of the test stack upgraded to the new image. The test stack is
# stopped while the copy uses its ports and is otherwise left as it was, except that it is first moved to
# production's image when it lags behind, so the copy upgrades from the release production really runs.
# The test stack is a compose project with server, worker and db services that takes IMAGE from its .env.
. "$(dirname "$0")/lib.sh"

image=${1:?image with a pinned tag, e.g. platform-twenty:2.56.0-p1}
stack=${TEST_STACK_DIR:?set TEST_STACK_DIR in ops.env to the folder of the throwaway test stack}
keys=${TEST_KEYS_DIR:?set TEST_KEYS_DIR in ops.env to the folder with the keys of the test workspaces}
url=${TEST_SERVER_URL:-http://localhost:3001}
[ "$(realpath "$stack")" != "$(realpath "$DEPLOY_DIR")" ] || die "TEST_STACK_DIR is the production stack"
docker image inspect "$image" >/dev/null 2>&1 || die "image $image is not on this server"

original() { (cd "$stack" && env -u IMAGE docker compose "$@"); }
configuration=$(original config --format json)
project=$(jq -r .name <<<"$configuration")
copy() { (cd "$stack" && IMAGE=$image docker compose -p "$project-rehearsal" "$@"); }
db_image=$(jq -r .services.db.image <<<"$configuration")
db_user=$(jq -r .services.db.environment.POSTGRES_USER <<<"$configuration")
db_name=$(jq -r .services.db.environment.POSTGRES_DB <<<"$configuration")
server_log="$STATE_DIR/rehearsal-apps-server.log"
work=$(mktemp -d)

# Starts the server of the given stack, waits for the upgrade the image runs on start, then reads its log.
start_server() {
  local started
  started=$(date +%s)
  "$1" up -d server >/dev/null 2>&1 || return 1
  until curl -fsS --max-time 5 "$url/healthz" >/dev/null 2>&1; do
    [ -n "$("$1" ps -q --status running server)" ] || return 1
    [ $(($(date +%s) - started)) -lt "${UPGRADE_TIMEOUT:-1200}" ] || return 1
    sleep 5
  done
  ! "$1" logs server 2>&1 | upgrade_errors_logged
}

take_rehearsal_lock
was_running=$(original ps -q --status running)
cleanup() {
  copy down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
  [ -z "$was_running" ] || original start >/dev/null 2>&1 || true
}
fail() {
  copy logs server worker >"$server_log" 2>&1 || true
  die "app rehearsal of $image: $1 (server log: $server_log)"
}
copy down --volumes --remove-orphans >/dev/null 2>&1 || true
trap cleanup EXIT
log "app rehearsal: $image on a copy of the test stack in $stack"

production_image=$(env_value IMAGE)
test_image=$(jq -r .services.server.image <<<"$configuration")
if [ "$test_image" != "$production_image" ] &&
  [ "$(printf '%s\n%s\n' "$(version_of "$test_image")" "$(version_of "$production_image")" | sort -V | tail -1)" = "$(version_of "$production_image")" ]; then
  log "app rehearsal: moving the test stack from $test_image to production's $production_image"
  sed -i "s#^IMAGE=.*#IMAGE=$production_image#" "$stack/.env"
  start_server original || die "app rehearsal: the test stack did not come up on $production_image"
  original up --no-start >/dev/null 2>&1
fi

original up -d --wait db >/dev/null 2>&1 || die "app rehearsal: the test stack's database did not start"
original exec -T db pg_dump -U "$db_user" -d "$db_name" -Fc >"$work/db.dump"
original stop >/dev/null 2>&1

copy up -d --wait db >/dev/null 2>&1 || fail "the copy's database did not start"
copy exec -T db pg_restore -U "$db_user" -d "$db_name" --no-owner --exit-on-error <"$work/db.dump" || fail "the test database did not restore"
copy create server >/dev/null 2>&1
paste <(jq -r '.volumes // {} | .[].name' <<<"$configuration") <(copy config --format json | jq -r '.volumes // {} | .[].name') |
  while read -r from to; do
    docker run --rm --network none --user 0 -v "$from:/from:ro" -v "$to:/to" --entrypoint cp "$db_image" -a /from/. /to/
  done

start_server copy || fail "the copy did not come up healthy on $image"
copy up -d --wait >/dev/null 2>&1 || fail "the copy's worker did not start"
PATH="${TEST_NODE_DIR:+$TEST_NODE_DIR:}$PATH" SERVER_URL=$url "$PLATFORM_DIR/tests/run-all.sh" "$keys" | tee "$work/suites.log" ||
  fail "these app test suites failed: $(grep -m1 '^FAILED:' "$work/suites.log" | cut -d' ' -f2-)"
log "app rehearsal: passed, every suite ran clean on $image"
printf 'OK %s\n' "$image"
