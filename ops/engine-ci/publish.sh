#!/usr/bin/env bash
set -euo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "$GITHUB_REPOSITORY" = pickupandgo/PickUp
test "$GITHUB_REF" = refs/heads/mr-engine-synthetic-ci-20261123
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
mkdir -p engine-publish
python3 - <<'PY'
import hashlib,json,os,pathlib
p=pathlib.Path('engine-tested-image');d=json.loads((p/'image.json').read_text())
assert d['source_revision']==os.environ['GITHUB_SHA'] and d['tests_passed'] and not d['rebuilt_after_test']
assert d['local_tag']=='mr-engine-ci:'+os.environ['GITHUB_SHA']
assert hashlib.file_digest((p/'runtime.tar.gz').open('rb'),'sha256').hexdigest()==d['tar_sha256']
PY
gzip -dc engine-tested-image/runtime.tar.gz | docker load
local=mr-engine-ci:$GITHUB_SHA
expected=$(python3 -c 'import json;print(json.load(open("engine-tested-image/image.json"))["image_id"])')
test "$(docker image inspect --format '{{.Id}}' "$local")" = "$expected"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$local")" = "$GITHUB_SHA"
export DOCKER_CONFIG=$RUNNER_TEMP/engine-publish-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
mkdir -m 700 "$DOCKER_CONFIG"
trap 'docker logout ghcr.io >/dev/null 2>&1 || true; rm -f -- "$DOCKER_CONFIG/config.json" "$DOCKER_CONFIG/manifest.json" "$DOCKER_CONFIG/lookup.err"' EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
unset GHCR_TOKEN
tag=ghcr.io/pickupandgo/mr-trip-engine-lab:sha-$GITHUB_SHA
if docker manifest inspect "$tag" > "$DOCKER_CONFIG/manifest.json" 2> "$DOCKER_CONFIG/lookup.err"; then
 # Never replace an already published commit tag. Reuse only identical content.
 docker pull "$tag"
 test "$(docker image inspect --format '{{.Id}}' "$tag")" = "$expected"
else
 # Unknown auth/network/registry failures are NOT evidence that a tag is absent.
 grep -Eiq 'manifest unknown|MANIFEST_UNKNOWN|no such manifest' "$DOCKER_CONFIG/lookup.err" || { echo 'REGISTRY_LOOKUP_NOT_PROVEN_ABSENT'; exit 1; }
 docker tag "$local" "$tag"
 docker push "$tag" | tee engine-publish/push.log
 docker pull "$tag"
 test "$(docker image inspect --format '{{.Id}}' "$tag")" = "$expected"
fi
export MR_PUBLISHED_TAG=$tag MR_EXPECTED_IMAGE_ID=$expected
python3 - <<'PY'
import json,os,pathlib,subprocess
t=os.environ['MR_PUBLISHED_TAG'];i=json.loads(subprocess.check_output(['docker','image','inspect',t],text=True))[0]
refs=[r for r in i['RepoDigests'] if r.startswith('ghcr.io/pickupandgo/mr-trip-engine-lab@sha256:')];assert len(refs)==1
assert i['Id']==os.environ['MR_EXPECTED_IMAGE_ID']
d={'result':'PASS','source_revision':os.environ['GITHUB_SHA'],'tag':t,'immutable_image':refs[0],
 'digest':refs[0].split('@')[1],'tested_image_id':i['Id'],'published_image_matches_tested_image':True,
 'run_url':f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
 'production_deployed':False}
pathlib.Path('engine-publish/result.json').write_text(json.dumps(d,indent=2)+'\n')
with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:f.write('Engine synthetic integration passed.\n\n`'+refs[0]+'`\n\nNo deployment was performed.\n')
print(json.dumps(d,indent=2))
PY
