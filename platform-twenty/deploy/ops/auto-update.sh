#!/usr/bin/env bash
# Usage: ops/auto-update.sh [--status]
# Weekly from cron. When Twenty has a newer release than production runs, this rebrands it, builds the image here,
# rehearses the upgrade on a copy of the newest backup and on a copy of the test stack, and records the verdict in
# state/update-status.json. It never upgrades production: that stays ops/upgrade.sh, run by a person.
. "$(dirname "$0")/lib.sh"

status_file="$STATE_DIR/update-status.json"
if [ "${1:-}" = --status ]; then
  [ -f "$status_file" ] || die "no update check has run yet"
  jq -r '"\(.checkedAt) \(.verdict): \(.detail)", (.sourceTag // empty | "First, so the source link in the app works: \(.)"),
    (.next // empty | "Then: \(.)")' "$status_file"
  exit
fi

exec 7>"$STATE_DIR/update.lock"
flock -n 7 || die "another update check is running"

work=${UPDATE_WORK_DIR:-/var/lib/inventivecrm-update}
logs="$work/logs/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$logs"
find "$work/logs" -mindepth 1 -maxdepth 1 -type d -mtime +60 -exec rm -rf {} +
production=$(env_value IMAGE)
latest=
candidate=

finish() {
  local verdict=$1 detail=$2 next=${3:-} source_tag=${4:-}
  trap - EXIT
  jq -n --arg checkedAt "$(date -u +%FT%TZ)" --arg verdict "$verdict" --arg detail "$detail" --arg production "$production" \
    --arg latestRelease "$latest" --arg candidate "$candidate" --arg sourceTag "$source_tag" --arg next "$next" --arg logs "$logs" \
    '$ARGS.named | with_entries(select(.value != ""))' >"$status_file.new"
  mv "$status_file.new" "$status_file"
  log "update: $verdict: $detail"
  [ "$verdict" != not-ready ] || exit 1
  exit 0
}
trap 'finish not-ready "the update check stopped unexpectedly; see $logs"' EXIT

# Each stage is its own script, so it stops at its first error; its output is kept in the run's log folder.
stage() {
  local name=$1
  shift
  log "update: $name"
  "$@" >"$logs/$name.log" 2>&1 && return
  finish not-ready "$name failed: $(grep -v '^[[:space:]]*$' "$logs/$name.log" | tail -1 | cut -c1-400)"
}

latest=$(git ls-remote --tags --refs https://github.com/twentyhq/twenty 'refs/tags/twenty/v*' | sed 's#.*refs/tags/##' |
  grep -E '^twenty/v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1) || true
[ -n "$latest" ] || finish not-ready "could not read Twenty's release tags"
version=${latest#twenty/v}
current=$(version_of "$production")
if [ "$version" = "$current" ] || [ "$(printf '%s\n%s\n' "$current" "$version" | sort -V | tail -1)" != "$version" ]; then
  finish up-to-date "production runs $current and Twenty's newest release is $version"
fi

# The About text links to the tag X.Y.Z-pN for the image's source, so the image has to match a commit.
revision=$(branding_revision)
[[ $revision != *-dirty ]] || finish not-ready "branding/ has uncommitted changes; commit them, so the image matches a commit its source tag can point at"

repository=${production%:*}
newest=$(docker image ls --format '{{.Tag}}' "$repository" | grep -E "^${version//./\\.}-p[0-9]+$" | sort -V | tail -1 || true)
candidate="$repository:$newest"
if [ -z "$newest" ] || [ "$(docker image inspect --format '{{index .Config.Labels "platform-twenty.branding"}}' "$candidate")" != "$revision" ]; then
  candidate="$repository:$version-p$((${newest##*-p} + 1))"
  stage build "$OPS_DIR/build-image.sh" "$latest" "$candidate"
fi
stage data-rehearsal "$OPS_DIR/rehearse-data.sh" "$candidate"
[ -n "${TEST_STACK_DIR:-}" ] || finish not-ready "$candidate kept every row on a copy of the newest backup, but no test stack is set (TEST_STACK_DIR), so our apps were not tried on it"
stage app-rehearsal "$OPS_DIR/rehearse-apps.sh" "$candidate"

# A candidate is 1.7 GB. Only images built here are removed, never one production, the test stack or a backup names;
# when that list cannot be read in full, nothing is removed.
if keep=$(printf '%s\n' "$production" "$candidate" && jq -r .image "$BACKUP_DIR"/*/manifest.json && grep -E '^IMAGE=' "$TEST_STACK_DIR/.env" | cut -d= -f2-); then
  docker image ls --filter label=platform-twenty.branding --format '{{.Repository}}:{{.Tag}}' | while read -r old; do
    grep -qxF "$old" <<<"$keep" || docker image rm "$old" >/dev/null 2>&1 || true
  done
fi

release=${candidate##*:}
finish ready "$candidate passed both rehearsals: a copy of the newest backup kept every row and our apps passed their suites on it. Production still runs $production." \
  "$OPS_DIR/upgrade.sh $candidate" "git -C $PLATFORM_DIR tag $release $(git -C "$PLATFORM_DIR" rev-parse HEAD) && git -C $PLATFORM_DIR push origin $release"
