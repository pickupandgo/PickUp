# Professional onboarding - packaged Render staging release

Verified 2026-10-29. Local release commits are authorized and prepared. **No push, deployment,
live migration, staging backup, live grants/role change, AWS/configuration change, token rotation,
KYC activation or real-administrator provisioning is authorized or performed here.**
Commands under future rollout require separate explicit authorization.

## 1. Verified deployment source and preserved work

| Item                              | Verified state                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Repository / remote               | `origin` = `pickupandgo/PickUp`; the `multipleride` mirror is not the deployment target |
| Actual Render service             | `pickup-backend-engine-v2`, `srv-dak1466k1f9s73ajo6c0`, Free/Oregon/Node, one instance  |
| Linked branch / live commit       | `raj_backend` / `354007d0a1b8fd9c9bd7b41d7c7b7beaa3a9e05a`                              |
| Live deploy                       | `dep-dbgvbk08v5cc73flc3ng`                                                              |
| Actual build / start              | `npm ci --include=dev && npm run build` / `npm run start`                               |
| Auto-Deploy / health / pre-deploy | Off / `/health/live` / none                                                             |
| Render runtime                    | `NODE_VERSION=22.22.0`, compatible with package requirement `>=22.12`                   |
| Preserved source branch           | `codex/admin-api-batch1` at `88a08ee1c3b627d4afce23c64373297b47f6fad5`                  |
| New local release branch          | `codex/professional-onboarding-staging`                                                 |
| Admin Batch 1                     | Already inherited from `88a08ee`; not deployed on Render                                |

GitHub was checked through its read-only connector and Render through CLI/read-only GETs.
The remote and live backend are still at `354007d`. That commit is an ancestor of the release,
which also preserves `88a08ee`; no merge/rebase or history rewrite was needed. The live service
already includes Phase 1 and the Phase 2A/2B backend/GuardDuty foundation. Professional profile
enhancements, security corrections, fixtures and Admin Batch 1 are the pending release additions.

At packaging start there were 31 modified tracked backend paths and 13 untracked files. Exactly
43 reviewed files are packaged below; the unrelated old migration helper remains untracked.
Driver `raj_driver` (`39ad0c4`) keeps all 5 tracked and 6 untracked changes. Engine `raj_engine`
(`63d69dc`) and original Customer `raj_customer` (`47a4fb9`) remain untouched/clean.
The separate Customer integration was already published at `322dc96` before this task and stays
clean; no Customer commit or push is part of this backend packaging.
Customer stash `325d9b218e0f1cd13b2a80f922a85a0bfff7a0b0`, branches, worktrees and backup
artifacts are preserved.

The QA-reviewed source/migration byte inventory excluding generated Prisma code remains
`CFD0647E01E77EDEDD7052FDFD81AA8B18BFCB3A6A1551A6AC19B2658DD35487`.
No runtime implementation was rewritten for packaging. Existing `.env` is ignored/untracked;
its values and existing S3/Firebase/internal/GuardDuty credentials are untouched.

### Created local commits and exact changed-file manifest

Implementation commit: `2f5aab006ffe7b12776d787b3b3726119d734552` (23 files):

```text
prisma/schema.prisma
prisma/migrations/20261029130000_driver_profile_details/migration.sql
prisma/sql/02-app-grants.sql
src/bootstrap/configure-app.ts
src/cli/provision-commands.ts
src/config/app-config.ts
src/config/env.schema.ts
src/onboarding/admin-onboarding.controller.ts
src/onboarding/document-storage.service.ts
src/onboarding/document-storage.service.spec.ts
src/onboarding/guardduty-scan.service.ts
src/onboarding/guardduty-scan.service.spec.ts
src/onboarding/onboarding.controller.ts
src/onboarding/onboarding.dto.ts
src/onboarding/onboarding.responses.ts
src/onboarding/onboarding.service.ts
src/onboarding/onboarding.service.spec.ts
src/onboarding/profile-policy.ts
src/onboarding/profile-policy.spec.ts
test/helpers/fixtures.ts
test/integration/onboarding-profile.int-spec.ts
test/integration/onboarding-workflow.int-spec.ts
test/migration/check-driver-profile.mjs
```

Fixture-correction commit: `a815cce2aa1bf877be31fc1cbc41221b0da3d0ea` (16 files):

```text
test/helpers/test-config.ts
test/helpers/onboarding-fixtures.ts
test/integration/least-privilege.int-spec.ts
test/integration/booking-payments.int-spec.ts
test/integration/booking-registration.int-spec.ts
test/integration/collections.int-spec.ts
test/integration/delivery-stops.int-spec.ts
test/integration/fee-rules.int-spec.ts
test/integration/legacy-bookings.int-spec.ts
test/integration/multi-collection-earnings.int-spec.ts
test/integration/payouts.int-spec.ts
test/integration/pickup-payment.int-spec.ts
test/integration/refunds.int-spec.ts
test/integration/stop-collections.int-spec.ts
test/integration/stop-obligation-schema.int-spec.ts
test/integration/trips-earnings.int-spec.ts
```

Final documentation commit (this runbook and the other three handoff documents):

```text
docs/driver-onboarding-professional.md
docs/driver-onboarding-qa-handoff.md
docs/legacy-integration-fixtures-qa.md
docs/staging-professional-onboarding-release.md
```

The final candidate is the documentation commit at the tip of
`codex/professional-onboarding-staging`. Its full SHA is recorded in the final handoff and
workspace `CODEX_MEMORY.md` (outside this repository); resolve it locally with:

```text
git rev-parse codex/professional-onboarding-staging
git log --oneline 88a08ee..codex/professional-onboarding-staging
git diff --name-status 354007d..codex/professional-onboarding-staging
```

The first two commits freeze all code, migration and tests; the final commit changes only docs.
The already-committed Admin Batch 1 manifest is separately reviewable with
`git show --stat 88a08ee`; do not duplicate or drop that ancestor.
No customer, driver, engine or financial business-rule source is added by this release.

Exclude and preserve `scripts/migrate-render-phase2.ps1`: it expects an obsolete branch and
24-migration success message and is not this release's execution tool. No `.env`, private
document, dump, signing key, generated client, `dist`, APK or temporary helper is included.
Stage/commit review and secret checks use explicit manifests; never `git add .`.

On a later explicitly authorized push, fetch and recheck `origin/raj_backend`; stop if remote
history advanced unexpectedly. Require it to be an ancestor of this exact candidate before an
ordinary fast-forward `HEAD:raj_backend`. Never force-push. Keep Auto-Deploy off.

## 2. Actual database, migration and grants readiness

The following database evidence is from the completed, identity-checked deployment preflight
and the confirmed staging snapshot. That check used TLS certificate validation and a PostgreSQL
`REPEATABLE READ READ ONLY` transaction. Release packaging did not connect to the staging
database or execute live DDL/DML. Only isolated synthetic test databases were used below.

| Check                   | Result                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Instance                | `pickup-postgres-v2`, `dpg-dbdia7hsrm7s73brlpk0-a`, Free, Oregon, available                              |
| Database/version        | `multipleride_j9os`, PostgreSQL 16.15                                                                    |
| Runtime/connected role  | `multipleride_j9os_user`, database and `drivers` owner; public-schema CREATE and driver UPDATE available |
| Role separation         | `mr_app` and `mr_migrator` do not exist; current runtime is not least-privileged                         |
| Current history         | 24 applied, zero failed/unknown migrations                                                               |
| Only pending migration  | `20261029130000_driver_profile_details`                                                                  |
| Schema conflicts        | None of the 12 new profile columns exists yet                                                            |
| Backup access           | SELECT on all 39 public tables (38 application tables plus `_prisma_migrations`)                         |
| Prisma `migrate status` | Exit 1 reporting that single pending migration; expected pending-state result, not execution failure     |

The table counts refer to different inventories, not lost or duplicated business tables:
**38 application tables + 1 Prisma `_prisma_migrations` history table = 39 public tables**.
The profile-compatibility script applies SQL files directly and counts the 38 application
tables; a Prisma-created database and the backup rehearsal also include the history table.
The new profile migration creates no table, so these counts stay the same before/after it.
Actual staging is still at 24 migrations; the earlier isolated restore rehearsal had 25 local
migrations. Migration count and table count are different measurements.

Three older migration files have local CRLF byte differences. Their LF-normalized contents
and exact blobs at deployed `354007d` match the stored database checksums. This is line-ending
variation, not demonstrated migration-content drift. Do not rewrite deployed migrations or
their stored checksums; use the reviewed Git/Linux release checkout for deployment.

The new migration adds columns, checks, a function and a trigger; it drops no table/column or
financial record. It also **updates profile_version**: approved historical drivers remain v1,
other existing drivers become v2, and new rows default to v2. It protects reviewed identity
fields and prevents v2 downgrade. PostgreSQL 16 compatibility and historical preservation
passed prior independent QA. This is additive schema with a deliberate data transition, not
a promise of risk-free rollback. `ALTER TABLE` needs locks; schedule a quiet write window.
There is no explicit transaction wrapper in the migration file, so any deployment failure
must be treated as potentially partial. Stop and inspect; do not retry or mark resolved blindly.

### Grants decision that must be authorized

The repository's normal architecture is migration/DDL ownership by `mr_migrator`, runtime
`mr_app`, with `02-app-grants.sql` applied immediately after migrations. Profile column grants
are extended; approval/legal-name writes remain protected functions. No engine role is added.

That is **not the current temporary Render role architecture**. Choose explicitly:

1. Retain the existing owner-only configuration for disposable staging under an acknowledged
   temporary exception: run the migration as the existing owner, and **skip the unchanged
   `02-app-grants.sql`**, since its `TO mr_app` target does not exist and the owner already has
   access. This does not establish least privilege or satisfy production role separation.
2. Separately authorize role provisioning/ownership and runtime-credential changes, review
   existing role setup scripts and managed-Postgres capabilities, then apply the grants as the
   authorized owner/migrator. Verify function ownership/EXECUTE, schema access and column grants
   before switching runtime. Keep migration credentials outside Render runtime.

No role is created or changed by this preflight. Do not substitute a broad role name throughout
the grants script, grant arbitrary CRUD, or add migration credentials to the web service.

Strategy A prerequisites: explicit acknowledgement of the owner-role exception, disposable
staging, synthetic accounts/evidence only, Manual KYC false, maintenance agreement and a tested
fresh backup. Risk: a compromised runtime owner has DDL and broad write authority; application
guards do not replace database least privilege. **No real identity documents under this
exception.** Recovery uses the isolated backup clone and separate code-rollback procedure;
owner-level live restoration or data loss is never implicitly authorized.

Strategy B prerequisites: separately approved managed-role provisioning, secure credential
delivery, scoped object/function ownership and privileges, tested runtime grants and an
explicit runtime-connection cutover. `01-roles.sql` is a fresh-database setup aid: by itself it
does not transfer existing owner-held tables, sequences or SECURITY DEFINER functions. Review
those objects and function search paths/EXECUTE grants individually; do not use blanket
ownership reassignment across engine/financial objects. Risk: incomplete ownership/grants can
break bootstrap, audited decisions or financial operations. Prove the change on an isolated
restore first. On failure, stop the cutover, preserve evidence/data and use the approved
configuration recovery; do not silently restore owner-runtime access for real-document use.
Both strategies preserve migration history, financial invariants and existing engine contracts.

## 3. Environment readiness: deployment versus activation

The current Render environment was read in memory and accepted by the current compiled
`loadConfig()` parser. Values were never printed or saved. Existing Firebase project settings
match the engine; the engine key matches a backend `INTERNAL_API_KEYS` entry, and its backend
URL points to this service. Keep those values and all existing financial settings unchanged.

| Configuration                                                                                                                | Current staging state / requirement                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`                                                                               | Set; mandatory startup inputs                                                                                                                       |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `WALLET_TOPUP_MAX_PAISE`, `ADMIN_ADJUSTMENT_MAX_PAISE`  | Mandatory startup inputs; current complete environment validates; no financial settings changed                                                     |
| `INTERNAL_API_KEYS`                                                                                                          | Set and matches engine; needed for internal APIs, though parser allows it absent and then disables them                                             |
| `MANUAL_KYC_ENABLED`                                                                                                         | Explicitly false; preserve this for this deployment                                                                                                 |
| `DOCUMENT_STORAGE_PROVIDER`                                                                                                  | Existing `s3`; preserve                                                                                                                             |
| `DOCUMENT_STORAGE_REGION`, `DOCUMENT_STORAGE_BUCKET`, `DOCUMENT_STORAGE_ACCESS_KEY_ID`, `DOCUMENT_STORAGE_SECRET_ACCESS_KEY` | Set; all required when S3 is selected, even with Manual KYC disabled                                                                                |
| `DOCUMENT_STORAGE_ENDPOINT` / `DOCUMENT_STORAGE_FORCE_PATH_STYLE`                                                            | Native AWS endpoint can remain unset; default path-style false; do not alter the working configuration                                              |
| `DOCUMENT_SCANNER_PROVIDER`                                                                                                  | Existing `guardduty`; preserve                                                                                                                      |
| `GUARDDUTY_EVENT_TOKEN`, `GUARDDUTY_AWS_ACCOUNT_ID`, `GUARDDUTY_REGION`                                                      | Set; required for GuardDuty, even with Manual KYC disabled; token >=32 characters, account 12 digits, scanner/storage region equal                  |
| `DOCUMENT_STORAGE_KMS_KEY_ID`                                                                                                | Not supported/read by this implementation; not a requirement. Code signs and verifies SSE-S3 `AES256`, not SSE-KMS                                  |
| `ONBOARDING_IDENTITY_ENCRYPTION_KEY`                                                                                         | Unset; optional for deployment. Required only for protected licence-number collection/reveal, 64 hex characters. Do not generate a key in this task |
| `ONBOARDING_MINIMUM_AGE`                                                                                                     | Unset; startup optional, but v2 age eligibility stays unknown and final approval is blocked until an authorized value exists                        |
| `MANUAL_KYC_POLICY_VERSION`, `MANUAL_KYC_REQUIRED_DOCUMENTS`, `MANUAL_KYC_CHECKLIST`                                         | Unset; optional while disabled; all required and business-approved before activation                                                                |
| `VEHICLE_REQUIRED_DOCUMENTS_BY_CATEGORY` / legacy `VEHICLE_REQUIRED_DOCUMENTS`                                               | Unset; startup optional. Nonempty approved requirements are necessary for vehicle verification/eligibility; do not invent document lists            |

For later activation, category policy is JSON mapping the five supported category names to
nonempty approved code arrays. Missing categories fail closed. Manual policy/checklist use
unique policy identifiers, and a policy version alone never proves verification. Administrative
identity setup, consent/privacy/retention decisions, minimum age, evidence checklist and live
storage/scanner review remain separate approvals. No admin is provisioned here.

The existing private/versioned S3, SSE-S3, protected GuardDuty tags and authenticated EventBridge
delivery/retry/DLQ contract is preserved. The user reports prior live synthetic-document
verification; no live AWS upload, scan, policy/resource change or secret rotation was repeated
in this task. The backend environment validation is not a new live AWS verification.

Corrections to the supplied QA narrative: actual statuses include driver `SUSPENDED` and KYC
`NEEDS_CORRECTION`; Prisma uses `VehicleVerificationStatus`. The internal engine setting is
`PAYMENT_BACKEND_INTERNAL_API_KEY`, not `BACKEND_INTERNAL_API_KEY`. The engine has its own
`DATABASE_URL` setting; onboarding/financial authority is consumed through authenticated HTTP,
and this task grants it no new backend database access.

## 4. Backup procedure and evidence

Render Free has no managed database recovery, and its free web service lacks shell/one-off
jobs; pre-deploy commands require a paid service. Use an authorized local operator, not build
or start commands. [Free limitations](https://render.com/docs/free),
[pre-deploy availability](https://render.com/docs/deploys#pre-deploy-command),
[backup/recovery](https://render.com/docs/postgresql-backups).

Verified locally using cached `postgres:16-alpine` clients v16.15:

- `pg_dump --format=custom` of the existing isolated synthetic QA database.
- `pg_restore --list` parsed its 794-entry archive.
- Restore into a new empty **local** database with `--no-owner --no-privileges
--single-transaction --exit-on-error` succeeded.
- All 39 tables had matching row counts and deterministic complete-row fingerprints, with
  zero mismatches. All 25 local migration records survived. The local QA container was stopped.
- CA bundle `/etc/ssl/certs/ca-certificates.crt` exists in the cached client image.

**No actual staging backup has been taken or restored.** Before the authorized migration,
create a fresh staging archive, protect it outside Git/logs/shared folders, record its SHA-256,
and restore-test that archive in an access-restricted isolated PG16 database. A readable archive
list alone is not proof of recoverability. Managed-role restrictions must also be checked there.

The destination must be on approved encrypted storage, outside every repository/cloud-synced
shared folder, with a new per-release directory and access limited to the operator/recovery
principal. Review the directory ACL before copying data; an ACL is not encryption. Do not
use the existing public-test-credential QA database to restore real staging/customer data.
The earlier rehearsal used synthetic records only.

Future PowerShell operator setup, with transcript/screen recording off, no literal secret in
history, and an access-restricted/encrypted backup directory prepared outside every repository:

```powershell
# $backupDirectory must already be a new, approved, encrypted/access-restricted directory.
$pgNames = @('PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT')
$previousPg = @{}
foreach ($name in $pgNames) {
  $previousPg[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$secureUrl = $null
$releaseDatabaseUrl = $null
$login = $null
$target = $null
try {
  if (-not (Test-Path -LiteralPath $backupDirectory -PathType Container)) {
    throw 'Prepare and review the private backup directory before continuing'
  }
  $archive = Join-Path $backupDirectory 'pre-profile.dump'
  if (Test-Path -LiteralPath $archive) { throw 'Do not overwrite an existing backup' }
  $secureUrl = Read-Host 'Staging External Database URL' -AsSecureString
  $handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  try { $releaseDatabaseUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle) }
  if (-not [Uri]::TryCreate($releaseDatabaseUrl, [UriKind]::Absolute, [ref]$target)) {
    throw 'Invalid staging connection; stop without displaying its value'
  }
  if ($target.Scheme -notin @('postgres','postgresql') -or
      $target.Host -ne 'dpg-dbdia7hsrm7s73brlpk0-a.oregon-postgres.render.com' -or
      $target.AbsolutePath -ne '/multipleride_j9os') { throw 'Wrong staging database' }
  $login = $target.UserInfo -split ':', 2
  if ($login.Count -ne 2) { throw 'Missing authorized database credentials' }
  $env:PGHOST = $target.Host
  $env:PGPORT = '5432'
  $env:PGDATABASE = 'multipleride_j9os'
  $env:PGUSER = [Uri]::UnescapeDataString($login[0])
  $env:PGPASSWORD = [Uri]::UnescapeDataString($login[1])
  $env:PGSSLMODE = 'verify-full'
  $env:PGSSLROOTCERT = '/etc/ssl/certs/ca-certificates.crt'
  docker run --rm --env PGHOST --env PGPORT --env PGDATABASE --env PGUSER --env PGPASSWORD `
    --env PGSSLMODE --env PGSSLROOTCERT `
    --mount "type=bind,source=$backupDirectory,target=/backup" postgres:16-alpine `
    pg_dump --format=custom --file=/backup/pre-profile.dump
  if ($LASTEXITCODE -ne 0) { throw 'Backup failed; stop release' }
  Get-FileHash -Algorithm SHA256 -LiteralPath $archive
} finally {
  foreach ($name in $pgNames) {
    [Environment]::SetEnvironmentVariable($name, $previousPg[$name], 'Process')
  }
  if ($secureUrl) { $secureUrl.Dispose() }
  $releaseDatabaseUrl = $null
  $login = $null
  $target = $null
  $previousPg = $null
}
```

Capture/validate table counts, migration history, owners, grants and role names as nonsecret
backup metadata. Never dump role password hashes. Back up any approved identity-encryption
key through its existing secret store separately; it is not in a database dump. When finished,
clear/restore task-specific PG environment variables, `$releaseDatabaseUrl`, `$login`,
`$target` and the SecureString; keep no credentials in files. Docker inherits selected variable
names, not literal credentials in command text. On TLS, dump or restore failure, stop; never
disable certificate verification. See [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html).

### Isolated restore verification - before any authorized staging migration

An operator must separately prepare an access-restricted local PG16 restore container using
approved storage and credentials, with no public port or attached application/payment workers.
Use a fresh empty database; never reuse a database containing other work or issue `--clean`.
The following are the same pg_dump/pg_restore mechanics already rehearsed locally, applied
later to the actual private staging archive. They are **not executed by this packaging task**:

```powershell
# Set these to the approved local restore container and its local owner, not staging.
# $backupDirectory still denotes the protected directory containing pre-profile.dump.
$restoreDatabase = 'onboarding_release_restore_test'
docker exec $restoreContainer createdb --host=/var/run/postgresql `
  --username=$restoreOwner $restoreDatabase
if ($LASTEXITCODE -ne 0) { throw 'Restore target must be new and empty; stop' }
docker cp (Join-Path $backupDirectory 'pre-profile.dump') "${restoreContainer}:/tmp/pre-profile.dump"
if ($LASTEXITCODE -ne 0) { throw 'Private archive transfer failed' }
docker exec $restoreContainer pg_restore --host=/var/run/postgresql `
  --username=$restoreOwner --dbname=$restoreDatabase --no-owner --no-privileges `
  --single-transaction --exit-on-error /tmp/pre-profile.dump
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; do not migrate staging' }
docker exec $restoreContainer psql --host=/var/run/postgresql `
  --username=$restoreOwner --dbname=$restoreDatabase -X -v ON_ERROR_STOP=1 -At `
  -c "SELECT current_database(),current_setting('server_version'); SELECT count(*) FROM pg_tables WHERE schemaname='public'; SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"
```

Expected pre-migration staging restore: PG16, **39 public tables / 24 applied migrations**.
Compare table/column/type/constraint/trigger/index/function inventories and every table's
row count against the backup checkpoint. Include existing customer, driver, booking, payment,
collection and wallet/ledger tables. Deterministic per-table row fingerprints provide stronger
evidence (the synthetic rehearsal compared all 39). Keep writes quiet while recording/checking
the checkpoint so concurrent changes do not create false mismatches. Capture no row contents
or sensitive data in QA logs. Preserve original owner/grant metadata: `--no-owner
--no-privileges` is for isolated validation, not a ready-made production permission scheme.
Any failed schema/row/history/restore check blocks the migration. Verify the archive SHA-256
again before recovery and keep its protected location/retention and responsible operator in
the release record. Never restore directly over the live database as a verification step.

## 5. API and application compatibility

| Area                    | Compatibility / required check                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase/bootstrap      | Existing customer/driver routes remain; no new login system; Batch 1 only adds admin session/CLI security                                                                                                              |
| Customer/financial APIs | No source changes since deployed `354007d` in customer registration, booking assignment, fare, payments, collections, wallet, refunds or payouts; regression evidence is linked below                                  |
| Profile                 | New app sends `profileVersion:2` plus name, DOB, email, address, city, state and PIN; requires new backend/migration. Old name-only requests stay accepted as partial saves, not v2 completion                         |
| Historical drivers      | Already-approved v1 accounts retain compatibility subject to real KYC/vehicle/document eligibility; pending/new v2 accounts cannot finish using only an old app's name form                                            |
| Category / summary      | New `PATCH /v1/drivers/me/onboarding/vehicle-category`; summary adds profile/capabilities/categories/category policy; additions preserve previous summary fields                                                       |
| Documents               | Existing initiation/completion routes retained; version-bound owner preview added; stronger magic-byte/integrity and early-GuardDuty recovery checks are intentional security tightening                               |
| Restricted dashboard    | New app uses backend `eligible` and approval state; pending/suspended/rejected states do not unlock operational Home                                                                                                   |
| Admin                   | Add `GET /v1/admin/session` and audited licence reveal with reason; existing review APIs remain guarded. Browser origin PATCH preflight support is included; no admin frontend edits                                   |
| Internal eligibility    | Same `GET /v1/internal/drivers/by-subject/:subject/eligibility`, `X-Internal-Api-Key`, `X-Request-Id`, subject binding and authoritative boolean/reasons; v2 profile rules tighten the decision, not the wire contract |

Deploy the new backend/migration before distributing the new Driver APK. Against the old backend,
new category/preview routes are absent and detailed-profile DTO fields are rejected; UI shows an
upgrade/unavailable error. The new APK is present at
`PickUp/android/app/build/outputs/apk/release/app-release.apk`, 36,312,272 bytes, SHA-256
`01F40EC6D78A61195A5B6A824B4739DD0DEE1B547CA6EEB25E5FD6253347A6E6`.
It is the previously verified debug-key-signed release variant for internal testing.

**Engine release gap:** Render `pickup-engine` (`srv-dbd3toui0phs73eks1m0`) is linked to
`raj_engine` but actually runs `a52e35083d9f7395ea043c082f70f266ad4654ba`, before local
`63d69dc` Phase 2B. Its Auto-Deploy is on. No engine configuration or code was changed.
Backend final assignment checks exist, but do not claim deployed ONLINE/offer/acceptance
eligibility enforcement or complete staging E2E until an explicitly authorized engine rollout
and QA verify it. This is separate from a disabled-KYC backend staging deployment.

## 6. Gated rollout — future authorized operations only

| Step                       | Prerequisite / action                                                                                                                                                                                  | Stop condition                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1. Approve scope           | Review the two commit manifests, exclusions, role exception/role-separation choice and preserved work                                                                                                  | Scope or role choice not authorized                                                                                    |
| 2. Prepare commits         | Create a new local release branch; stage explicit paths; preserve other worktrees/stash; record final SHA                                                                                              | Secret/unrelated/generated file staged, missing migration/test helper, or unreviewed diff                              |
| 3. Revalidate candidate    | Clean release checkout; existing QA commands and PG16 migration/least-privilege checks on the exact final SHA                                                                                          | Any test/build/typecheck failure or mismatch from approved tree                                                        |
| 4. Confirm remote/Render   | Fetch only when authorized; require expected ancestry and linked repo/branch, Auto-Deploy off, existing build/start and Node settings                                                                  | New remote commits, changed deployment source, auto-deploy enabled, or build/start runs migrations                     |
| 5. Confirm database/window | Identity-check owner/roles/history/checksums, zero failed migrations, exactly this one pending; arrange quiet writes/long-transaction review                                                           | Wrong target, genuine checksum drift, unexpected columns/migrations, blocking transactions or no maintenance agreement |
| 6. Back up                 | Fresh private staging archive and metadata; isolated restore proof; preserve current deploy/config references                                                                                          | Missing/unreadable/unrestorable backup or insufficient privileges                                                      |
| 7. Publish candidate       | Only with push approval, ordinary fast-forward push to `origin/raj_backend`; verify full remote SHA; no force                                                                                          | Ancestry changed or unexpected files in commits; Auto-Deploy must stay off                                             |
| 8. Migrate                 | From exact reviewed release checkout on authorized operator machine, process-only owner/migrator URL; run status, then `npx prisma migrate deploy`, then status                                        | Any migration error/partial application; stop before grants/deploy; never reset/delete/recreate                        |
| 9. Grants                  | Owner-only temporary exception: skip. Separately authorized split roles: apply `02-app-grants.sql` as authorized owner/migrator with ON_ERROR_STOP and a single transaction; verify runtime privileges | Missing `mr_app`, wrong ownership, denied grants, or runtime still using an unintended privileged role                 |
| 10. Deploy backend         | Explicit deployment approval; confirm 25 applied/zero pending/failed; Manual KYC false; deploy exact recorded SHA                                                                                      | Missing migration/grants, source/env mismatch, health/startup failure                                                  |
| 11. Smoke/auth             | Check live and ready; driver/customer existing login/bootstrap, partial/v2 profile, protected admin session, pending/unavailable states, owner/foreign document access                                 | Auth regression, false approval/clean upload, document disclosure or existing Customer failure                         |
| 12. Engine                 | Preserve URL/auth project/key; obtain separate engine rollout authorization for Phase 2B and verify eligibility contract                                                                               | Engine still old, key mismatch/outage permits new assignments, or in-progress trips regress                            |
| 13. Device QA              | Exact APK/backend pair; real Firebase login, profile/resume/category/status/restricted Home; record both old/new app behavior                                                                          | Unsupported contract, Metro requirement, crash, or locally fabricated eligibility                                      |
| 14. Activation             | Separate approved policy/admin/security/live-document/E2E work; remain disabled for this release                                                                                                       | Missing approved checklist/requirements/age, admin, secure evidence or end-to-end proof                                |

Future migration commands, after backup/authorization, from the **release checkout**:

```text
# DATABASE_URL is process-only, from the verified external owner/migrator connection.
# External Prisma TLS was read-only validated with sslmode=require&sslaccept=strict.
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status
# Expected final: all 25 migrations applied, none failed/pending.
```

For an approved split-role environment only, the standard grants command is:

```text
psql -X -v ON_ERROR_STOP=1 --single-transaction -f prisma/sql/02-app-grants.sql
```

Use the authorized connection through process PG variables; current machine has no native
`psql`, so the practical equivalent is the verified PG16 container client:

```powershell
# $releaseCheckout is the reviewed clean checkout; PG variables identify the approved migrator.
docker run --rm --env PGHOST --env PGPORT --env PGDATABASE --env PGUSER --env PGPASSWORD `
  --env PGSSLMODE --env PGSSLROOTCERT `
  --mount "type=bind,source=$releaseCheckout,target=/release,readonly" `
  --workdir /release postgres:16-alpine `
  psql -X -v ON_ERROR_STOP=1 --single-transaction -f prisma/sql/02-app-grants.sql
if ($LASTEXITCODE -ne 0) { throw 'Grants failed; stop release' }
```

**Do not execute this against the current owner-only staging architecture.** No migration role
credential goes into Render runtime.

Future exact-SHA deployment (help/flag verified with installed CLI, not executed):

```text
render deploys create srv-dak1466k1f9s73ajo6c0 --commit <APPROVED_FULL_RELEASE_SHA> --wait --output json
```

CLI exact-commit deployment does not turn off Auto-Deploy automatically; its already-off state
must remain confirmed. Dashboard Manual Deploy > Deploy a specific commit is the alternative.
[Render deploy behavior](https://render.com/docs/deploys#deploying-a-specific-commit).

Do not sync the current `render.yaml` as a Blueprint: it still names older service/database
resources and contains migrations in build. The actual service configuration above is already
correct. No YAML/config refactor was made in this preparation task; reconcile that stale
Blueprint in an explicitly reviewed future configuration change before anyone uses it.

## 7. Application rollback versus database recovery

Application rollback: record current deploy `dep-dbgvbk08v5cc73flc3ng` / commit `354007d` and
the configuration references before release. If the new backend fails smoke tests, stop new
onboarding/review/assignment writes and invoke the approved rollback to that deploy's retained
artifact, if still available. Keep Auto-Deploy off and Manual KYC false; account for rollback
environment behavior and separately backed-up encryption keys. Recheck customer auth, readiness,
internal final assignment and restricted driver access. Old code does not enforce the new v2
profile semantics: do not claim functional/security parity or continue new onboarding blindly.
Pause the new APK rollout. [Render rollback behavior](https://render.com/docs/rollbacks).

Database recovery: a code rollback leaves the profile columns, version transition, checks and
identity trigger in place. There is no reviewed down migration. Do not drop columns, remove
triggers, downgrade profile versions, edit migration history or restore over live data as an
automatic rollback. On migration failure, inspect partial DDL/history privately and prefer a
reviewed forward correction. If restoration is required, restore the tested pre-release archive
to an isolated recovery database first and compare schema, rows, grants and financial records.
Any destructive restore or connection cutover needs separate authorization and an explicit
decision about writes since the backup; existing payments/ledger records must not be silently
lost. Retain S3 object versions and GuardDuty evidence; do not fabricate/relabel scans after
recovery. No cloud recovery database or AWS resource was created here.

## 8. Evidence, remaining gates and handoff

Completed-preflight read-only live probes: `/health/live` 200, `/health/ready` 200;
`GET /v1/admin/session` 404 on the old deploy, consistent with missing Batch 1;
authenticated unknown-subject eligibility GET 404 `DRIVER_NOT_FOUND`. Config parser PASS;
TLS/read-only database metadata PASS; Prisma status correctly reports the pending migration.
An initial health attempt timed out during Free-service warmup; subsequent probes passed.
This proves existing health/authenticated routing, not positive real-driver assignment or UAT.

Fresh verification of the packaged code/test commit `a815cce`, using Node 24.21.0:

| Check                                                     | Packaging result                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma validation and normal build-time client generation | PASS                                                                                                                                              |
| Production `npm run build`                                | PASS                                                                                                                                              |
| Backend TypeScript                                        | PASS                                                                                                                                              |
| All unit tests                                            | 540/540, 45/45 suites PASS                                                                                                                        |
| Complete integration suite                                | 542/542, 26/26 suites PASS; zero failures/skips                                                                                                   |
| Changed-file ESLint, 35 TypeScript files                  | PASS                                                                                                                                              |
| Git diff/secret/scope checks                              | PASS; no financial runtime or historical migration changes                                                                                        |
| PG16 profile migration compatibility                      | PASS: 24 baseline migrations + new migration; 38 application tables preserved; historical approved v1/pending-new v2 and downgrade guard verified |
| Documented PowerShell snippets                            | Three code blocks parsed successfully; commands not executed                                                                                      |

The final documentation commit changes only the four manifest-listed Markdown files; code,
migration and tests remain exactly those validated above. Local integration ran on a fresh,
dedicated PostgreSQL **16.15** container `multipleride-release-package-pg16`, loopback port 5551,
database `backend_package_test`. An initial setup attempt on the older preserved QA cluster
stopped because a shared test role had dependencies in another QA database. No dependency was
dropped or test rule weakened: a fresh container resolved the isolation issue, and the entire
suite then passed. Role/grant fixtures and migrations ran only in disposable local tests.
The existing QA/backup container and databases were preserved. A pg query-concurrency
deprecation warning remains; it did not fail tests and is outside this packaging scope.

Local result artifacts (not committed): `C:/multiple_ride/.tmp/backend-packaged-unit.json`,
`backend-packaged-integration.json` and `backend-packaged-lint.log`. Prior independent Driver
tests remain 194/194; no Driver tests/build or device UAT was rerun in this backend-only task.
The completed synthetic backup rehearsal still proves all 39 table fingerprints; an actual
staging archive remains required and was not created here. See the fixture QA report for
per-suite coverage. No financial business rule or runtime source was rewritten for packaging.

Remaining release gates: explicit publication authorization for the final candidate, fresh
staging backup with isolated restore proof, explicit temporary-owner exception or approved
split-role setup, authorized migration and manual exact-SHA deployment. Operational KYC needs
its separate approved configuration/admin/security QA.
Full staging driver dispatch needs the separately authorized Phase 2B engine rollout. The Free
database reports expiry **2026-11-22 09:13:02 UTC**; plan preservation before then without
implicitly authorizing a paid service. No implementation rewrite is required for this preflight.

Verdict: **staging preparation complete; release execution remains gated by authorization and
the recorded prerequisites. No deployment or production-readiness claim.**
