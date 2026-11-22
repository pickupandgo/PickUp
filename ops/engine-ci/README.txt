MultipleRide Trip Engine synthetic image pipeline — NO DEPLOYMENT

Isolated branch: mr-engine-synthetic-ci-20261123
Base raj_engine: f06c51797103eb78f173560f540a6d0e623adc22
Runtime: Node24.21.0 Alpine (digest pinned), existing Prisma7.10.0 lock/schema.
Image: ghcr.io/pickupandgo/mr-trip-engine-lab:sha-<source-commit>
Use the resulting @sha256 digest as the immutable reference, not a mutable tag.

Dockerfile targets:
  tooling: generated Prisma, compiled application, dev/test dependencies and
    public .env.example only. Includes Prisma migration CLI; never published.
  runtime: non-root node, production dependencies and dist only. No .env files,
    tests, Git checkout, fixture, TLS/JWT keys or migration CLI. Default worker
    timers are disabled. No startup migration/seed. Default command node dist/main.js.
  Health: /health is liveness; /health/ready runs only SELECT1 and returns generic
    503 on database failure, with no database error/connection details in response.

Only GitHub-hosted ubuntu24.04; exact repository/ref guards; no AWS, SSH, Render,
production environments, production secrets, OIDC or deployment steps.
Source package/lock/migrations are required unchanged from the Engine base.
Existing raj_engine/raj_backend/Driver and the Backend image are never changed.

Build/test job has contents:read only. Dependency acquisition/build/audit occurs
before the integration sandbox, without production credentials. All app, fixture,
migration and regression processes use none/internal networking after build.
Publisher on a fresh runner has contents:read and packages:write only and runs
only after test job, cleanup, evidence and tested-image transfer succeed. It loads
the saved image, verifies tar hash, revision and image ID; never rebuilds. Existing
commit tags are reused only for the identical image ID. Published digest is pulled
back and checked against the tested image ID. No latest tag is written.

Runtime integration network:
  Internal Docker172.29.63.0/28, no published ports, IPv6 disabled.
  PostgreSQL16.15 pinned digest at172.29.63.2, 512MiB, tmpfs data only.
  Guard namespace172.29.63.3 shared by API/mock/tester/tooling.
  Namespace OUTPUT allows established replies, PostgreSQL5432 and TCP127.0.0.1
  only. Default IPv4 DROP and IPv6 DROP. Docker DNS127.0.0.11, metadata, gateway
  and Internet probes must fail. No hostname resolution is needed by the API.
  API384MiB/1CPU/128PIDs/read-only filesystem/cap-drop ALL/no-new-privileges.
  Mock128MiB; tools1536MiB; DB512MiB; bounded CPU/PID/swap limits for each.
  Only host runner administers those disposable namespace rules; containers have
  no Docker socket, host credentials or network-admin capability.

Data/credential boundaries:
  New mr_engine_synthetic_test and mr_engine_suite_test in this one temporary PG.
  Prisma migrate deploy runs independently on both; no existing server accessed.
  Runtime uses a new synthetic non-owner write login; test suite uses dummy owner
  only on separate empty suite DB. Existing Jest globalSetup is replaced with an
  exact-host/database guard + metadata checks; no old .env/dev fallback or DROP.
  Existing suite's TRUNCATE/reset applies only to that separate synthetic DB.
  All fixtures are synthetic. No actual provider, financial transaction or real
  Backend is involved; payment state is an in-memory mock response only.
  TLS private key in mock tmpfs; JWT keys generated only in fixture memory;
  dummy API/DB credentials generated on runner and excluded from artifacts.
  API verifies mock TLS CA + IP hostname; negative CA/hostname tests must fail.
  Only public fixture CA is mounted into API. Never set TLS verification to0.

Safety gates:
  MR_SYNTHETIC_ONLY=true refuses remote DB/JWKS/Backend URLs, wrong DB/user,
  non-dummy internal key, nonzero outbox/dispatch, cloud/provider credentials,
  proxy overrides or TLS bypass. CI refuses a missing synthetic flag separately.
  Source flags do not substitute for the enforced namespace firewall.
  Unit/type checks; real Prisma migrations/checksums; existing synthetic E2E
  regressions; exact runtime startup/health/JWT/authorization; HTTPS Backend
  contracts, booking replay and mocked assignment/arrival. No amount/payment
  status or customer bearer token may be sent to internal Backend APIs.
  A due PENDING outbox sentinel and all synthetic table hashes must remain
  unchanged during12s idle (> default1000ms engine timer interval). Zero new
  unexpected runtime IPv4 drops. No claim of unimplemented WebSocket support.

Cleanup always checks the run label, deletes only this run's containers/network,
destroys DB/mock tmpfs, removes exact dummy files, and records cleanup evidence.
Cleanup failure blocks publication. Ephemeral GitHub runner disposes remaining
build caches after the job. Raw logs are sanitized before evidence upload.

Production follow-up is separate: no deployment, RDS connection, live secret,
worker activation or cutover is authorized by building/publishing this image.
RDS TLS/privileges, real Backend compatibility, synchronization and single-writer
cutover still need their independent approvals and evidence.
