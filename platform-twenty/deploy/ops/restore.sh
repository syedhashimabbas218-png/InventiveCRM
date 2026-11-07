#!/usr/bin/env bash
# Usage: ops/restore.sh <backup|latest|latest-pre-upgrade> [--yes]
# Puts the whole instance back to a backup: database, files, DKIM keys and the image it ran. This is the rollback.
# The current state is backed up first (label before-restore), so a restore never loses data for good.
. "$(dirname "$0")/lib.sh"

backup=$(resolve_backup "${1:?backup directory, latest or latest-pre-upgrade}")
[ "${2:-}" = --yes ] && ASSUME_YES=1
[ -n "$backup" ] && [ -d "$backup" ] || die "no backup found for ${1}"
"$OPS_DIR/verify-backup.sh" "$backup" >/dev/null

backup_image=$(manifest_value "$backup" image)
if [ "$(manifest_value "$backup" encryptionKeyFingerprint)" != "$(key_fingerprint)" ]; then
  die "ENCRYPTION_KEY in .env differs from the one this backup was taken with; put the original key back first"
fi
docker image inspect "$backup_image" >/dev/null 2>&1 || docker pull "$backup_image" >/dev/null || die "image $backup_image is not available"
# A backup records the exact image it ran; refuse to start anything else under that name (a swapped tag or an edited
# manifest). Older backups without imageId are accepted.
backup_image_id=$(manifest_value "$backup" imageId)
if [ -n "$backup_image_id" ] && [ "$backup_image_id" != null ] && [ "$(docker image inspect --format '{{.Id}}' "$backup_image")" != "$backup_image_id" ]; then
  die "image $backup_image is not the one this backup was taken with ($backup_image_id)"
fi

confirm "This replaces every workspace's data with the backup from $(manifest_value "$backup" createdAt) and runs $backup_image."
take_lock
log "restore: from $backup ($backup_image), current image $(env_value IMAGE)"

compose stop worker server
safety=$("$OPS_DIR/backup.sh" before-restore)
log "restore: current state saved in $safety"

user=$(env_value PG_DATABASE_USER)
database=$(env_value PG_DATABASE_NAME)
psql_db -d postgres -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" -c "CREATE DATABASE \"$database\""
compose exec -T db pg_restore -U "$user" -d "$database" --no-owner --exit-on-error <"$backup/db.dump"
compose run --rm --no-deps -T --entrypoint sh server -c "find $STORAGE_PATH -mindepth 1 -delete && tar -xzf - -C $STORAGE_PATH" <"$backup/storage.tar.gz"
compose run --rm --no-deps -T --entrypoint sh mail -c "find $DKIM_PATH -mindepth 1 -delete && tar -xzf - -C $DKIM_PATH" <"$backup/mail-dkim.tar.gz"
# Cached metadata and queued jobs belong to the replaced state.
compose exec -T redis redis-cli FLUSHALL >/dev/null
compose exec -T redis-queue redis-cli FLUSHALL >/dev/null

set_env_value IMAGE "$backup_image"
compose up -d mail server
wait_healthy "${RESTORE_TIMEOUT:-900}" || die "server did not become healthy after the restore; the pre-restore state is in $safety"
compose up -d worker
"$OPS_DIR/smoke-test.sh" || die "smoke test failed after the restore; the pre-restore state is in $safety"
log "restore: done, running $backup_image"
