#!/usr/bin/env bash
# Checks every app the way a release does: locked install, typecheck (tests included) and unit tests.
# Usage: scripts/check-apps.sh [app ...]   (default: every app under apps/)
set -uo pipefail

cd "$(dirname "$0")/../apps"
apps=("$@")
[ ${#apps[@]} -eq 0 ] && apps=(*/)
failed=()

for app in "${apps[@]}"; do
  app=${app%/}
  echo "== $app"
  for step in "install --immutable" typecheck test; do
    # shellcheck disable=SC2086
    if ! output=$(cd "$app" && yarn $step 2>&1); then
      echo "$output" | tail -40
      failed+=("$app: yarn $step")
      break
    fi
    [ "$step" = test ] && echo "$output" | grep -E '^ +Tests ' | sed 's/^ */   /'
  done
done

# These apps carry the same request helper; a fix made in one copy has to reach the others.
shared=(campaigns feedback scheduling team-chat)
for app in "${shared[@]:1}"; do
  cmp -s "${shared[0]}/src/lib/api.ts" "$app/src/lib/api.ts" || failed+=("$app: src/lib/api.ts differs from ${shared[0]}")
done

echo
if [ ${#failed[@]} -gt 0 ]; then
  printf 'FAILED %s\n' "${failed[@]}"
  exit 1
fi
echo "All apps passed."
