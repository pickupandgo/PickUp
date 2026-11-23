#!/usr/bin/env bash
set -euo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${GITHUB_REPOSITORY:-}" = pickupandgo/PickUp
test "${GITHUB_REF:-}" = refs/heads/mr-backend-migrator-ci-20261123
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
p=mr-migrator-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT
s=$RUNNER_TEMP/$p
scripts=$GITHUB_WORKSPACE/ops/migrator-ci
out=$GITHUB_WORKSPACE/migrator-evidence
image=$IMAGE:$GITHUB_SHA
pg=postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139
mkdir -m 700 "$s";mkdir -p "$out" "$s/source" "$s/tls"
phase(){ printf '%s\n' "$1" > "$out/phase.txt"; }
phase pinned-source-and-image
git diff --exit-code "$SOURCE_COMMIT" -- Dockerfile .dockerignore src prisma package.json package-lock.json prisma.config.ts
git archive "$SOURCE_COMMIT" | tar -x -C "$s/source"
find "$s/source" -type d -exec chmod 755 {} +
find "$s/source" -type f -exec chmod 644 {} +
docker build --target migrate --build-arg NODE_IMAGE=node:22.22.0-alpine@sha256:48f53c3f0105ccddcc5e4f520347398dfc0ba9b3008fbfd98a2add27e5797957 \
 --label org.opencontainers.image.source=https://github.com/pickupandgo/PickUp \
 --label org.opencontainers.image.revision="$SOURCE_COMMIT" --label io.multipleride.target=migrate -t "$image" "$s/source"
test "$(docker image inspect --format '{{.Config.User}}' "$image")" = node
test "$(docker image inspect --format '{{json .Config.Cmd}}' "$image")" = '["node","node_modules/prisma/build/index.js","migrate","deploy"]'
docker image inspect --format '{{.Id}}' "$image" > "$out/tested-image-id.txt"
common=(--label "io.multipleride.migrator-ci=$p" --read-only --cap-drop ALL --security-opt no-new-privileges --memory 512m --memory-swap 512m --cpus 1 --pids-limit 128)
docker run --rm --network none "${common[@]}" --mount "type=bind,source=$scripts,target=/release,readonly" --entrypoint node "$image" /release/verify-image.cjs > "$out/image-inventory-check.json"
cp "$scripts/inventory.json" "$out/migration-inventory.json"
phase synthetic-TLS-PostgreSQL
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=migrator-ci.invalid -addext subjectAltName=IP:127.0.0.1 \
 -keyout "$s/tls/server.key" -out "$s/tls/server.crt" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=untrusted-ci.invalid \
 -keyout "$s/tls/bad.key" -out "$s/tls/bad.crt" >/dev/null 2>&1
chmod 755 "$s/tls";chmod 444 "$s/tls/server.crt" "$s/tls/bad.crt";chmod 400 "$s/tls/server.key";sudo chown 70:70 "$s/tls/server.key"
export MR_MIGRATOR_STATE=$s
python3 - <<'PY'
import os,pathlib,secrets
p=pathlib.Path(os.environ['MR_MIGRATOR_STATE']);pw='dummy_migrator_ci_'+secrets.token_hex(24)
print('::add-mask::'+pw)
(p/'db.env').write_text('POSTGRES_USER=ci_owner\nPOSTGRES_PASSWORD='+pw+'\nPOSTGRES_DB=mr_migrator_upgrade_ci\n')
for name,db in [('upgrade','mr_migrator_upgrade_ci'),('fresh','mr_migrator_fresh_ci')]:
 base='postgresql://ci_owner:'+pw+'@127.0.0.1:5432/'+db+'?schema=public&sslmode=require&sslaccept=strict&sslcert=/ci-ca.pem&connect_timeout=5&socket_timeout=30'
 (p/(name+'.env')).write_text('MR_MIGRATOR_CI=true\nCHECKPOINT_DISABLE=1\nPRISMA_HIDE_UPDATE_MESSAGE=true\nDATABASE_URL='+base+'\n')
(p/'password').write_text(pw)
PY
docker pull "$pg"
docker network create --internal --subnet 172.29.64.0/28 --label io.multipleride.migrator-ci="$p" "$p-net" >/dev/null
docker run -d --name "$p-db" "${common[@]}" --network "$p-net" --ip 172.29.64.2 --user postgres --env-file "$s/db.env" \
 --mount "type=bind,source=$s/tls,target=/tls,readonly" \
 --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=805306368,uid=70,gid=70,mode=700 \
 --tmpfs /var/run/postgresql:rw,noexec,nosuid,nodev,size=8388608,uid=70,gid=70,mode=775 \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777 "$pg" \
 -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key -c shared_buffers=64MB -c max_connections=30 -c max_wal_size=128MB -c min_wal_size=32MB
for i in $(seq 1 45);do
 if docker exec "$p-db" pg_isready -h 127.0.0.1 -U ci_owner -d mr_migrator_upgrade_ci >/dev/null;then break;fi
 test "$(docker inspect --format '{{.State.Running}}' "$p-db")" = true;sleep 1
done
docker exec "$p-db" pg_isready -h 127.0.0.1 -U ci_owner -d mr_migrator_upgrade_ci >/dev/null
psql(){ docker exec -i "$p-db" psql -X -q -v ON_ERROR_STOP=1 -U ci_owner -d mr_migrator_upgrade_ci "$@"; }
test "$(psql -Atc 'SHOW server_version')" = 16.15
psql -c 'CREATE DATABASE mr_migrator_fresh_ci OWNER ci_owner;'
pid=$(docker inspect --format '{{.State.Pid}}' "$p-db")
sudo nsenter -t "$pid" -n iptables -N MR_MIG_OUT
sudo nsenter -t "$pid" -n iptables -A MR_MIG_OUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for address in 127.0.0.1 172.29.64.2;do sudo nsenter -t "$pid" -n iptables -A MR_MIG_OUT -d "$address/32" -p tcp --dport 5432 -j ACCEPT;done
sudo nsenter -t "$pid" -n iptables -A MR_MIG_OUT -j DROP
sudo nsenter -t "$pid" -n iptables -I OUTPUT 1 -j MR_MIG_OUT
sudo nsenter -t "$pid" -n ip6tables -I OUTPUT 1 -j DROP
helper(){
 local target=$1;shift
 docker run --rm --name "$p-helper" "${common[@]}" --network "container:$p-db" --env-file "$s/$target.env" \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=67108864,mode=1777 \
  --mount "type=bind,source=$scripts,target=/release,readonly" \
  --mount "type=bind,source=$s/tls/server.crt,target=/ci-ca.pem,readonly" --mount "type=bind,source=$s/tls/bad.crt,target=/bad-ca.pem,readonly" \
  --entrypoint node "$image" "$@"
}
deploy(){
 local target=$1 suffix=$2
 docker run --name "$p-$suffix" "${common[@]}" --network "container:$p-db" --env-file "$s/$target.env" \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=67108864,mode=1777 \
  --mount "type=bind,source=$s/tls/server.crt,target=/ci-ca.pem,readonly" "$image" \
  2>&1 | python3 "$scripts/sanitize.py" "$s/password" | tee "$out/$suffix.log"
}
phase exact-32-migration-baseline-and-existing-synthetic-records
psql <<'SQL'
CREATE TABLE _prisma_migrations(id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,finished_at timestamptz,migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0);
SQL
count=0
while IFS= read -r name;do
 file=$s/source/prisma/migrations/$name/migration.sql
 psql < "$file" >> "$out/baseline.log" 2>&1
 hash=$(sha256sum "$file" | cut -d' ' -f1);id=$(cat /proc/sys/kernel/random/uuid)
 psql -c "INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES('$id','$hash',now(),'$name',1);" < /dev/null
 count=$((count+1));if test "$count" = 5;then psql < "$scripts/seed-early.sql";fi
done < <(python3 -c "import json; print('\n'.join(r['name'] for r in json.load(open('ops/migrator-ci/inventory.json'))['migrations'][:-1]))")
test "$count" = 32
psql < "$scripts/seed-proofs.sql"
helper upgrade /release/test-db.cjs before > "$out/before.json"
phase actual-default-migrate-deploy-single-pending-migration
deploy upgrade upgrade
helper upgrade /release/test-db.cjs after > "$out/after.json"
phase fresh-all-33-migrations
deploy fresh fresh
helper fresh /release/test-db.cjs after > "$out/fresh.json"
phase idempotence-and-TLS-negative-tests
deploy upgrade rerun
helper upgrade /release/test-db.cjs snapshot > "$out/rerun.json"
helper upgrade /release/tls-tests.cjs > "$out/TLS.json"
helper upgrade /release/test-db.cjs trigger-tests > "$out/triggers.json"
# ACL generator and rollback are exercised against synthetic fixtures only.
helper upgrade /release/acl.cjs ci-test > "$out/ACL.json"
helper upgrade /release/test-db.cjs snapshot > "$out/final.json"
python3 "$scripts/validate-results.py"
phase all-tests-passed
