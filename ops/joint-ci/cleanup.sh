#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REF:-}" = refs/heads/mr-joint-synthetic-ci-20261123
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
prefix=mr-joint-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
state=$RUNNER_TEMP/$prefix
mkdir -p joint-evidence
failed=0
for suffix in backend engine gateway;do
 if docker inspect "$prefix-$suffix" >/dev/null 2>&1;then
  if test "$(docker inspect --format '{{index .Config.Labels "io.multipleride.joint-ci"}}' "$prefix-$suffix")" = "$prefix";then
   docker logs "$prefix-$suffix" 2>&1 | python3 ops/joint-ci/evidence.py sanitize > "joint-evidence/$suffix.log"
  else failed=1;fi
 fi
done
for suffix in helper seed backend engine gateway core backguard db;do
 if docker inspect "$prefix-$suffix" >/dev/null 2>&1;then
  if test "$(docker inspect --format '{{index .Config.Labels "io.multipleride.joint-ci"}}' "$prefix-$suffix")" = "$prefix";then
   docker rm -f -v "$prefix-$suffix" >/dev/null || failed=1
  else failed=1;fi
 fi
done
if docker network inspect "$prefix-net" >/dev/null 2>&1;then
 if test "$(docker network inspect --format '{{index .Labels "io.multipleride.joint-ci"}}' "$prefix-net")" = "$prefix";then
  docker network rm "$prefix-net" >/dev/null || failed=1
 else failed=1;fi
fi
if test -d "$state";then
 rm -f -- "$state/db.env" "$state/backend.env" "$state/engine.env" "$state/gateway.env" "$state/seed.env" "$state/dummy.json" "$state/roles.sql" "$state/ca.pem" "$state/state.json"
fi
test -z "$(docker ps -aq --filter "label=io.multipleride.joint-ci=$prefix")" || failed=1
export MR_JOINT_CLEANUP_FAILED=$failed
python3 - <<'PY'
import json,os,pathlib
ok=os.environ['MR_JOINT_CLEANUP_FAILED']=='0'
pathlib.Path('joint-evidence/cleanup.json').write_text(json.dumps({'result':'PASS' if ok else 'FAIL','containers_and_network_removed':ok,'synthetic_database_tmpfs_destroyed':ok,'dummy_credentials_and_TLS_private_keys_disposed':ok},indent=2)+'\n')
PY
python3 ops/joint-ci/evidence.py summary
test "$failed" = 0
