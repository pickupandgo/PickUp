#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REF:-}" = refs/heads/mr-backend-migrator-ci-20261123
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
p=mr-migrator-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT;s=$RUNNER_TEMP/$p;failed=0
mkdir -p migrator-evidence
if docker inspect "$p-db" >/dev/null 2>&1;then docker logs "$p-db" 2>&1 | python3 ops/migrator-ci/sanitize.py "$s/password" > migrator-evidence/postgres.log;fi
for suffix in helper upgrade fresh rerun db;do
 if docker inspect "$p-$suffix" >/dev/null 2>&1;then
  if test "$(docker inspect --format '{{index .Config.Labels "io.multipleride.migrator-ci"}}' "$p-$suffix")" = "$p";then docker rm -f -v "$p-$suffix" >/dev/null || failed=1;else failed=1;fi
 fi
done
if docker network inspect "$p-net" >/dev/null 2>&1;then
 if test "$(docker network inspect --format '{{index .Labels "io.multipleride.migrator-ci"}}' "$p-net")" = "$p";then docker network rm "$p-net" >/dev/null || failed=1;else failed=1;fi
fi
rm -f -- "$s/upgrade.env" "$s/fresh.env" "$s/db.env" "$s/password" "$s/tls/server.key" "$s/tls/bad.key"
test -z "$(docker ps -aq --filter "label=io.multipleride.migrator-ci=$p")" || failed=1
export MR_MIG_CLEANUP_FAILED=$failed
python3 - <<'PY'
import json,os,pathlib
p=pathlib.Path('migrator-evidence');phase=(p/'phase.txt').read_text().strip() if (p/'phase.txt').exists() else 'not-started'
ok=os.environ['MR_MIG_CLEANUP_FAILED']=='0'
r={'result':'PASS' if ok and phase=='all-tests-passed' else 'FAIL','workflow_sha':os.environ['GITHUB_SHA'],'source_commit':'abcd1034116c493e73b660d77552d9c21a4caab3','run_url':'https://github.com/pickupandgo/PickUp/actions/runs/'+os.environ['GITHUB_RUN_ID'],'phase':phase,'cleanup':'PASS' if ok else 'FAIL','synthetic_DB_tmpfs_and_private_credentials_removed':ok,'AWS_Render_connections':False,'API_started':False,'runtime_image_changed':False}
for n in ['image-inventory-check','validation','TLS','triggers','ACL']:
 try:r[n]=json.loads((p/(n+'.json')).read_text())
 except (FileNotFoundError,json.JSONDecodeError):r[n]=None
(p/'summary.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
PY
test "$failed" = 0
