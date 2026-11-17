#!/usr/bin/env bash
# Usage: ops/rehearse-data.sh <image:tag> [backup|latest]
# Upgrades a copy of a production backup with the new image and checks that no workspace lost rows. The copy runs
# in throwaway containers on a network with no way out and without a worker, so it cannot reach production's
# database or send anything to a customer. Production is not touched.
. "$(dirname "$0")/lib.sh"

image=${1:?image with a pinned tag, e.g. platform-twenty:2.56.0-p1}
backup=$(resolve_backup "${2:-latest}")
[ -n "$backup" ] && [ -d "$backup" ] || die "no backup found for ${2:-latest}"
docker image inspect "$image" >/dev/null 2>&1 || die "image $image is not on this server"
(cd "$backup" && sha256sum --quiet -c SHA256SUMS) || die "checksum mismatch in $backup"
[ "$(manifest_value "$backup" encryptionKeyFingerprint)" = "$(key_fingerprint)" ] || die "$backup was taken with another ENCRYPTION_KEY"

name=inventivecrm-rehearsal
user=$(env_value PG_DATABASE_USER)
database=$(env_value PG_DATABASE_NAME)
configuration=$(compose config --format json)
db_image=$(jq -r .services.db.image <<<"$configuration")
redis_image=$(jq -r .services.redis.image <<<"$configuration")
server_log="$STATE_DIR/rehearsal-server.log"
work=

cleanup() {
  docker rm -f "$name-server" "$name-db" "$name-redis" >/dev/null 2>&1 || true
  docker volume rm "$name-storage" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  [ -z "$work" ] || rm -rf "$work"
}
fail() {
  docker logs "$name-server" >"$server_log" 2>&1 || true
  die "data rehearsal of $image: $1 (server log: $server_log)"
}

row_counts() {
  docker exec -i "$name-db" psql -U "$user" -d "$database" -v ON_ERROR_STOP=1 -AtF '|' <<'SQL' | LC_ALL=C sort -t'|' -k1,1
SELECT format('SELECT %L, count(*) FROM %I.%I', table_schema || '.' || table_name, table_schema, table_name)
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND (table_schema LIKE 'workspace\_%' OR (table_schema = 'core' AND table_name IN ('workspace', 'user', 'userWorkspace')))
\gexec
SQL
}

take_rehearsal_lock
cleanup
trap cleanup EXIT
work=$(mktemp -d)
log "data rehearsal: $image on a copy of $backup"

docker network create --internal "$name" >/dev/null
docker run -d --name "$name-db" --network "$name" --memory 2g \
  -e POSTGRES_USER="$user" -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB="$database" "$db_image" >/dev/null
docker run -d --name "$name-redis" --network "$name" --memory 512m "$redis_image" >/dev/null
for _ in $(seq 60); do
  docker exec "$name-db" pg_isready -q -h 127.0.0.1 -U "$user" -d "$database" && break
  sleep 2
done
docker exec -i "$name-db" pg_restore -U "$user" -d "$database" --no-owner --exit-on-error <"$backup/db.dump" || fail "the backup did not restore"
docker run --rm -i --network none -v "$name-storage:$STORAGE_PATH" --entrypoint tar "$image" -xzf - -C "$STORAGE_PATH" <"$backup/storage.tar.gz"
row_counts >"$work/before"

# Only the settings that shape an upgrade. No mail, payment or gateway settings: the copy has nothing to send with.
settings() {
  local variable value
  for variable in ENCRYPTION_KEY IS_MULTIWORKSPACE_ENABLED DEFAULT_SUBDOMAIN LOGIC_FUNCTION_TYPE STORAGE_TYPE IS_BILLING_ENABLED CODE_INTERPRETER_TYPE; do
    value=$(env_value "$variable")
    [ -z "$value" ] || printf '%s=%s\n' "$variable" "$value"
  done
}
docker run -d --name "$name-server" --network "$name" --memory 3g --env-file <(settings) \
  -e PG_DATABASE_URL="postgres://$user:rehearsal@$name-db:5432/$database" -e REDIS_URL="redis://$name-redis:6379" \
  -e SERVER_URL=http://localhost:3000 -e DISABLE_CRON_JOBS_REGISTRATION=true \
  -v "$name-storage:$STORAGE_PATH" "$image" >/dev/null

address=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$name-server")
export SERVER_HEALTH_URL="http://$address:3000/healthz"
started=$(date +%s)
until curl -fsS --max-time 5 "$SERVER_HEALTH_URL" >/dev/null 2>&1; do
  [ "$(docker inspect --format '{{.State.Running}}' "$name-server" 2>/dev/null)" = true ] || fail "the server stopped during the upgrade"
  [ $(($(date +%s) - started)) -lt "${UPGRADE_TIMEOUT:-1200}" ] || fail "the server was not healthy within ${UPGRADE_TIMEOUT:-1200}s"
  sleep 5
done
duration=$(($(date +%s) - started))
if docker logs "$name-server" 2>&1 | upgrade_errors_logged; then fail "some workspaces did not migrate"; fi

row_counts >"$work/after"
# An upgrade may drop a table it no longer uses; that only loses data when the table had rows.
comparison=$(LC_ALL=C join -t'|' -a1 -e gone -o 0,1.2,2.2 "$work/before" "$work/after")
lost=$(awk -F'|' '($3 == "gone" && $2 + 0 > 0) || ($3 != "gone" && $3 + 0 < $2 + 0) { printf "%s %s -> %s; ", $1, $2, $3 }' <<<"$comparison")
[ -z "$lost" ] || fail "rows were lost: $lost"
dropped=$(awk -F'|' '$3 == "gone" { printf " %s", $1 }' <<<"$comparison")
[ -z "$dropped" ] || log "data rehearsal: the upgrade removed these empty tables:$dropped"
"$OPS_DIR/smoke-test.sh" || fail "the smoke test failed on the upgraded copy"

total() { awk -F'|' '{ rows += $2 } END { print rows + 0 }' "$1"; }
log "data rehearsal: passed, upgraded in ${duration}s; none of $(wc -l <"$work/before") tables lost rows ($(total "$work/before") before, $(total "$work/after") after)"
printf 'OK %s on %s\n' "$image" "$backup"
