#!/usr/bin/env bash
# Shared helpers for the ops scripts. They act on the deploy directory that contains this ops/ folder.
set -euo pipefail

OPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPLOY_DIR=$(dirname "$OPS_DIR")
ENV_FILE="$DEPLOY_DIR/.env"
# Read literally (BACKUP_OFFSITE_COMMAND refers to $BACKUP_PATH); variables already set in the environment win.
if [ -f "$DEPLOY_DIR/ops.env" ]; then
  while IFS= read -r line; do
    [[ $line =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
    name=${BASH_REMATCH[1]} value=${BASH_REMATCH[2]}
    [[ $value =~ ^\"(.*)\"$ ]] && value=${BASH_REMATCH[1]}
    [ -n "${!name+set}" ] || export "$name=$value"
  done <"$DEPLOY_DIR/ops.env"
fi
BACKUP_DIR=${BACKUP_DIR:-/var/backups/inventivecrm}
STATE_DIR=${STATE_DIR:-$DEPLOY_DIR/state}
SERVER_HEALTH_URL=${SERVER_HEALTH_URL:-http://127.0.0.1:3000/healthz}
mkdir -p "$STATE_DIR" "$BACKUP_DIR"

# shellcheck disable=SC2034 # used by the scripts that source this file
STORAGE_PATH=/app/packages/twenty-server/.local-storage
# shellcheck disable=SC2034
DKIM_PATH=/etc/opendkim/keys

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$STATE_DIR/history.log" >&2; }
die() { log "ERROR: $*"; exit 1; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found"

# Honours COMPOSE_FILE from .env (colon-separated, relative to the deploy directory), as plain docker compose does.
compose() {
  local names=() files=() name
  IFS=: read -ra names <<<"$(env_value COMPOSE_FILE)"
  [ ${#names[@]} -gt 0 ] || names=(docker-compose.yml)
  for name in "${names[@]}"; do files+=(-f "$DEPLOY_DIR/$name"); done
  docker compose --project-directory "$DEPLOY_DIR" "${files[@]}" --env-file "$ENV_FILE" "$@"
}

env_value() {
  local value
  value=$(grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)
  value=${value#\"}; value=${value%\"}
  printf '%s' "$value"
}

set_env_value() {
  cp "$ENV_FILE" "$STATE_DIR/env.$(date -u +%Y%m%dT%H%M%SZ).bak"
  chmod 600 "$STATE_DIR"/env.*.bak
  sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"
}

# Restores need the ENCRYPTION_KEY the backup was taken with, so backups record a fingerprint of it, never the key.
key_fingerprint() { printf '%s' "$(env_value ENCRYPTION_KEY)" | sha256sum | cut -c1-16; }

version_of() { grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<<"${1##*:}" | head -1 || true; }

take_lock() {
  [ "${OPS_LOCK_HELD:-}" = 1 ] && return
  exec 9>"$STATE_DIR/ops.lock"
  flock -n 9 || die "another backup, upgrade or restore is running"
  export OPS_LOCK_HELD=1
}

psql_db() { compose exec -T db psql -v ON_ERROR_STOP=1 -U "$(env_value PG_DATABASE_USER)" "$@"; }

wait_healthy() {
  local timeout=$1 started
  started=$(date +%s)
  until curl -fsS --max-time 5 "$SERVER_HEALTH_URL" >/dev/null 2>&1; do
    if [ $(($(date +%s) - started)) -ge "$timeout" ]; then return 1; fi
    sleep 5
  done
}

resolve_backup() {
  local pattern
  case "$1" in
    latest) pattern='*' ;;
    latest-pre-upgrade) pattern='*-pre-upgrade-*' ;;
    /*) printf '%s' "$1"; return ;;
    *) printf '%s' "$BACKUP_DIR/$1"; return ;;
  esac
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name "$pattern" ! -name '*.partial' | sort | tail -1
}

manifest_value() { jq -r ".$2" "$1/manifest.json"; }

confirm() {
  [ "${ASSUME_YES:-}" = 1 ] && return
  read -r -p "$1 Type yes to continue: " answer
  [ "$answer" = yes ] || die "cancelled"
}
