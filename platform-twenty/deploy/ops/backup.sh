#!/usr/bin/env bash
# Usage: ops/backup.sh [label]   (nightly, manual, pre-upgrade-..., before-restore)
# Backs up the database, uploaded files and DKIM keys, verifies the copy, then prunes old backups.
. "$(dirname "$0")/lib.sh"

label=${1:-manual}
[[ $label =~ ^[a-z0-9.-]+$ ]] || die "label may only contain lowercase letters, digits, dots and hyphens"
take_lock

image=$(env_value IMAGE)
target="$BACKUP_DIR/$(date -u +%Y%m%dT%H%M%SZ)-$label"
work="$target.partial"
mkdir -p "$work"
chmod 700 "$work"
log "backup $label: starting ($image)"

compose exec -T db pg_dump -U "$(env_value PG_DATABASE_USER)" -d "$(env_value PG_DATABASE_NAME)" -Fc >"$work/db.dump"
# Files after the database: uploads are only ever added, so every file the dump references is in the archive.
compose run --rm --no-deps -T --entrypoint tar server -czf - -C "$STORAGE_PATH" . >"$work/storage.tar.gz"
compose run --rm --no-deps -T --entrypoint tar mail -czf - -C "$DKIM_PATH" . >"$work/mail-dkim.tar.gz"

jq -n \
  --arg createdAt "$(date -u +%FT%TZ)" \
  --arg label "$label" \
  --arg image "$image" \
  --arg imageDigest "$(docker image inspect --format '{{join .RepoDigests ","}}' "$image" 2>/dev/null || true)" \
  --arg imageId "$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)" \
  --arg database "$(env_value PG_DATABASE_NAME)" \
  --arg encryptionKeyFingerprint "$(key_fingerprint)" \
  '{createdAt: $createdAt, label: $label, image: $image, imageDigest: $imageDigest, imageId: $imageId, database: $database, encryptionKeyFingerprint: $encryptionKeyFingerprint}' \
  >"$work/manifest.json"
(cd "$work" && sha256sum db.dump storage.tar.gz mail-dkim.tar.gz manifest.json >SHA256SUMS)

"$OPS_DIR/verify-backup.sh" "$work" >/dev/null
mv "$work" "$target"
log "backup $label: done $target ($(du -sh "$target" | cut -f1))"

if [ -n "${BACKUP_OFFSITE_COMMAND:-}" ]; then
  BACKUP_PATH="$target" sh -c "$BACKUP_OFFSITE_COMMAND" || die "offsite copy failed for $target (the local backup is intact)"
  log "backup $label: copied offsite"
fi

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*-nightly' -mtime +"${BACKUP_RETENTION_DAYS:-30}" -exec rm -rf {} +
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mmin +720 -exec rm -rf {} +

printf '%s\n' "$target"
