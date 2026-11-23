#!/usr/bin/env bash
set -euo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REPOSITORY:-}" = pickupandgo/PickUp
test "${GITHUB_REF:-}" = refs/heads/mr-joint-synthetic-ci-20261123
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
prefix=mr-joint-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
state=$RUNNER_TEMP/$prefix
scripts=$GITHUB_WORKSPACE/ops/joint-ci
out=$GITHUB_WORKSPACE/joint-evidence
backend=ghcr.io/pickupandgo/mr-backend-rds-lab@sha256:f0514b3330d0cbb4f7f55ea62eaf6e39ca41a59c9edad2ed14b8b4bbc87ae1d4
engine=ghcr.io/pickupandgo/mr-trip-engine-lab@sha256:881dfd1efb49e0354c76b1613531dc793f4feb93e7490fc920c2c367cedb607e
postgres=postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139
mkdir -p "$out"
phase(){ printf '%s\n' "$1" > "$out/phase.txt"; }
phase verify-exact-immutable-images-and-source
git diff --exit-code d920295dd7ede9c2dac033801d7ff30688e14bdf -- Dockerfile .dockerignore src prisma package.json package-lock.json
export MR_JOINT_BACKEND=$backend MR_JOINT_ENGINE=$engine
python3 - <<'PY'
import json,os,pathlib,subprocess
images={}
for service,sha in [('BACKEND','1fc2d3645f0a6412a8f11e82b2037006f57d8eff'),('ENGINE','d920295dd7ede9c2dac033801d7ff30688e14bdf')]:
 ref=os.environ['MR_JOINT_'+service];d=json.loads(subprocess.check_output(['docker','image','inspect',ref],text=True))[0]
 assert ref in d['RepoDigests'] and d['Config']['User']=='node'
 assert d['Config']['Cmd']==['node','dist/main.js'] and d['Config']['Labels']['org.opencontainers.image.revision']==sha
 assert d['Os']=='linux' and d['Architecture']=='amd64'
 images[service.lower()]={'reference':ref,'image_id':d['Id'],'source':sha,'rebuilt':False}
pathlib.Path('joint-evidence/images.json').write_text(json.dumps(images,indent=2)+'\n')
PY
python3 "$scripts/evidence.py" init
for image in "$backend" "$engine";do
 docker run --rm --network none --read-only --memory 128m --memory-swap 128m --cpus .5 --pids-limit 32 --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint node "$image" -e "const f=require('node:fs');for(const p of ['/app/.env','/app/.env.production','/app/.git'])if(f.existsSync(p))throw Error('UNEXPECTED_RUNTIME_CONTENT');console.log('NO_EMBEDDED_ENV_PASS')"
done
mkdir "$state/backend-source" "$state/engine-source"
git archive 1fc2d3645f0a6412a8f11e82b2037006f57d8eff prisma pricing | tar -x -C "$state/backend-source"
git archive d920295dd7ede9c2dac033801d7ff30688e14bdf prisma | tar -x -C "$state/engine-source"
python3 - <<'PY'
import ipaddress,json,subprocess
c=ipaddress.ip_network('172.29.63.0/28');ids=subprocess.check_output(['docker','network','ls','-q'],text=True).split()
for n in json.loads(subprocess.check_output(['docker','network','inspect',*ids],text=True)) if ids else []:
 for v in n['IPAM'].get('Config') or []:
  if 'Subnet' in v and ':' not in v['Subnet']:assert not c.overlaps(ipaddress.ip_network(v['Subnet']))
PY
phase disposable-internal-network-and-databases
docker network create --internal --subnet 172.29.63.0/28 --gateway 172.29.63.1 --label io.multipleride.joint-ci="$prefix" "$prefix-net"
common=(--label "io.multipleride.joint-ci=$prefix" --read-only --cap-drop ALL --security-opt no-new-privileges)
docker run -d --name "$prefix-db" "${common[@]}" --network "$prefix-net" --ip 172.29.63.2 \
 --user postgres --memory 768m --memory-swap 768m --cpus 1 --pids-limit 128 --env-file "$state/db.env" \
 --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=805306368,uid=70,gid=70,mode=700 \
 --tmpfs /var/run/postgresql:rw,noexec,nosuid,nodev,size=8388608,uid=70,gid=70,mode=775 \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777 "$postgres" \
 -c shared_buffers=64MB -c max_connections=40 -c max_wal_size=128MB -c min_wal_size=32MB -c track_functions=all
for i in $(seq 1 45); do if docker exec "$prefix-db" pg_isready -U ci_owner -d mr_joint_backend_e2e >/dev/null; then break; fi;sleep 1;done
psql(){ docker exec -i "$prefix-db" psql -X -q -v ON_ERROR_STOP=1 -U ci_owner -d "$1" "${@:2}"; }
test "$(psql mr_joint_backend_e2e -Atc 'SHOW server_version')" = 16.15
psql mr_joint_backend_e2e -c 'CREATE DATABASE mr_engine_synthetic_test OWNER ci_owner;'
for pair in core:3 backguard:4; do
 name=${pair%:*};ip=${pair#*:}
 docker run -d --name "$prefix-$name" "${common[@]}" --network "$prefix-net" --ip "172.29.63.$ip" \
  --memory 64m --memory-swap 64m --cpus .2 --pids-limit 32 --entrypoint node "$engine" -e 'setInterval(()=>{},60000)'
done
for name in core backguard db; do
 pid=$(docker inspect --format '{{.State.Pid}}' "$prefix-$name")
 sudo nsenter -t "$pid" -n iptables -N MR_JOINT_OUT
 sudo nsenter -t "$pid" -n iptables -A MR_JOINT_OUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
 if test "$name" != db; then
  sudo nsenter -t "$pid" -n iptables -A MR_JOINT_OUT -d 172.29.63.2/32 -p tcp --dport 5432 -j ACCEPT
 fi
 case "$name" in
 core)
  sudo nsenter -t "$pid" -n iptables -A MR_JOINT_OUT -d 172.29.63.4/32 -p tcp --dport 3000 -j ACCEPT
  sudo nsenter -t "$pid" -n iptables -A MR_JOINT_OUT -d 127.0.0.1/32 -p tcp -j ACCEPT;;
 backguard)
  sudo nsenter -t "$pid" -n iptables -A MR_JOINT_OUT -d 172.29.63.3/32 -p tcp --dport 3443 -j ACCEPT
  sudo nsenter -t "$pid" -n iptables -A MR_JOINT_OUT -d 127.0.0.1/32 -p tcp --dport 3000 -j ACCEPT;;
 db)
  sudo nsenter -t "$pid" -n iptables -A MR_JOINT_OUT -d 127.0.0.1/32 -p tcp --dport 5432 -j ACCEPT;;
 esac
 sudo nsenter -t "$pid" -n iptables -A MR_JOINT_OUT -j DROP
 sudo nsenter -t "$pid" -n iptables -I OUTPUT 1 -j MR_JOINT_OUT
 sudo nsenter -t "$pid" -n ip6tables -I OUTPUT 1 -j DROP
 sudo nsenter -t "$pid" -n iptables -S OUTPUT | grep -Fx -- '-A OUTPUT -j MR_JOINT_OUT'
 sudo nsenter -t "$pid" -n ip6tables -S OUTPUT | grep -Fx -- '-A OUTPUT -j DROP'
done
helper(){
 local ns=$1 img=$2 env=$3;shift 3
 docker run --rm --name "$prefix-helper" "${common[@]}" --network "container:$prefix-$ns" \
  --memory 384m --memory-swap 384m --cpus .5 --pids-limit 64 --env-file "$state/$env.env" \
  --mount "type=bind,source=$scripts,target=/ci,readonly" --mount "type=bind,source=$state/ca.pem,target=/ci-ca.pem,readonly" \
  --entrypoint node "$img" "$@"
}
touch "$state/ca.pem";chmod 444 "$state/ca.pem"
helper core "$engine" engine /ci/network.cjs > "$out/network-core.json"
helper backguard "$backend" backend /ci/network.cjs > "$out/network-backguard.json"
helper core "$engine" engine /ci/preflight.cjs engine > "$out/configuration-engine.json"
helper backguard "$backend" backend /ci/preflight.cjs backend > "$out/configuration-backend.json"
phase exact-source-synthetic-SQL-migrations
for service in backend engine; do
 if test "$service" = backend; then db=mr_joint_backend_e2e;expected=32;tables=44;else db=mr_engine_synthetic_test;expected=4;tables=7;fi
 psql "$db" <<'SQL'
CREATE TABLE _prisma_migrations(id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,finished_at timestamptz,migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0);
SQL
 count=0
 while IFS= read -r file; do
  name=$(basename "$(dirname "$file")");[[ "$name" =~ ^[0-9]{14}_[a-z0-9_]+$ ]]
  hash=$(sha256sum "$file" | cut -d' ' -f1)
  psql "$db" < "$file" >> "$out/migrations-$service.log" 2>&1
  id=$(cat /proc/sys/kernel/random/uuid)
  psql "$db" -c "INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES('$id','$hash',now(),'$name',1);"
  count=$((count+1))
 done < <(find "$state/$service-source/prisma/migrations" -mindepth 2 -maxdepth 2 -type f -name migration.sql | LC_ALL=C sort)
 test "$count" = "$expected"
 test "$(psql "$db" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")" = "$tables"
 printf '%s migrations=%s public_tables=%s\n' "$service" "$count" "$tables" > "$out/migrations-$service.txt"
done
psql mr_joint_backend_e2e < "$state/roles.sql"
psql mr_joint_backend_e2e < "$state/backend-source/prisma/sql/02-app-grants.sql"
psql mr_engine_synthetic_test <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO engine_ci_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO engine_ci_runtime;
GRANT INSERT,UPDATE,DELETE ON engine_bookings,engine_stops,engine_offers,engine_trips,engine_outbox,engine_driver_positions TO engine_ci_runtime;
GRANT USAGE,SELECT ON SEQUENCE engine_outbox_id_seq TO engine_ci_runtime;
SQL
rm "$state/roles.sql"
phase synthetic-fixture-and-private-TLS-forwarder
docker run --rm --name "$prefix-seed" "${common[@]}" --network "container:$prefix-backguard" \
 --memory 384m --memory-swap 384m --cpus 1 --pids-limit 64 --env-file "$state/seed.env" \
 --mount "type=bind,source=$scripts,target=/ci,readonly" \
 --mount "type=bind,source=$state/backend-source/pricing/prototype-leg-distance-v1.json,target=/fixtures/pricing.json,readonly" \
 --entrypoint node "$backend" /ci/seed.cjs > "$out/seed.json"
docker run -d --name "$prefix-gateway" "${common[@]}" --network "container:$prefix-core" \
 --memory 128m --memory-swap 128m --cpus .5 --pids-limit 64 --env-file "$state/gateway.env" \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1777 \
 --mount "type=bind,source=$scripts,target=/ci,readonly" --entrypoint node "$engine" /ci/gateway.cjs
for i in $(seq 1 30);do if docker exec "$prefix-gateway" test -s /tmp/joint-pki/ca.pem;then break;fi;sleep 1;done
rm -f "$state/ca.pem"
docker exec "$prefix-gateway" cat /tmp/joint-pki/ca.pem > "$state/ca.pem";chmod 444 "$state/ca.pem"
helper core "$engine" engine -e "fetch('https://127.0.0.1:3443/__test/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
for service in backend engine;do
 if test "$service" = backend;then ns=backguard;img=$backend;mem=512m;else ns=core;img=$engine;mem=384m;fi
 docker create --name "$prefix-$service" "${common[@]}" --network "container:$prefix-$ns" \
  --memory "$mem" --memory-swap "$mem" --cpus 1 --pids-limit 128 --env-file "$state/$service.env" \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1777 \
  --mount "type=bind,source=$state/ca.pem,target=/ci-ca.pem,readonly" "$img"
done
python3 "$scripts/evidence.py" safety
for name in core backguard db;do
 pid=$(docker inspect --format '{{.State.Pid}}' "$prefix-$name")
 sudo nsenter -t "$pid" -n iptables -Z MR_JOINT_OUT
 sudo nsenter -t "$pid" -n ip6tables -Z OUTPUT
done
phase real-pair-startup-and-contract-tests
docker start "$prefix-backend" "$prefix-engine"
for mode in baseline business faults;do
 helper core "$engine" engine /ci/tests.cjs "$mode" < /dev/null > "$out/$mode.json"
 # State holds synthetic IDs only, never tokens, passwords or handover OTPs.
 if test "$mode" = business;then
  python3 - <<'PY'
import json,os,pathlib
d=json.loads(pathlib.Path('joint-evidence/business.json').read_text());p=pathlib.Path(os.environ['RUNNER_TEMP'])/('mr-joint-'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['GITHUB_RUN_ATTEMPT'])
(p/'state.json').write_text(json.dumps(d['state']));(p/'state.json').chmod(0o444)
PY
 fi
done
for service in backend engine;do
 phase "restart-$service-and-reconnect"
 docker restart --time 10 "$prefix-$service" >/dev/null
 docker run --rm --name "$prefix-helper" "${common[@]}" --network "container:$prefix-core" \
  --memory 384m --memory-swap 384m --cpus .5 --pids-limit 64 --env-file "$state/engine.env" \
  --mount "type=bind,source=$scripts,target=/ci,readonly" --mount "type=bind,source=$state/ca.pem,target=/ci-ca.pem,readonly" \
  --mount "type=bind,source=$state/state.json,target=/state.json,readonly" --entrypoint node "$engine" \
  /ci/tests.cjs "after-$service-restart" > "$out/after-$service-restart.json"
done
phase background-workers-disabled-observation
snapshot(){
 for db in mr_joint_backend_e2e mr_engine_synthetic_test;do
  psql "$db" -At <<'SQL'
SELECT format('SELECT %L,count(*),md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM %I.%I t;',tablename,schemaname,tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename \gexec
SQL
 done
}
snapshot > "$out/before-idle.txt"
sleep 65
snapshot > "$out/after-idle.txt"
cmp "$out/before-idle.txt" "$out/after-idle.txt"
test "$(psql mr_joint_backend_e2e -Atc "SELECT coalesce(sum(calls),0) FROM pg_stat_user_functions WHERE funcname='purge_closed_chat_conversations'")" = 0
test "$(psql mr_joint_backend_e2e -Atc 'SELECT (SELECT count(*) FROM payments)+(SELECT count(*) FROM payment_events)+(SELECT count(*) FROM payment_settlements)+(SELECT count(*) FROM driver_payouts)+(SELECT count(*) FROM payout_batches)+(SELECT count(*) FROM payout_events)+(SELECT count(*) FROM payment_refunds)')" = 0
for service in backend engine;do test "$(docker inspect --format '{{.State.Running}}' "$prefix-$service")" = true;done
for name in core backguard db;do
 pid=$(docker inspect --format '{{.State.Pid}}' "$prefix-$name")
 test "$(sudo nsenter -t "$pid" -n iptables -L MR_JOINT_OUT -n -v -x | awk '$3=="DROP"{print $1}')" = 0
 test "$(sudo nsenter -t "$pid" -n ip6tables -L OUTPUT -n -v -x | awk '$3=="DROP"{print $1}')" = 0
done
printf '{"result":"PASS","observation_seconds":65,"all_51_table_hashes_unchanged":true,"chat_cleanup_calls":0,"unexpected_runtime_network_drops":0,"workers_disabled":true}\n' > "$out/background.json"
phase all-tests-passed
