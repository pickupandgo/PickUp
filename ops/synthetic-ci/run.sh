#!/usr/bin/env bash
set -euo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REPOSITORY:-}" = pickupandgo/PickUp
test "${GITHUB_REF:-}" = refs/heads/mr-aws-rds-lab-20261121
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
prefix=mr-synth-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
state=$RUNNER_TEMP/mr-synthetic-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
out=$GITHUB_WORKSPACE/synthetic-evidence
scripts=$GITHUB_WORKSPACE/ops/synthetic-ci
pin=1fc2d3645f0a6412a8f11e82b2037006f57d8eff
image=ghcr.io/pickupandgo/mr-backend-rds-lab@sha256:f0514b3330d0cbb4f7f55ea62eaf6e39ca41a59c9edad2ed14b8b4bbc87ae1d4
postgres=postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139
mkdir -p "$out"
phase(){ printf '%s\n' "$1" > "$out/phase.txt"; }
phase source-and-image-verification
git diff --exit-code "$pin" -- src prisma Dockerfile package.json package-lock.json prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json
python3 "$scripts/evidence.py" init
export DOCKER_CONFIG=$state/docker-config
mkdir -m 700 "$DOCKER_CONFIG"
# Anonymous pulls only. No production or registry secret is loaded.
docker pull "$image"
docker pull "$postgres"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$pin"
test "$(docker image inspect --format '{{.Config.User}}' "$image")" = node
test "$(docker image inspect --format '{{json .Config.Cmd}}' "$image")" = '["node","dist/main.js"]'
docker image inspect "$image" --format '{{json .RepoDigests}}' > "$out/image-digests.json"
phase safety-configuration
docker run --rm --name "$prefix-config" --label io.multipleride.synthetic-run="$prefix" --network none --read-only --memory 256m --cap-drop ALL \
 --security-opt no-new-privileges --env-file "$state/api.env" \
 --mount "type=bind,source=$scripts,target=/ci,readonly" --entrypoint node "$image" /ci/contract.cjs > "$out/configuration.json"
docker run --rm --name "$prefix-closed" --label io.multipleride.synthetic-run="$prefix" --network none --read-only --memory 256m --cap-drop ALL \
 --security-opt no-new-privileges --env-file "$state/api.env" \
 --mount "type=bind,source=$scripts,target=/ci,readonly" --entrypoint node "$image" /ci/fail-closed-tests.cjs > "$out/fail-closed-tests.json"
phase synthetic-database
python3 - <<'PY'
import ipaddress,json,subprocess
candidate=ipaddress.ip_network('172.29.62.0/28')
ids=subprocess.check_output(['docker','network','ls','-q'],text=True).split()
for n in json.loads(subprocess.check_output(['docker','network','inspect',*ids],text=True)) if ids else []:
 for c in n['IPAM'].get('Config') or []:
  if 'Subnet' in c and ':' not in c['Subnet']:assert not candidate.overlaps(ipaddress.ip_network(c['Subnet']))
PY
docker network create --internal --subnet 172.29.62.0/28 --gateway 172.29.62.1 \
 --opt com.docker.network.bridge.name=mrsynth62 --label io.multipleride.synthetic-run="$prefix" "$prefix-net"
test "$(docker network inspect --format '{{.Internal}}' "$prefix-net")" = true
test "$(docker network inspect --format '{{.EnableIPv6}}' "$prefix-net")" = false
test "$(docker run --rm --name "$prefix-pg-id" --label io.multipleride.synthetic-run="$prefix" --network none --entrypoint id "$postgres" -u postgres)" = 70
docker run -d --name "$prefix-db" --label io.multipleride.synthetic-run="$prefix" \
 --network "$prefix-net" --ip 172.29.62.2 --user postgres --read-only \
 --memory 512m --memory-swap 512m --cpus 1 --pids-limit 128 --cap-drop ALL \
 --security-opt no-new-privileges --env-file "$state/db.env" \
 --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=536870912,uid=70,gid=70,mode=700 \
 --tmpfs /var/run/postgresql:rw,noexec,nosuid,nodev,size=8388608,uid=70,gid=70,mode=775 \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777 \
 "$postgres" -c shared_buffers=64MB -c max_connections=20 -c max_wal_size=128MB -c min_wal_size=32MB -c track_functions=all
for n in $(seq 1 50); do
 if docker exec "$prefix-db" pg_isready -U ci_owner -d mr_synthetic_backend_ci >/dev/null; then break; fi
 sleep 1
done
psql_owner(){ docker exec -i "$prefix-db" psql -X -q -v ON_ERROR_STOP=1 -U ci_owner -d mr_synthetic_backend_ci "$@"; }
test "$(psql_owner -Atc 'SHOW server_version')" = 16.15
psql_owner <<'SQL'
CREATE TABLE _prisma_migrations (
 id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
 finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text,
 rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(),
 applied_steps_count integer NOT NULL DEFAULT 0);
SQL
phase apply-pinned-synthetic-migrations
count=0
while IFS= read -r migration; do
 name=$(basename "$(dirname "$migration")")
 [[ "$name" =~ ^[0-9]{14}_[a-z0-9_]+$ ]]
 checksum=$(sha256sum "$migration" | cut -d' ' -f1)
 printf 'Applying synthetic migration %s\n' "$name"
 psql_owner < "$migration" >> "$out/migrations.log" 2>&1
 id=$(cat /proc/sys/kernel/random/uuid)
 printf "INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES('%s','%s',now(),'%s',1);\n" "$id" "$checksum" "$name" | psql_owner
 count=$((count+1))
done < <(find prisma/migrations -mindepth 2 -maxdepth 2 -name migration.sql -type f | LC_ALL=C sort)
test "$count" = 32
python3 "$scripts/evidence.py" runtime-sql | psql_owner
snapshot(){
 psql_owner -At <<'SQL'
SELECT format('SELECT %L, count(*) FROM %I.%I;',tablename,schemaname,tablename)
 FROM pg_tables WHERE schemaname='public' ORDER BY tablename \gexec
SQL
}
snapshot > "$out/rows-before.txt"
phase prepare-network-namespace
docker run -d --name "$prefix-guard" --label io.multipleride.synthetic-run="$prefix" \
 --network "$prefix-net" --ip 172.29.62.3 --read-only --memory 96m --memory-swap 96m \
 --pids-limit 32 --cap-drop ALL --security-opt no-new-privileges \
 --entrypoint node "$image" -e 'setInterval(()=>{},60000)'
guardpid=$(docker inspect --format '{{.State.Pid}}' "$prefix-guard")
dbpid=$(docker inspect --format '{{.State.Pid}}' "$prefix-db")
sudo nsenter -t "$guardpid" -n iptables -N MR_SYNTH_OUT
sudo nsenter -t "$guardpid" -n iptables -A MR_SYNTH_OUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo nsenter -t "$guardpid" -n iptables -A MR_SYNTH_OUT -d 172.29.62.2/32 -p tcp --dport 5432 -j ACCEPT
sudo nsenter -t "$guardpid" -n iptables -A MR_SYNTH_OUT -d 127.0.0.1/32 -p tcp --dport 3000 -j ACCEPT
sudo nsenter -t "$guardpid" -n iptables -A MR_SYNTH_OUT -j DROP
sudo nsenter -t "$guardpid" -n iptables -I OUTPUT 1 -j MR_SYNTH_OUT
sudo nsenter -t "$guardpid" -n ip6tables -I OUTPUT 1 -j DROP
sudo nsenter -t "$dbpid" -n iptables -N MR_SYNTH_DB_OUT
sudo nsenter -t "$dbpid" -n iptables -A MR_SYNTH_DB_OUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo nsenter -t "$dbpid" -n iptables -A MR_SYNTH_DB_OUT -d 127.0.0.1/32 -p tcp --dport 5432 -j ACCEPT
sudo nsenter -t "$dbpid" -n iptables -A MR_SYNTH_DB_OUT -j DROP
sudo nsenter -t "$dbpid" -n iptables -I OUTPUT 1 -j MR_SYNTH_DB_OUT
sudo nsenter -t "$dbpid" -n ip6tables -I OUTPUT 1 -j DROP
sudo nsenter -t "$guardpid" -n iptables -S OUTPUT | grep -Fx -- '-A OUTPUT -j MR_SYNTH_OUT'
sudo nsenter -t "$guardpid" -n ip6tables -S OUTPUT | grep -Fx -- '-A OUTPUT -j DROP'
helper(){ docker run --rm --name "$prefix-tester" --label io.multipleride.synthetic-run="$prefix" \
 --network "container:$prefix-guard" --read-only --memory 256m --memory-swap 256m \
 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
 --mount "type=bind,source=$scripts,target=/ci,readonly" --entrypoint node "$image" "$@"; }
helper /ci/network.cjs > "$out/network-tests.json"
sudo nsenter -t "$guardpid" -n iptables -Z MR_SYNTH_OUT
phase create-and-verify-pinned-API
docker create --name "$prefix-api" --label io.multipleride.synthetic-run="$prefix" \
 --network "container:$prefix-guard" --read-only --memory 512m --memory-swap 512m \
 --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1777 \
 --env-file "$state/api.env" -e NODE_OPTIONS=--max-old-space-size=256 "$image"
export MR_CI_PREFIX="$prefix"
python3 - <<'PY'
import json,os,subprocess,pathlib
p=os.environ['MR_CI_PREFIX']; net=json.loads(subprocess.check_output(['docker','network','inspect',p+'-net'],text=True))[0]
api=json.loads(subprocess.check_output(['docker','inspect',p+'-api'],text=True))[0]
guard=json.loads(subprocess.check_output(['docker','inspect',p+'-guard'],text=True))[0]
db=json.loads(subprocess.check_output(['docker','inspect',p+'-db'],text=True))[0]
assert net['Internal'] and not net['EnableIPv6']
assert api['HostConfig']['NetworkMode'] in ('container:'+guard['Id'],'container:'+guard['Name'].lstrip('/'))
assert api['Config']['Cmd']==['node','dist/main.js'] and api['Config']['User']=='node'
assert api['Image']==guard['Image']
for c in [api,guard,db]:assert not c['HostConfig']['PortBindings'] and not c['HostConfig']['Privileged']
assert api['HostConfig']['ReadonlyRootfs']
env=dict(x.split('=',1) for x in api['Config']['Env'])
assert env['DATABASE_URL'].split('@')[1]=='172.29.62.2:5432/mr_synthetic_backend_ci'
assert env['MR_DISABLE_CHAT_CLEANUP']=='true' and env['FCM_ENABLED']=='false'
assert not any(x.startswith(('AWS_','GOOGLE_','GITHUB_','ACTIONS_','AZURE_')) for x in env)
pathlib.Path('synthetic-evidence/safety.json').write_text(json.dumps({'result':'PASS','internal_network':True,'namespace_only':True,'public_ports':False,'exact_image_and_default_command':True,'production_env_or_cloud_credentials':False,'api_readonly_rootfs':True},indent=2)+'\n')
PY
phase Backend-startup-and-HTTP-tests
docker start "$prefix-api"
apipid=$(docker inspect --format '{{.State.Pid}}' "$prefix-api")
test "$(sudo readlink "/proc/$apipid/ns/net")" = "$(sudo readlink "/proc/$guardpid/ns/net")"
helper /ci/http-tests.cjs > "$out/http-tests.json"
phase observe-disabled-background-jobs
# Cover at least one 60-second cleanup/payout tick without publishing a port.
sleep 65
test "$(docker inspect --format '{{.State.Running}}' "$prefix-api")" = true || { echo 'FAIL: API exited during background observation'; exit 1; }
helper /ci/post-idle.cjs > "$out/post-idle.json"
snapshot > "$out/rows-after.txt"
cmp "$out/rows-before.txt" "$out/rows-after.txt" || { echo 'FAIL: synthetic table row counts changed'; exit 1; }
connections=$(psql_owner -At <<'SQL'
SELECT count(*) FROM pg_stat_activity WHERE datname='mr_synthetic_backend_ci' AND usename='ci_runtime' AND application_name='multipleride-backend';
SQL
)
printf 'Backend database connections after fresh readiness: %s\n' "$connections"
test "$connections" -ge 1 || { echo 'FAIL: fresh readiness did not leave a Backend DB connection'; exit 1; }
cleanup_calls=$(psql_owner -At <<'SQL'
SELECT coalesce(sum(calls),0) FROM pg_stat_user_functions WHERE funcname='purge_closed_chat_conversations';
SQL
)
test "$cleanup_calls" = 0 || { echo 'FAIL: chat cleanup function was called'; exit 1; }
outbound_drops=$(sudo nsenter -t "$guardpid" -n iptables -L MR_SYNTH_OUT -n -v -x | awk '$3=="DROP"{print $1}')
printf 'Unexpected outbound drops during API execution: %s\n' "$outbound_drops"
test "$outbound_drops" = 0 || { echo 'FAIL: unexpected outbound packet attempt'; exit 1; }
python3 - "$count" <<'PY'
import json,pathlib,sys
p=pathlib.Path('synthetic-evidence'); rows=dict(line.split('|') for line in (p/'rows-after.txt').read_text().splitlines())
(p/'database.json').write_text(json.dumps({'result':'PASS','PostgreSQL_version':'16.15','migrations_applied':int(sys.argv[1]),'public_table_count':len(rows),'baseline_and_after_row_counts_equal':True,'background_observation_seconds':65,'chat_cleanup_function_calls':0,'database_initialized_by_published_Backend':True,'unexpected_outbound_packet_drops_during_API_test':0,'real_data_loaded':False},indent=2)+'\n')
PY
phase all-tests-passed
