#!/usr/bin/env bash
# Usage: ops/upgrade.sh <image:tag> [--yes] [--no-rollback]
# Stops the stack, takes and verifies a backup, switches the image, waits for the migrations, smoke-tests,
# and restores the backup automatically if any of that fails. See UPDATES.md for the rules around it.
. "$(dirname "$0")/lib.sh"

new_image=${1:?image with a pinned tag, e.g. platform-twenty:2.56.0-p1}
shift
rollback=1
for option in "$@"; do
  case "$option" in
    --yes) ASSUME_YES=1 ;;
    --no-rollback) rollback=0 ;;
    *) die "unknown option $option" ;;
  esac
done

current_image=$(env_value IMAGE)
current_version=$(version_of "$current_image")
new_version=$(version_of "$new_image")
[[ $new_image == *:* && ${new_image##*:} != latest ]] || die "pin a tag; never use latest"
[ -n "$new_version" ] || die "the tag of $new_image carries no X.Y.Z version"
[ "$new_image" != "$current_image" ] || die "already running $new_image"
if [ "$(printf '%s\n%s\n' "$current_version" "$new_version" | sort -V | head -1)" != "$current_version" ]; then
  die "$new_version is older than $current_version: Twenty cannot migrate a database back; use ops/restore.sh with the pre-upgrade backup"
fi

docker image inspect "$new_image" >/dev/null 2>&1 || docker pull "$new_image" >/dev/null || die "image $new_image is not on this server and cannot be pulled"
wait_healthy 30 || die "the server is not healthy now; fix that before upgrading"
database_bytes=$(psql_db -d "$(env_value PG_DATABASE_NAME)" -tAc 'SELECT pg_database_size(current_database())')
free_bytes=$(($(df --output=avail -k "$BACKUP_DIR" | tail -1) * 1024))
[ "$free_bytes" -gt $((database_bytes * 2)) ] || die "not enough space in $BACKUP_DIR for a backup"

confirm "Upgrade $current_image -> $new_image. The CRM is offline until it finishes (usually a few minutes)."
take_lock
log "upgrade: $current_image -> $new_image"

compose stop worker server
backup=$("$OPS_DIR/backup.sh" "pre-upgrade-$current_version-to-$new_version")

fail() {
  log "upgrade: FAILED: $1"
  if [ "$rollback" = 1 ]; then
    log "upgrade: rolling back to $backup"
    ASSUME_YES=1 "$OPS_DIR/restore.sh" "$backup" --yes
    die "upgrade to $new_image failed ($1); rolled back to $current_image"
  fi
  die "upgrade to $new_image failed ($1); roll back with: ops/restore.sh $backup"
}

set_env_value IMAGE "$new_image"
started=$(date -u +%FT%TZ)
compose up -d server || fail "the server did not start"
wait_healthy "${UPGRADE_TIMEOUT:-1200}" || fail "the server was not healthy within ${UPGRADE_TIMEOUT:-1200}s"
if compose logs --since "$started" server 2>&1 | upgrade_errors_logged; then
  fail "some workspaces did not migrate"
fi
compose up -d worker || fail "the worker did not start"
"$OPS_DIR/smoke-test.sh" || fail "smoke test"
log "upgrade: done, running $new_image; backup $backup"
