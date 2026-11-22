#!/usr/bin/env bash
set -euo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REPOSITORY:-}" = pickupandgo/PickUp
test "${GITHUB_REF:-}" = refs/heads/mr-engine-synthetic-ci-20261123
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ && "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
prefix=mr-eng-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
state=$RUNNER_TEMP/$prefix
scripts=$GITHUB_WORKSPACE/ops/engine-ci
out=$GITHUB_WORKSPACE/engine-evidence
image=mr-engine-ci:$GITHUB_SHA
tools=mr-engine-tools:$GITHUB_SHA
postgres=postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139
mkdir -m 700 "$state"
mkdir -p "$out" engine-tested-image
phase(){ printf '%s\n' "$1" > "$out/phase.txt"; }
phase source-and-build
git merge-base --is-ancestor f06c51797103eb78f173560f540a6d0e623adc22 HEAD
git diff --exit-code f06c51797103eb78f173560f540a6d0e623adc22 -- package.json package-lock.json prisma
test -z "$(git ls-files .env '.env.*' | grep -vFx .env.example || true)"
export DOCKER_CONFIG=$state/docker-config
mkdir -m 700 "$DOCKER_CONFIG"
docker build --target tooling --build-arg SOURCE_REVISION="$GITHUB_SHA" -t "$tools" .
docker build --target runtime --build-arg SOURCE_REVISION="$GITHUB_SHA" -t "$image" .
docker pull "$postgres"
test "$(docker image inspect --format '{{.Config.User}}' "$image")" = node
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = linux/amd64
test "$(docker image inspect --format '{{json .Config.Cmd}}' "$image")" = '["node","dist/main.js"]'
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$GITHUB_SHA"
docker run --rm --network none --read-only --memory 128m --memory-swap 128m --pids-limit 32 --cap-drop ALL --security-opt no-new-privileges \
 --entrypoint node "$image" -e "const f=require('node:fs');for(const p of ['/app/.env','/app/.env.example','/app/.git','/app/test','/app/node_modules/prisma','/app/node_modules/@nestjs/cli'])if(f.existsSync(p))throw Error('UNEXPECTED_RUNTIME_CONTENT');console.log('RUNTIME_CONTENT_PASS')"
phase unit-and-typecheck
docker run --name "$prefix-unit" --label io.multipleride.engine-ci="$prefix" --network none --read-only \
 --memory 1536m --memory-swap 1536m --cpus 2 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges \
 --tmpfs /tmp:rw,nosuid,nodev,size=536870912,mode=1777 --entrypoint sh "$tools" -ec '
 node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false
 node node_modules/jest/bin/jest.js --runInBand --json --outputFile=/tmp/unit.json
 ' 2>&1 | python3 "$scripts/evidence.py" sanitize | tee "$out/unit.log"
docker cp "$prefix-unit:/tmp/unit.json" "$out/unit.raw.json"
python3 "$scripts/evidence.py" sanitize < "$out/unit.raw.json" > "$out/unit.json"
rm "$out/unit.raw.json"
phase internal-network
python3 - <<'PY'
import ipaddress,json,subprocess
c=ipaddress.ip_network('172.29.63.0/28');ids=subprocess.check_output(['docker','network','ls','-q'],text=True).split()
for n in json.loads(subprocess.check_output(['docker','network','inspect',*ids],text=True)) if ids else []:
 for v in n['IPAM'].get('Config') or []:
  if 'Subnet' in v and ':' not in v['Subnet']:assert not c.overlaps(ipaddress.ip_network(v['Subnet']))
PY
docker network create --internal --subnet 172.29.63.0/28 --gateway 172.29.63.1 --opt com.docker.network.bridge.name=mrengine63 \
 --label io.multipleride.engine-ci="$prefix" "$prefix-net"
test "$(docker network inspect --format '{{.Internal}}' "$prefix-net")" = true
test "$(docker network inspect --format '{{.EnableIPv6}}' "$prefix-net")" = false
export MR_ENGINE_STATE=$state
python3 - <<'PY'
import os,pathlib,secrets
p=pathlib.Path(os.environ['MR_ENGINE_STATE']);pw='dummy_engine_ci_'+secrets.token_hex(16);key='dummy_engine_ci_'+secrets.token_hex(20)
def save(n,values):
 (p/n).write_text(''.join(f'{k}={v}\n' for k,v in values.items()))
save('db.env',{'POSTGRES_USER':'ci_owner','POSTGRES_PASSWORD':pw,'POSTGRES_DB':'mr_engine_synthetic_test'})
save('mock.env',{'CI_INTERNAL_KEY':key})
save('api.env',{'NODE_ENV':'production','PORT':'3000','MR_SYNTHETIC_ONLY':'true',
 'DATABASE_URL':f'postgresql://engine_ci_runtime:{pw}@172.29.63.2:5432/mr_engine_synthetic_test','DATABASE_POOL_MAX':'3',
 'AUTH_JWKS_URL':'https://127.0.0.1:3443/jwks','AUTH_ISSUER':'https://engine-ci.invalid','AUTH_AUDIENCE':'mr-engine-ci',
 'PAYMENT_BACKEND_URL':'https://127.0.0.1:3443','PAYMENT_BACKEND_INTERNAL_API_KEY':key,
 'PAYMENT_BACKEND_TIMEOUT_MS':'1000','OUTBOX_POLL_INTERVAL_MS':'0','DISPATCH_POLL_INTERVAL_MS':'0',
 'NODE_EXTRA_CA_CERTS':'/ci-ca.pem','NODE_OPTIONS':'--max-old-space-size=256'})
for name,db in [('migrate-main.env','mr_engine_synthetic_test'),('migrate-suite.env','mr_engine_suite_test')]:
 save(name,{'DATABASE_URL':f'postgresql://ci_owner:{pw}@172.29.63.2:5432/{db}','CHECKPOINT_DISABLE':'1','PRISMA_HIDE_UPDATE_MESSAGE':'true','HOME':'/tmp'})
save('suite.env',{'ENGINE_TEST_DATABASE_URL':f'postgresql://ci_owner:{pw}@172.29.63.2:5432/mr_engine_suite_test','NODE_ENV':'test'})
# Only this NEW ephemeral DB role, generated dummy password, never an RDS role.
(p/'runtime.sql').write_text(f"CREATE ROLE engine_ci_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{pw}';\nGRANT CONNECT ON DATABASE mr_engine_synthetic_test TO engine_ci_runtime;\nGRANT USAGE ON SCHEMA public TO engine_ci_runtime;\nGRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO engine_ci_runtime;\nGRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO engine_ci_runtime;\n")
PY
test "$(docker run --rm --network none --entrypoint id "$postgres" -u postgres)" = 70
docker run -d --name "$prefix-db" --label io.multipleride.engine-ci="$prefix" --network "$prefix-net" --ip 172.29.63.2 \
 --user postgres --read-only --memory 512m --memory-swap 512m --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges \
 --env-file "$state/db.env" --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=536870912,uid=70,gid=70,mode=700 \
 --tmpfs /var/run/postgresql:rw,noexec,nosuid,nodev,size=8388608,uid=70,gid=70,mode=775 \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777 "$postgres" \
 -c shared_buffers=64MB -c max_connections=40 -c max_wal_size=128MB -c min_wal_size=32MB
for i in $(seq 1 50); do if docker exec "$prefix-db" pg_isready -U ci_owner -d mr_engine_synthetic_test >/dev/null; then break; fi; sleep 1; done
psql(){ docker exec -i "$prefix-db" psql -X -q -v ON_ERROR_STOP=1 -U ci_owner -d mr_engine_synthetic_test "$@"; }
test "$(psql -Atc 'SHOW server_version')" = 16.15
psql -c 'CREATE DATABASE mr_engine_suite_test OWNER ci_owner;'
docker run -d --name "$prefix-guard" --label io.multipleride.engine-ci="$prefix" --network "$prefix-net" --ip 172.29.63.3 \
 --read-only --memory 64m --memory-swap 64m --cpus .2 --pids-limit 32 --cap-drop ALL --security-opt no-new-privileges \
 --entrypoint node "$image" -e 'setInterval(()=>{},60000)'
guardpid=$(docker inspect --format '{{.State.Pid}}' "$prefix-guard")
dbpid=$(docker inspect --format '{{.State.Pid}}' "$prefix-db")
for pid in "$guardpid" "$dbpid"; do
 sudo nsenter -t "$pid" -n iptables -N MR_ENGINE_OUT
 sudo nsenter -t "$pid" -n iptables -A MR_ENGINE_OUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
 if test "$pid" = "$guardpid"; then
  sudo nsenter -t "$pid" -n iptables -A MR_ENGINE_OUT -d 172.29.63.2/32 -p tcp --dport 5432 -j ACCEPT
  sudo nsenter -t "$pid" -n iptables -A MR_ENGINE_OUT -d 127.0.0.1/32 -p tcp -j ACCEPT
 else
  sudo nsenter -t "$pid" -n iptables -A MR_ENGINE_OUT -d 127.0.0.1/32 -p tcp --dport 5432 -j ACCEPT
 fi
 sudo nsenter -t "$pid" -n iptables -A MR_ENGINE_OUT -j DROP
 sudo nsenter -t "$pid" -n iptables -I OUTPUT 1 -j MR_ENGINE_OUT
 sudo nsenter -t "$pid" -n ip6tables -I OUTPUT 1 -j DROP
 sudo nsenter -t "$pid" -n iptables -S OUTPUT | grep -Fx -- '-A OUTPUT -j MR_ENGINE_OUT'
 sudo nsenter -t "$pid" -n ip6tables -S OUTPUT | grep -Fx -- '-A OUTPUT -j DROP'
done
helper(){ docker run --rm --name "$prefix-helper" --label io.multipleride.engine-ci="$prefix" --network "container:$prefix-guard" \
 --read-only --memory 256m --memory-swap 256m --cpus .5 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
 --env-file "$state/api.env" --mount "type=bind,source=$scripts,target=/ci,readonly" \
 --mount "type=bind,source=$state/ca.pem,target=/ci-ca.pem,readonly" --entrypoint node "$image" "$@"; }
# Public synthetic CA placeholder, replaced with fixture CA before any TLS call.
touch "$state/ca.pem";chmod 444 "$state/ca.pem"
helper /ci/network.cjs > "$out/network.json"
helper /ci/config-check.cjs > "$out/configuration.json"
phase actual-Prisma-7-migrations
for target in main suite; do
 docker run --name "$prefix-migrate-$target" --label io.multipleride.engine-ci="$prefix" --network "container:$prefix-guard" \
  --read-only --memory 512m --memory-swap 512m --cpus 1 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=134217728,mode=1777 --env-file "$state/migrate-$target.env" "$tools" \
  2>&1 | python3 "$scripts/evidence.py" sanitize | tee "$out/migrations-$target.log"
done
psql < "$state/runtime.sql"
rm "$state/runtime.sql"
phase existing-synthetic-regression-suite
docker run --name "$prefix-suite" --label io.multipleride.engine-ci="$prefix" --network "container:$prefix-guard" \
 --read-only --memory 1536m --memory-swap 1536m --cpus 2 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges \
 --tmpfs /tmp:rw,nosuid,nodev,size=536870912,mode=1777 --env-file "$state/suite.env" \
 --mount "type=bind,source=$scripts,target=/ci,readonly" --entrypoint node "$tools" \
 node_modules/jest/bin/jest.js --config test/jest-e2e.json --globalSetup /ci/suite-setup.cjs --runInBand --json --outputFile=/tmp/suite.json \
 2>&1 | python3 "$scripts/evidence.py" sanitize | tee "$out/suite.log"
docker cp "$prefix-suite:/tmp/suite.json" "$out/suite.raw.json"
python3 "$scripts/evidence.py" sanitize < "$out/suite.raw.json" > "$out/suite.json"
rm "$out/suite.raw.json"
phase production-mode-runtime-with-HTTPS-mocks
docker run -d --name "$prefix-mock" --label io.multipleride.engine-ci="$prefix" --network "container:$prefix-guard" \
 --read-only --memory 128m --memory-swap 128m --cpus .5 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1777 --env-file "$state/mock.env" \
 --mount "type=bind,source=$scripts,target=/ci,readonly" --entrypoint node "$image" /ci/mock-backend.cjs
for i in $(seq 1 30); do
 if docker exec "$prefix-mock" test -s /tmp/mock-pki/ca.pem; then break; fi;sleep 1
done
rm -f -- "$state/ca.pem"
docker cp "$prefix-mock:/tmp/mock-pki/ca.pem" "$state/ca.pem"
chmod 444 "$state/ca.pem"
docker create --name "$prefix-api" --label io.multipleride.engine-ci="$prefix" --network "container:$prefix-guard" \
 --read-only --memory 384m --memory-swap 384m --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1777 --env-file "$state/api.env" \
 --mount "type=bind,source=$state/ca.pem,target=/ci-ca.pem,readonly" "$image"
export MR_ENGINE_PREFIX=$prefix
python3 - <<'PY'
import json,os,pathlib,subprocess
p=os.environ['MR_ENGINE_PREFIX'];cs=[json.loads(subprocess.check_output(['docker','inspect',p+s],text=True))[0] for s in ['-api','-guard','-db','-mock','-suite','-unit']]
a,g,d,m,s,u=cs;n=json.loads(subprocess.check_output(['docker','network','inspect',p+'-net'],text=True))[0]
assert n['Internal'] and not n['EnableIPv6']
for c in cs:
 h=c['HostConfig'];assert h['ReadonlyRootfs'] and not h['Privileged'] and not h['PortBindings']
 assert h['Memory']>0 and h['MemorySwap']==h['Memory'] and h['NanoCpus']>0 and h['PidsLimit']>0
 assert 'ALL' in h['CapDrop'] and any('no-new-privileges' in v for v in h['SecurityOpt'])
assert a['Config']['User']=='node' and a['Config']['Cmd']==['node','dist/main.js'] and a['Image']==g['Image']==m['Image']
assert a['HostConfig']['NetworkMode'] in ['container:'+g['Id'],'container:'+g['Name'].lstrip('/')]
env=dict(v.split('=',1) for v in a['Config']['Env']);assert env['MR_SYNTHETIC_ONLY']=='true' and env['NODE_ENV']=='production'
assert env['OUTBOX_POLL_INTERVAL_MS']==env['DISPATCH_POLL_INTERVAL_MS']=='0'
assert not any(k.startswith(('AWS_','AZURE_','GITHUB_','ACTIONS_','RAZORPAY_','FCM_')) for k in env)
pathlib.Path('engine-evidence/safety.json').write_text(json.dumps({'result':'PASS','internal_network':True,'no_public_ports':True,'namespace_firewall':True,'resource_limits':True,'nonroot_runtime':True,'readonly_rootfs':True,'capabilities_dropped':True,'exact_default_runtime_command':True,'production_credentials_loaded':False},indent=2)+'\n')
PY
# Negative probes deliberately generated drops; require zero NEW drops in runtime.
sudo nsenter -t "$guardpid" -n iptables -Z MR_ENGINE_OUT
docker start "$prefix-api"
apipid=$(docker inspect --format '{{.State.Pid}}' "$prefix-api")
test "$(sudo readlink "/proc/$apipid/ns/net")" = "$(sudo readlink "/proc/$guardpid/ns/net")"
helper /ci/http-tests.cjs > "$out/http.json"
for i in $(seq 1 35); do
 if test "$(docker inspect --format '{{.State.Health.Status}}' "$prefix-api")" = healthy; then break; fi
 test "$(docker inspect --format '{{.State.Running}}' "$prefix-api")" = true
 sleep 1
done
test "$(docker inspect --format '{{.State.Health.Status}}' "$prefix-api")" = healthy
helper /ci/db-probe.cjs seed > "$out/database-before-idle.json"
sleep 12
test "$(docker inspect --format '{{.State.Running}}' "$prefix-api")" = true
helper /ci/db-probe.cjs snapshot > "$out/database-after-idle.json"
cmp "$out/database-before-idle.json" "$out/database-after-idle.json"
drops=$(sudo nsenter -t "$guardpid" -n iptables -L MR_ENGINE_OUT -n -v -x | awk '$3=="DROP"{print $1}')
test "$drops" = 0
python3 - <<'PY'
import json,pathlib,hashlib
p=pathlib.Path('engine-evidence');d=json.loads((p/'database-after-idle.json').read_text())
for r in d['migrations']:assert hashlib.sha256((pathlib.Path('prisma/migrations')/r['migration_name']/'migration.sql').read_bytes()).hexdigest()==r['checksum']
d.update(background_observation_seconds=12,all_synthetic_table_hashes_unchanged=True,pending_outbox_sentinel_untouched=True,unexpected_runtime_IPv4_drops=0)
(p/'database.json').write_text(json.dumps(d,indent=2)+'\n')
PY
test "$(docker inspect --format '{{.State.Health.Status}}' "$prefix-api")" = healthy
phase export-exact-tested-image
docker save "$image" | gzip -1 > engine-tested-image/runtime.tar.gz
export MR_TESTED_IMAGE_ID
MR_TESTED_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$image")
python3 - <<'PY'
import hashlib,json,os,pathlib
p=pathlib.Path('engine-tested-image');h=hashlib.file_digest((p/'runtime.tar.gz').open('rb'),'sha256').hexdigest()
d={'source_revision':os.environ['GITHUB_SHA'],'image_id':os.environ['MR_TESTED_IMAGE_ID'],'local_tag':'mr-engine-ci:'+os.environ['GITHUB_SHA'],'tar_sha256':h,'platform':'linux/amd64','tests_passed':True,'rebuilt_after_test':False}
(p/'image.json').write_text(json.dumps(d,indent=2)+'\n');pathlib.Path('engine-evidence/image.json').write_text(json.dumps(d,indent=2)+'\n')
PY
phase all-tests-passed
