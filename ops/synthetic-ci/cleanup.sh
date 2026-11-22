#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REF:-}" = refs/heads/mr-aws-rds-lab-20261121
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
prefix=mr-synth-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
state=$RUNNER_TEMP/mr-synthetic-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
mkdir -p synthetic-evidence
if docker container inspect "$prefix-api" >/dev/null 2>&1; then
 docker logs "$prefix-api" 2>&1 | python3 ops/synthetic-ci/evidence.py sanitize > synthetic-evidence/api-startup.log
fi
cleanup_failed=0
for suffix in tester config closed pg-id api guard db; do
 name=$prefix-$suffix
 if docker container inspect "$name" >/dev/null 2>&1; then
  if test "$(docker inspect --format '{{index .Config.Labels "io.multipleride.synthetic-run"}}' "$name")" != "$prefix"; then
   cleanup_failed=1;continue
  fi
  docker rm -f -v "$name" >/dev/null || cleanup_failed=1
 fi
done
if docker network inspect "$prefix-net" >/dev/null 2>&1; then
 if test "$(docker network inspect --format '{{index .Labels "io.multipleride.synthetic-run"}}' "$prefix-net")" = "$prefix"; then
  docker network rm "$prefix-net" >/dev/null || cleanup_failed=1
 else cleanup_failed=1;fi
fi
# Credentials were dummy/generated on this disposable runner; delete exact files.
rm -f -- "$state/api.env" "$state/db.env" "$state/synthetic-secrets.json"
remaining=$(docker ps -aq --filter "label=io.multipleride.synthetic-run=$prefix")
test -z "$remaining" || cleanup_failed=1
export MR_CI_CLEANUP_FAILED=$cleanup_failed
python3 - <<'PY'
import json,os,pathlib
e={'result':'PASS' if os.environ['MR_CI_CLEANUP_FAILED']=='0' else 'FAIL',
 'task_containers_and_internal_network_removed':os.environ['MR_CI_CLEANUP_FAILED']=='0',
 'dummy_credential_files_removed':True,'database_data_was_tmpfs':True}
pathlib.Path('synthetic-evidence/cleanup.json').write_text(json.dumps(e,indent=2)+'\n')
PY
python3 ops/synthetic-ci/evidence.py finish
test "$cleanup_failed" = 0
