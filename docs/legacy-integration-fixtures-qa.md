# Legacy integration fixture repair — QA handoff

Date: 2026-10-29. Original fixture repair ran on `codex/admin-api-batch1`. That reviewed code
is now packaged locally on `codex/professional-onboarding-staging`, without a push/deployment.
See `staging-professional-onboarding-release.md` for commit manifests and final candidate checks.

## Reproduced causes

The starting working tree reproduced **201 failing tests in 13 of 26 suites**, with 333
passing tests (534 total). These are Jest test-case counts, not individual assertion counts;
they differ from Antigravity's earlier reported run. Every failure message was inspected.

- 199 failures stopped at the `assignDriver` helper: expected HTTP 200, received 422.
  Legacy `createDriver()` fixtures had an approval flag but no verified KYC/vehicle evidence.
  The production eligibility rejection was correct.
- One negative assignment test expected obsolete `DRIVER_NOT_APPROVED`; the current endpoint
  correctly returns `DRIVER_NOT_ELIGIBLE` with eligibility reasons.
- One multi-collection reconciliation test found zero earnings because its preceding booking
  setups had failed. This was a secondary failure, not a reconciliation/business-rule defect.

No additional production defect was demonstrated or production change required.

## Fixture changes

`createHistoricalEligibleDriver()` explicitly creates synthetic historical-v1 compliance
records in the isolated database: ACTIVE account, PENDING driver, configured verified KYC
evidence/checklist/reviewer, active verified vehicle and configured verified vehicle evidence.
Approval follows evidence through the existing audited database functions; its timestamp is
after KYC/vehicle verification. The completed fixture must pass the real production
`OnboardingService.eligibility()` implementation. No eligibility check is mocked or disabled.

The fixture derives required documents from the actual test configuration, including
category-specific requirements, and refuses an empty policy. The default test policy uses
explicitly synthetic `TEST_ID` and `TEST_RC` codes; it does not enable manual KYC or modify
runtime configuration. No AWS objects, real documents or real administrators are created.
Ordinary `createDriver()` remains incomplete, preserving negative/authentication fixtures.
Pending-driver and missing-legal-name cases retain that ordinary factory.

Eight new assignment cases assert HTTP 422, the relevant authoritative reason, no trip row
and unchanged booking status: unverified identity, pending KYC, missing verified vehicle,
suspension, required reverification, expired KYC, revoked vehicle evidence and inactive
account. Suspension/correction use protected admin HTTP operations with synthetic identities.
Historical expiry/revocation states use the isolated test database owner. The positive case
also asserts the internal eligibility response before assignment and idempotent retry.

## Exact files changed in this task

- `test/helpers/onboarding-fixtures.ts`
- `test/helpers/test-config.ts`
- `test/integration/booking-payments.int-spec.ts`
- `test/integration/booking-registration.int-spec.ts`
- `test/integration/collections.int-spec.ts`
- `test/integration/delivery-stops.int-spec.ts`
- `test/integration/fee-rules.int-spec.ts`
- `test/integration/legacy-bookings.int-spec.ts`
- `test/integration/multi-collection-earnings.int-spec.ts`
- `test/integration/payouts.int-spec.ts`
- `test/integration/pickup-payment.int-spec.ts`
- `test/integration/refunds.int-spec.ts`
- `test/integration/stop-collections.int-spec.ts`
- `test/integration/stop-obligation-schema.int-spec.ts`
- `test/integration/trips-earnings.int-spec.ts`
- `docs/legacy-integration-fixtures-qa.md`
- Workspace `C:/multiple_ride/CODEX_MEMORY.md`

Existing changes to `test/helpers/fixtures.ts`, `least-privilege.int-spec.ts`, professional
onboarding source/schema/grants/migration, Driver UI and untracked `scripts/` were preserved.
No engine, Customer App, admin frontend, production eligibility/assignment or financial logic
was changed. A before/after SHA-256 inventory of all backend `src`/`prisma` files excluding
generated Prisma code matched exactly:
`CFD0647E01E77EDEDD7052FDFD81AA8B18BFCB3A6A1551A6AC19B2658DD35487`.
Prisma generation and build refreshed ignored generated/build artifacts only.

## Validation actually executed

Runtime: **Node v24.21.0**. Database: **PostgreSQL 16.15**, disposable local Docker container
`multipleride-legacy-qa-pg16`, loopback port 5550. No live database connection was used.

| Check                                               | Result                          |
| --------------------------------------------------- | ------------------------------- |
| Prisma validation                                   | PASS                            |
| Prisma generation (normal build)                    | PASS                            |
| TypeScript `tsc -p tsconfig.json --noEmit`          | PASS                            |
| Production `npm run build`                          | PASS                            |
| All backend unit tests                              | 540/540, 45/45 suites PASS      |
| Complete integration suite                          | 542/542, 26/26 suites PASS      |
| Skipped/failed tests in final unit/integration runs | 0/0                             |
| ESLint on all 15 changed TypeScript files           | PASS                            |
| `git diff --check`                                  | PASS                            |
| Fresh migration installation/status on PG16         | 25 applied, zero failed/pending |
| Historical profile migration compatibility          | PASS                            |

The independent migration check used another empty local database,
`legacy_profile_migration_test`. It applied 24 prior migrations, inserted historical drivers,
then applied `20261029130000_driver_profile_details`. All 38 prior table names survived,
historical driver names/approved-v1 compatibility were preserved, pending/new drivers require
v2, and contract downgrade was rejected. No deployed migration was edited. The integration
setup also applies the shared grants to its restricted test role; the full least-privilege
suite below exercises those privileges.

Final integration results:

| Suite                     |  Passed |
| ------------------------- | ------: |
| stop-collections          |      24 |
| refunds                   |      36 |
| multi-collection-earnings |      24 |
| payouts                   |      29 |
| booking-registration      |      29 |
| pickup-payment            |      17 |
| collections               |      18 |
| stop-obligation-schema    |      19 |
| delivery-stops            |      13 |
| trips-earnings            |      22 |
| booking-payments          |      13 |
| legacy-bookings           |       8 |
| fee-rules                 |       7 |
| least-privilege           |     113 |
| legacy-migration          |       7 |
| fare                      |      23 |
| webhooks                  |      15 |
| onboarding-workflow       |       6 |
| top-ups                   |      24 |
| wallet-ledger             |      14 |
| onboarding-profile        |      16 |
| admin                     |      18 |
| drivers                   |       9 |
| provisioning              |       7 |
| customers                 |      10 |
| auth                      |      21 |
| **Total**                 | **542** |

The full 540-unit run includes existing token verification, auth guards, admin session/CLI,
onboarding/profile, document-storage and GuardDuty tests. The workflow integration uses real
HTTP guards, state transitions and PostgreSQL; AWS transport is synthetic. Financial suites
continue asserting exact paise, append-only ledger, settlements, refunds, payouts, payment gates,
idempotency and concurrency invariants with eligible drivers.

Commands (run from `raj_backend`, using the isolated Node runtime and local test URL):

```text
node node_modules/prisma/build/index.js validate
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
npm run build
node node_modules/jest/bin/jest.js --runInBand --silent --json --outputFile=<local-unit-report>
node node_modules/jest/bin/jest.js --config test/jest-integration.json --runInBand --silent --json --outputFile=<local-integration-report>
node node_modules/prisma/build/index.js migrate status
node test/migration/check-driver-profile.mjs
node node_modules/eslint/bin/eslint.js <the 15 changed TypeScript paths above>
```

Use only a disposable local `*_test` database for integration setup, which resets its public
schema. The profile check requires a separate empty local `*_profile_migration_test` database
and `NODE_ENV=test`. Never substitute the development, Render or production URL.
Local evidence: `C:/multiple_ride/.tmp/legacy-integration-baseline.json`,
`legacy-integration-after-fixtures.json`, and `legacy-unit-final.json`. These are local reports,
not deployment artifacts or committed files. The disposable QA container is stopped after use.

Git operations were read-only status, branch inspection and diff/stat/numstat/check commands,
with a per-command safe-directory override. No staging, commit, fetch, push, merge or reset.

## Staging compatibility and remaining activation requirements

- No Render setting/deployment, live PostgreSQL schema, AWS resource, credential or EventBridge
  token was changed. No real administrator was provisioned. Local `.env` was not edited and
  `MANUAL_KYC_ENABLED=false` remains in effect.
- Existing local S3 and GuardDuty configuration fields are populated. Their values were not
  printed. The user reports the staging live synthetic-document integration previously passed;
  this task does not repeat or supersede that live verification, or rotate its working tokens.
- Approved minimum age, manual policy version/required documents/checklist, category document
  requirements and optional identity encryption key are unset locally. These are independent
  activation prerequisites, not reasons to change working S3/GuardDuty configuration. Optional
  protected licence collection remains disabled without its key. Do not invent policy values.
- The additive profile migration remains local and ready for independent review. For an
  authorized staging rollout, review/back up the target first, use the authorized migration
  role for `prisma migrate deploy`, then apply `prisma/sql/02-app-grants.sql` using the role
  permitted to grant runtime privileges. Keep runtime least-privileged; do not blindly apply
  grants for a nonexistent role in the temporary owner-only Render database.
- Existing configuration/security contracts are in `docs/driver-onboarding-professional.md`
  and `docs/AWS_GUARDDUTY_S3.md`. Preserve current bucket, private/versioned storage, GuardDuty,
  EventBridge delivery/authentication and token values. Approval remains disabled until the
  approved business policy and security prerequisites are independently authorized.
- No failing test or newly demonstrated production defect remains from this task. Prior
  whole-repository lint backlog is outside scope; this is a changed-file lint result. This run
  does not claim physical-device UAT, live AWS/onboarding success or production readiness.

Recommendation: **ready for independent Antigravity revalidation of this fixture repair**.
Re-run the complete 26-suite PG16 integration command and review the eight negative assignment
cases, historical-v1 fixture compatibility, restricted-role grants and additive migration.
Deployment and any staging activation remain separately authorized work.
