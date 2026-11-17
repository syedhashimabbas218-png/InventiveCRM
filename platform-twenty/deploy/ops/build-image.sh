#!/usr/bin/env bash
# Usage: ops/build-image.sh <twenty/vX.Y.Z> <image:tag>
# Rebrands a throwaway checkout of that Twenty release and builds our image from it on this server. The build runs
# in its own builder with capped memory, so it cannot push the running CRM out of memory.
. "$(dirname "$0")/lib.sh"

tag=${1:?upstream tag, e.g. twenty/v2.56.0}
image=${2:?image to build, e.g. platform-twenty:2.56.0-p1}
[[ $tag =~ ^twenty/v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "$tag is not a Twenty release tag"
version=${tag#twenty/v}
release=${image##*:}
[[ $image == *:* && $release == "$version"-p* ]] || die "the tag of $image must be $version-pN"

work=${UPDATE_WORK_DIR:-/var/lib/inventivecrm-update}
[[ $work == /*/* ]] || die "UPDATE_WORK_DIR must be an absolute path below the root folder"
source="$work/source"
builder=inventivecrm-update
buildkit=moby/buildkit:v0.34.2@sha256:c5f8862f52499773af85bc07695b2379ef08e8002352b0df2c4864c91d78dabe
free_gb=$(($(df --output=avail -k "$(docker info --format '{{.DockerRootDir}}')" | tail -1) / 1024 / 1024))
[ "$free_gb" -ge "${UPDATE_MIN_FREE_GB:-20}" ] || die "only $free_gb GB of disk is free; a build needs ${UPDATE_MIN_FREE_GB:-20}"

mkdir -p "$work"
exec 9>"$work/build.lock"
flock -n 9 || die "another image build is running"
log "build: $image from $tag"
rm -rf "$source"
git clone --quiet --depth 1 --branch "$tag" https://github.com/twentyhq/twenty "$source"
commit=$(git -C "$source" rev-parse HEAD)

branding=(--upstream "$source" --config "$PLATFORM_DIR/branding/brand.config.json")
node "$PLATFORM_DIR/branding/apply.mjs" "${branding[@]}" || die "our branding no longer fits $tag; fix branding/ (UPDATES.md)"
node "$PLATFORM_DIR/branding/apply.mjs" "${branding[@]}" --write --version "$release" --report "$work/rebrand-report-$release.json"
node "$PLATFORM_DIR/branding/leak-scan.mjs" "${branding[@]}" || die "after rebranding, $tag would still show Twenty's name, links or logo"

# Twenty's translation step gives its worker threads 10 s to start, too little on a server that is also running the
# CRM. The threads library reads this setting; it is added to the two build stages only, never to the image.
dockerfile="$source/packages/twenty-docker/twenty/Dockerfile"
for stage in twenty-server-build twenty-front-build; do
  grep -qE "^FROM [^ ]+ AS $stage\$" "$dockerfile" || die "Twenty's Dockerfile has no $stage stage any more; update build-image.sh"
  sed -i -E "s#^(FROM [^ ]+ AS $stage)\$#\1\nENV THREADS_WORKER_INIT_TIMEOUT=120000#" "$dockerfile"
done

# Steps run one at a time to stay within the memory cap, and a failed build gets one more try from the steps done.
printf '[worker.oci]\n  max-parallelism = 1\n' >"$work/buildkitd.toml"
docker buildx rm "$builder" >/dev/null 2>&1 || true
trap 'docker buildx rm "$builder" >/dev/null 2>&1 || true; rm -rf "$source"' EXIT
docker buildx create --name "$builder" --driver docker-container --driver-opt "image=$buildkit" \
  --buildkitd-config "$work/buildkitd.toml" \
  --driver-opt "memory=${UPDATE_BUILD_MEMORY:-6g}" --driver-opt "memory-swap=${UPDATE_BUILD_MEMORY_SWAP:-14g}" >/dev/null
build() {
  timeout "${UPDATE_BUILD_TIMEOUT:-3h}" docker buildx build --builder "$builder" --load --provenance=false --progress plain \
    --file "$source/packages/twenty-docker/twenty/Dockerfile" --target twenty --build-arg "APP_VERSION=$version" \
    --label "platform-twenty.upstream=$tag@$commit" --label "platform-twenty.branding=$(branding_revision)" \
    --tag "$image" "$source"
}
build || { log "build: failed once, trying again"; build; } || die "the image build failed"

log "build: done $image ($(docker image inspect --format '{{.Id}}' "$image" | cut -c8-19))"
