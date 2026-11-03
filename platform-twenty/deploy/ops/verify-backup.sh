#!/usr/bin/env bash
# Usage: ops/verify-backup.sh <backup|latest|latest-pre-upgrade> [--full]
# Checks checksums and that the dump and archives are readable. --full restores the dump into a throwaway
# Postgres container and counts workspaces: the monthly restore drill.
. "$(dirname "$0")/lib.sh"

backup=$(resolve_backup "${1:?backup directory, latest or latest-pre-upgrade}")
[ -n "$backup" ] && [ -d "$backup" ] || die "no backup found for ${1}"
(cd "$backup" && sha256sum --quiet -c SHA256SUMS) || die "checksum mismatch in $backup"
compose exec -T db pg_restore --list <"$backup/db.dump" >/dev/null || die "database dump in $backup is unreadable"
tar -tzf "$backup/storage.tar.gz" >/dev/null || die "file archive in $backup is unreadable"
tar -tzf "$backup/mail-dkim.tar.gz" >/dev/null || die "DKIM archive in $backup is unreadable"

if [ "${2:-}" = --full ]; then
  name="inventivecrm-restore-drill-$$"
  db_image=$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q db)")
  docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=drill "$db_image" >/dev/null
  trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
  until docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done
  sleep 2
  docker exec -i "$name" pg_restore -U postgres -d postgres --no-owner --exit-on-error <"$backup/db.dump" || die "restore drill failed for $backup"
  workspaces=$(docker exec "$name" psql -U postgres -tAc 'SELECT count(*) FROM core.workspace')
  schemas=$(docker exec "$name" psql -U postgres -tAc "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'workspace\_%'")
  log "restore drill: $backup restored, $workspaces workspaces, $schemas workspace schemas"
fi
printf 'OK %s\n' "$backup"
