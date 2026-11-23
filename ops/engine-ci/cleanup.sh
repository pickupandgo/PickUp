#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REF:-}" = refs/heads/mr-engine-synthetic-ci-20261123
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
prefix=mr-eng-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
state=$RUNNER_TEMP/$prefix
mkdir -p engine-evidence
test -e engine-evidence/phase.txt || printf 'failed-before-preparation\n' > engine-evidence/phase.txt
failed=0
for pair in unit:unit suite:suite; do
 name=${pair%:*};file=${pair#*:}
 if docker inspect "$prefix-$name" >/dev/null 2>&1; then
  if test "$(docker inspect --format '{{index .Config.Labels "io.multipleride.engine-ci"}}' "$prefix-$name")" != "$prefix"; then
   failed=1;continue
  fi
  if docker exec "$prefix-$name" test -s "/tmp/$file.json" 2>/dev/null; then
   docker exec "$prefix-$name" cat "/tmp/$file.json" | python3 ops/engine-ci/evidence.py sanitize > "engine-evidence/$file.json"
  fi
 fi
done
for suffix in api mock; do
 if docker inspect "$prefix-$suffix" >/dev/null 2>&1; then
  docker logs "$prefix-$suffix" 2>&1 | python3 ops/engine-ci/evidence.py sanitize > "engine-evidence/$suffix.log"
 fi
done
for suffix in helper api mock suite unit migrate-main migrate-suite guard db; do
 name=$prefix-$suffix
 if docker inspect "$name" >/dev/null 2>&1; then
  if test "$(docker inspect --format '{{index .Config.Labels "io.multipleride.engine-ci"}}' "$name")" = "$prefix"; then
   docker rm -f -v "$name" >/dev/null || failed=1
  else failed=1;fi
 fi
done
if docker network inspect "$prefix-net" >/dev/null 2>&1; then
 if test "$(docker network inspect --format '{{index .Labels "io.multipleride.engine-ci"}}' "$prefix-net")" = "$prefix"; then
  docker network rm "$prefix-net" >/dev/null || failed=1
 else failed=1;fi
fi
if test -d "$state"; then
 rm -f -- "$state/api.env" "$state/db.env" "$state/mock.env" "$state/suite.env" "$state/migrate-main.env" "$state/migrate-suite.env" "$state/runtime.sql" "$state/ca.pem"
fi
test -z "$(docker ps -aq --filter "label=io.multipleride.engine-ci=$prefix")" || failed=1
export MR_ENGINE_CLEANUP_FAILED=$failed
python3 - <<'PY'
import json,os,pathlib
ok=os.environ['MR_ENGINE_CLEANUP_FAILED']=='0'
pathlib.Path('engine-evidence/cleanup.json').write_text(json.dumps({'result':'PASS' if ok else 'FAIL','run_containers_and_network_removed':ok,'synthetic_DB_tmpfs_destroyed':ok,'dummy_credentials_and_TLS_private_keys_disposed':ok},indent=2)+'\n')
PY
python3 ops/engine-ci/evidence.py summary
test "$failed" = 0
