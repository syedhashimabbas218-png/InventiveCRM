#!/usr/bin/env bash
# Usage: ops/pre-upgrade-check.sh [image:tag]
# The go/no-go before ops/upgrade.sh (docs/upgrade-checklist.md): the rehearsal verdict, a fresh verified backup and
# its off-site copy, disk space, nothing else running, the smoke test and the way back. It only reads: it takes no
# backup, pulls nothing and restarts nothing. The target defaults to the rehearsed candidate. Exit 0 is go, 1 no-go.
. "$(dirname "$0")/lib.sh"

status_file="$STATE_DIR/update-status.json"
max_rehearsal_days=${PRE_UPGRADE_MAX_REHEARSAL_DAYS:-8}
max_backup_minutes=${PRE_UPGRADE_MAX_BACKUP_MINUTES:-60}
failures=0
warnings=()

pass() { printf 'ok    %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }
warn() { printf 'WARN  %s\n' "$*"; warnings+=("$*"); }
note() { printf '      %s\n' "$*"; }
section() { printf '\n%s\n' "$*"; }
seconds_since() { echo $(($(date +%s) - $(date -d "$1" +%s))); }
ago() {
  local value unit
  if [ "$1" -lt 7200 ]; then value=$(($1 / 60)) unit=minute
  elif [ "$1" -lt 172800 ]; then value=$(($1 / 3600)) unit=hour
  else value=$(($1 / 86400)) unit=day; fi
  [ "$value" = 1 ] || unit+=s
  echo "$value $unit"
}
size() { numfmt --to=iec "$1"; }

status=$(cat "$status_file" 2>/dev/null || true)
jq -e . <<<"$status" >/dev/null 2>&1 || status='{}'
status_value() { jq -r --arg key "$1" '.[$key] // empty' <<<"$status"; }

current=$(env_value IMAGE)
current_version=$(version_of "$current")
target=${1:-$(status_value candidate)}
target_version=$(version_of "$target")

printf 'Pre-upgrade check, %s\n' "$(date -u +%FT%TZ)"
printf '  production  %s (Twenty %s)\n' "$current" "$current_version"
printf '  target      %s (Twenty %s)\n' "${target:-none}" "${target_version:-?}"

section 'Target image'
if [ -z "$target" ]; then
  fail "no target image: auto-update.sh has not rehearsed one ($(status_value detail))"
else
  if [[ $target != *:* || ${target##*:} == latest || -z $target_version ]]; then
    fail "$target is not a pinned X.Y.Z-pN tag"
  elif [ "$target" = "$current" ]; then
    fail "production already runs $target"
  elif [ "$(printf '%s\n%s\n' "$current_version" "$target_version" | sort -V | head -1)" != "$current_version" ]; then
    fail "$target_version is older than $current_version; going back is ops/restore.sh, never an upgrade"
  else
    pass "$current_version -> $target_version moves forward"
  fi
  if docker image inspect "$target" >/dev/null 2>&1; then
    upstream=$(docker image inspect --format '{{index .Config.Labels "platform-twenty.upstream"}}' "$target")
    pass "$target is on this server${upstream:+ (built from $upstream)}"
  else
    fail "$target is not on this server; our images are built here, there is no registry to pull from"
  fi
  release=${target##*:}
  tag_command=$([ "$(status_value candidate)" != "$target" ] || status_value sourceTag)
  if [ -z "$target_version" ] || [ "$release" = latest ]; then
    :
  elif ! tags=$(timeout 20 git -C "$PLATFORM_DIR" ls-remote --tags origin "refs/tags/$release" 2>/dev/null); then
    warn "could not reach origin to check that the source tag $release is pushed"
  elif [ -n "$tags" ]; then
    pass "source tag $release is pushed"
  else
    warn "source tag $release is not pushed, so the app's About link to the running source breaks (AGPL, UPDATES.md): ${tag_command:-tag the commit the image was built from and push it}"
  fi
fi

section 'Rehearsals'
verdict=$(status_value verdict)
checked=$(status_value checkedAt)
logs=$(status_value logs)
if [ -z "$verdict" ]; then
  fail "no update check has run yet ($status_file); run $OPS_DIR/auto-update.sh"
elif [ "$verdict" != ready ]; then
  fail "the verdict of $checked is $verdict: $(status_value detail)"
elif [ "$(status_value candidate)" != "$target" ]; then
  fail "the rehearsed image is $(status_value candidate), not $target"
elif [ "$(status_value production)" != "$current" ]; then
  fail "the rehearsals started from $(status_value production), but production runs $current; run $OPS_DIR/auto-update.sh again"
else
  age=$(seconds_since "$checked")
  if [ "$age" -ge $((max_rehearsal_days * 86400)) ]; then
    fail "the rehearsals finished $(ago "$age") ago (limit $max_rehearsal_days days); run $OPS_DIR/auto-update.sh again (about an hour)"
  else
    pass "verdict ready on $checked, $(ago "$age") ago"
  fi
  rehearsed_backup=$(awk -v prefix="OK $target on " 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1) }' \
    "$logs/data-rehearsal.log" 2>/dev/null || true)
  if [ -n "$rehearsed_backup" ] && grep -qxF "OK $target" "$logs/app-rehearsal.log" 2>/dev/null; then
    pass "data rehearsal on a copy of $rehearsed_backup and app rehearsal passed (logs in $logs)"
  else
    fail "the stage logs in ${logs:-?} do not show both rehearsals passing for $target"
  fi
fi

section 'Fresh backup'
backup=$(resolve_backup latest)
if [ -z "$backup" ]; then
  fail "no backup in $BACKUP_DIR. Take one (the CRM stays up), then run this check again: $OPS_DIR/backup.sh manual"
else
  age=$(seconds_since "$(manifest_value "$backup" createdAt)")
  if [ "$age" -gt $((max_backup_minutes * 60)) ]; then
    fail "the newest backup is $(ago "$age") old ($backup). Take one (about a minute, the CRM stays up), then run this check again: $OPS_DIR/backup.sh manual"
  else
    pass "$backup, taken $(ago "$age") ago"
  fi
  # backup.sh renames a backup into place only after verify-backup.sh passed, so matching checksums mean the same bytes.
  if (cd "$backup" && sha256sum --quiet -c SHA256SUMS >/dev/null 2>&1); then
    pass "checksums match the copy verify-backup.sh accepted when it was taken"
  else
    fail "checksum mismatch in $backup"
  fi
  if [ "$(manifest_value "$backup" image)" = "$current" ]; then
    pass "taken on $current, the image production runs"
  else
    fail "taken on $(manifest_value "$backup" image), but production runs $current"
  fi
  if [ "$(manifest_value "$backup" encryptionKeyFingerprint)" = "$(key_fingerprint)" ]; then
    pass "taken with the ENCRYPTION_KEY in deploy/.env"
  else
    fail "taken with another ENCRYPTION_KEY; restore.sh would refuse it"
  fi
fi
current_id=$(docker image inspect --format '{{.Id}}' "$current" 2>/dev/null || true)
backup_id=$([ -z "$backup" ] || manifest_value "$backup" imageId)
if [ -z "$current_id" ]; then
  fail "$current is not on this server; a rollback restarts it, so it must stay (UPDATES.md rule 8)"
elif [ -n "$backup_id" ] && [ "$backup_id" != null ] && [ "$backup_id" != "$current_id" ]; then
  fail "the local $current is not the image the backup was taken with ($backup_id); restore.sh would refuse it"
else
  pass "$current stays on this server for a rollback"
fi

section 'Off-site copy'
if [ -z "${BACKUP_OFFSITE_COMMAND:-}" ]; then
  warn "NO OFF-SITE COPY. BACKUP_OFFSITE_COMMAND is empty in $DEPLOY_DIR/ops.env, so every backup, the one upgrade.sh takes included, is on this server's disk only (launch-readiness B2)"
elif [ -n "$backup" ]; then
  label=$(manifest_value "$backup" label)
  offsite=$(awk -v done_line=": done $backup (" -v copied="backup $label: copied offsite" -v failed="offsite copy failed for $backup" '
    !seen { if (index($0, done_line)) seen = 1; next }
    index($0, copied) { result = "copied"; exit }
    index($0, failed) { result = "failed"; exit }
    index($0, ": starting (") { exit }
    END { print result }' "$STATE_DIR/history.log")
  case $offsite in
    copied) pass "$backup was copied off-site" ;;
    failed) warn "THE OFF-SITE COPY OF $backup FAILED; the only copy is on this disk (see $STATE_DIR/history.log)" ;;
    *) warn "NO RECORD THAT $backup REACHED THE OFF-SITE STORE (see $STATE_DIR/history.log)" ;;
  esac
fi

section 'Disk'
image_bytes=$(docker image inspect --format '{{.Size}}' "$target" 2>/dev/null ||
  docker image inspect --format '{{.Size}}' "$current" 2>/dev/null || echo 0)
backup_bytes=0
[ -z "$backup" ] || backup_bytes=$(du -sb "$backup" | cut -f1)
db_volume=$(compose config --format json 2>/dev/null | jq -r '.volumes["db-data"].name // empty')
db_bytes=$(du -sb "$(docker volume inspect --format '{{.Mountpoint}}' "$db_volume" 2>/dev/null)" 2>/dev/null | cut -f1 || true)
# upgrade.sh wants twice the database free; a rollback takes a before-restore backup on top of the pre-upgrade one.
one_backup=$((backup_bytes > ${db_bytes:-0} ? backup_bytes : ${db_bytes:-0}))
docker_root=$(docker info --format '{{.DockerRootDir}}')
free_bytes() { echo $(($(df --output=avail -k "$1" | tail -1) * 1024)); }
need_text="two backups of up to $(size "$one_backup") (the pre-upgrade one and the one a rollback takes first)"
if [ "$(stat -c %d "$BACKUP_DIR")" = "$(stat -c %d "$docker_root")" ]; then
  free=$(free_bytes "$BACKUP_DIR")
  need=$((2 * one_backup + image_bytes))
  if [ "$free" -gt "$need" ]; then
    pass "$(size "$free") free for backups and Docker; needs $(size "$need"): $need_text plus $(size "$image_bytes"), the image's size"
  else
    fail "only $(size "$free") free for backups and Docker; needs $(size "$need"): $need_text plus $(size "$image_bytes"), the image's size"
  fi
else
  free=$(free_bytes "$BACKUP_DIR")
  if [ "$free" -gt $((2 * one_backup)) ]; then
    pass "$(size "$free") free in $BACKUP_DIR for $need_text"
  else
    fail "only $(size "$free") free in $BACKUP_DIR; needs $need_text"
  fi
  free=$(free_bytes "$docker_root")
  if [ "$free" -gt "$image_bytes" ]; then
    pass "$(size "$free") free in $docker_root, more than the image's $(size "$image_bytes")"
  else
    fail "only $(size "$free") free in $docker_root; keep at least the image's $(size "$image_bytes")"
  fi
fi

section 'Nothing else running'
running=0
if locks=$(lslocks -n -r -o PATH 2>/dev/null); then
  for entry in "$STATE_DIR/ops.lock|a backup, upgrade or restore" "$STATE_DIR/update.lock|the weekly update check" \
    "$STATE_DIR/rehearsal.lock|a rehearsal" "${UPDATE_WORK_DIR:-/var/lib/inventivecrm-update}/build.lock|an image build"; do
    if grep -qxF "${entry%%|*}" <<<"$locks"; then
      fail "${entry#*|} is running (${entry%%|*} is locked)"
      running=1
    fi
  done
else
  warn "could not list file locks (lslocks), so a running backup, update check or rehearsal would go unseen"
fi
# Shells are skipped: one that merely mentions a command would match, and the command it starts is listed on its own.
commands=$(pgrep -af 'twenty(@[^ ]*)? app (install|uninstall|publish|apply|dev)( |$)|(provision-workspace|set-app-variables|apply-setup-spec)\.mjs' |
  grep -vE '^[0-9]+ ([^ ]*/)?(ba|da|z)?sh ' || true)
if [ -n "$commands" ]; then
  fail "app or workspace commands are running on this server:"
  while read -r line; do note "$line"; done <<<"$commands"
  running=1
fi
if [ "$running" = 0 ]; then
  pass "no backup, upgrade, restore, update check, rehearsal, build, app install or workspace script is running here"
  note "an app command run from another computer cannot be seen from here"
fi
server_image=$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q server 2>/dev/null)" 2>/dev/null || true)
if [ "$server_image" = "$current" ]; then
  pass "the server container runs $current, as deploy/.env says"
else
  fail "the server container runs ${server_image:-nothing}, but deploy/.env says $current; finish the last upgrade or restore first"
fi

section 'Smoke test'
shopt -s nullglob
smoke_keys=("${SMOKE_KEYS_DIR:-/nonexistent}"/*.key)
shopt -u nullglob
if smoke=$("$OPS_DIR/smoke-test.sh" 2>&1); then
  if [ ${#smoke_keys[@]} -gt 0 ]; then
    pass "smoke test passed: health, web app and ${#smoke_keys[@]} canary workspace key(s)"
  else
    pass "smoke test passed: health and web app"
    warn "SMOKE_KEYS_DIR holds no key, so this smoke test and the one upgrade.sh runs never check that a workspace can read its records"
  fi
else
  fail "smoke test failed: $(tail -1 <<<"$smoke")"
fi

section 'Versions and the way back'
note "production now  $current (Twenty $current_version)"
note "upgrade to      ${target:-none} (Twenty ${target_version:-?})"
note "automatic       upgrade.sh restores its own pre-upgrade backup if the server is not healthy within ${UPGRADE_TIMEOUT:-1200}s,"
note "                a workspace fails to migrate or the smoke test fails"
note "by hand, later  $OPS_DIR/restore.sh latest-pre-upgrade"
note "                (work done since the upgrade is then only in the before-restore backup it takes first)"

section 'Verdict'
if [ "$failures" -gt 0 ]; then
  printf 'NO-GO: %d check(s) failed. Fix them and run this check again.\n' "$failures"
else
  printf 'GO%s\n' "${warnings[*]:+, with ${#warnings[@]} warning(s) to read first}"
fi
for warning in "${warnings[@]}"; do printf '  WARN %s\n' "$warning"; done
[ "$failures" -eq 0 ] || exit 1
printf 'In the maintenance window: %s\n' "$OPS_DIR/upgrade.sh $target"
