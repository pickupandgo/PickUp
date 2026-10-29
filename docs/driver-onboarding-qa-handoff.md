# Professional driver onboarding — independent QA handover

Date: 2026-10-29. Backend code and regression fixtures are packaged as local commits on
`codex/professional-onboarding-staging`, preserving source branch `codex/admin-api-batch1`.
Driver `raj_driver` changes remain uncommitted and are not part of the backend release.
No backend push/deployment, live database, AWS/Render change or real administrator provisioning
occurred. Manual KYC stays disabled. The results below describe the original implementation
checkpoint; see `staging-professional-onboarding-release.md` for final candidate validation,
PostgreSQL 16 results, the exact file manifests and current staging role/backup requirements.

## Delivered UI and fidelity

The Driver app now has Personal Information, Vehicle Type, Identity Verification, Vehicle
Details/Documents, Review & Submit, Verification Status, and a restricted Home/Profile/Help
experience. It follows the supplied composition: compact centered header/back/help, white
rounded document cards, original Material icons, status badges, red correction panels,
amber scan/review states, green verification, camera/gallery placeholders, actual transferred-
byte progress and black primary buttons. Scroll/safe area/keyboard handling is responsive;
no fixed screen-sized absolute layout. JCB/Crane were not added. Photograph cards come only
from the approved policy codes. Manufacturer/model continue using the existing combined field.

This is structural/design implementation, not a claim of pixel-perfect emulator or physical
device verification. The prior emulator task remains blocked by host disk capacity. Existing
release settings target arm64-v8a; native x86_64-emulator testing would need a separate compatible
artifact. Physical camera/gallery flows, small-screen layout, private preview and Android cache
cleanup require QA on a device. The new app requires the compatible backend/migration before
the detailed-profile features can operate against staging.

## Automated results

- Node v24.21.0 (compatible with backend >=22.12), JDK 17 for Android.
- Prisma schema validation and client generation: PASS.
- Backend and Driver TypeScript checks: PASS.
- Backend unit tests: 540/540, 45 suites PASS (includes auth, onboarding, storage and GuardDuty).
- Driver tests: 194/194, 17 suites PASS (including document presentation, actual progress
  transport, camera cancellation, navigation and restricted dashboard).
- Isolated PostgreSQL integration/regressions: 165/165, five suites PASS:
  `onboarding-profile`, `onboarding-workflow`, `auth`, `drivers`, `least-privilege`.
- The workflow test uses real Nest HTTP guards/validation, PostgreSQL and application-role
  grants. AWS transport is explicitly synthetic. It covers clean/infected evidence, duplicate
  and early scan delivery, version binding, concurrent initiation/completion, unauthorized
  previews, manual checklist, protected profile, vehicle verification, separate final approval,
  suspension, authorized correction and reverification, and OpenAPI route/schema generation.
- Migration compatibility test: 24 prior migrations plus the new additive migration applied
  successfully to a separate empty local test database, with synthetic drivers inserted before
  the new migration. All 38 pre-existing tables and driver names survived; approved records
  remain v1, pending/new accounts require v2, and downgrade protection passed.
- PostgreSQL used for these runs: cached local `postgres:17-alpine`. Repeat migration/flows
  on PostgreSQL 16 in isolated QA before the planned staging rollout.
- Backend production build and Driver Gradle release build passed. The final artifact is
  self-contained and signature-verified (details below).
- Changed-file lint: backend PASS; Driver PASS, zero errors / 22 advisory warnings. Full Driver
  lint reported 39 errors in untouched files; backend full lint reports 73 untouched existing
  errors. Committed HEAD versions of `App.tsx` and `auth.guard.spec.ts` independently reproduce
  lint failures. No lint rules or tests were disabled. Changed Driver files retain advisory
  no-void/inline-style warnings. Resolve the unrelated lint backlog in a separately scoped task.
- Observed pre-existing pg query-concurrency deprecation warning in integration fixtures;
  tests still passed. Gradle/Metro emitted dependency export/color warnings; build passed.

The historical financial regression fixtures were updated to have synthetic verified KYC and
vehicle evidence, rather than changing assignment authorization to accept approval alone.
No financial business rules were edited.

## Database and security

Migration: `prisma/migrations/20261029130000_driver_profile_details/migration.sql`.
Only additive Driver fields/constraints and a profile-identity guard trigger; no historical
migration was edited. New fields cover DOB, optional gender, address/city/state/PIN, category
draft, encrypted optional licence metadata, expiry/classes and the profile contract version.
Age is calculated per request. Approved historical profiles retain compatibility; pending/new
accounts need the full profile. A client cannot downgrade that requirement. The shared grants
script adds only the required driver-profile column grants.

Drivers cannot approve themselves or submit trusted identity/approval fields. Profile updates,
submission, document initiation/completion and sensitive reviews serialize on the driver then
parent record; database uniqueness still protects active vehicles, open KYC and replacements.
Latest required document versions determine readiness. Clean scans remain distinct from human
verification. Current KYC replaces any older verified-record fallback for authorization.
Authorized identity correction revokes current approval, preserves suspension and requires
reverification plus a separate final decision.

Private S3 references are never exposed as permanent URLs. Temporary owner previews and admin
downloads are pinned to the stored object version and require clean evidence; foreign/unsafe
owner access returns 404. GuardDuty early-result recovery authenticates the original event,
preserves its binding and repeats trusted S3 verification before trust. Interrupted confirmation
can be retried without faking upload/scan completion. JPEG/PNG/PDF magic bytes and server-derived
SHA-256 supplement existing metadata/size/encryption checks.

Optional licence data uses AES-256-GCM with a randomized nonce and driver-bound authenticated
data. Only a separately audited ADMIN reveal with a reason returns the full number. Ordinary
driver/admin summaries contain the last four only. Neither a raw Aadhaar field nor face
recognition was added. Picker copies stay in private cache, are deleted after use, and stale
picker copies are pruned after 24 hours; user gallery originals are never deleted.

## Exact code/document inventory

Backend:

- `prisma/schema.prisma`, new migration above, `prisma/sql/02-app-grants.sql`.
- `src/config/app-config.ts`, `src/config/env.schema.ts`.
- `src/bootstrap/configure-app.ts` (admin-origin PATCH preflight support).
- `src/onboarding/onboarding.controller.ts`, `admin-onboarding.controller.ts`,
  `onboarding.dto.ts`, `onboarding.responses.ts`, `onboarding.service.ts`.
- `src/onboarding/profile-policy.ts`, `profile-policy.spec.ts`.
- `src/onboarding/document-storage.service.ts`, `document-storage.service.spec.ts`.
- `src/onboarding/guardduty-scan.service.ts`, `guardduty-scan.service.spec.ts`,
  `onboarding.service.spec.ts`.
- `src/cli/provision-commands.ts` (explicit historical version in the existing isolated E2E fixture only).
- `test/helpers/fixtures.ts`, `test/helpers/onboarding-fixtures.ts`.
- `test/integration/onboarding-profile.int-spec.ts`, `onboarding-workflow.int-spec.ts`,
  `least-privilege.int-spec.ts` (compliant test provisioning only).
- `test/migration/check-driver-profile.mjs` (refuses non-local/non-dedicated/non-empty databases).
- `docs/driver-onboarding-professional.md`, this handover; workspace `CODEX_MEMORY.md` checkpoint.

Driver:

- `src/screens/onboarding/DriverOnboardingFlow.tsx`, `OnboardingControls.tsx`.
- `src/screens/auth/DriverOnboardingScreen.tsx` (compatibility re-export).
- `src/services/onboarding/DriverOnboardingService.ts`, `onboardingPresentation.ts`.
- `src/navigation/RootNavigator.tsx` (authoritative refresh without remount/reset).
- `android/app/src/main/java/com/com.pickup.driver/MainApplication.kt`, `OnboardingFilesPackage.kt`.
- `__tests__/driverOnboarding.test.tsx`, `onboardingFlow.test.tsx`, `onboardingUpload.test.ts`.

Pre-existing untracked backend `scripts/`, the Customer integration Maps/UI changes, Customer
stash/backup branches and all other repositories remain preserved. No .env/signing/Firebase
credential changes were made.

## APIs and staging activation

See `driver-onboarding-professional.md` for exact driver/admin paths, schemas, policy configuration
and deployment order. New routes are category draft, owner preview and audited admin licence
reveal. Existing profile/summary/upload/admin review routes were extended compatibly. Swagger
UI `/docs`, JSON `/docs/openapi.json`, when explicitly enabled. Internal backend-to-engine
eligibility paths and response shape remain compatible; the engine accepts string reasons and
continues to authorize ONLINE, offers and assignment. No engine source was changed and the
historical 594-check live-service harness was not rerun in this task.

Required before staging activation:

1. Approve minimum age, identity alternatives/portrait/licence requirements, masking, consent,
   lawful collection/retention and category-specific vehicle/ownership policies.
2. Review/apply the additive migration and shared grants using the authorized migration role;
   deploy the compatible backend before distributing the app. No migration against live data
   was performed by Codex.
3. Configure server-only encryption if licence numbers are to be collected; maintain secure
   key backup and an explicit rotation/re-encryption plan.
4. Verify private versioned S3, encryption, least-privilege IAM, protected GuardDuty result tags,
   authenticated EventBridge delivery, retries/DLQ and outages with approved synthetic staging files.
5. Authorized operator provisions the staging administrator separately. Review actual documents,
   complete checklist, verify vehicle, approve driver separately, and prove engine eligibility
   including revocation/suspension during assignment.
6. Only after these dependencies pass may the authorized team enable Manual KYC. It remains false now.

## Internal testing APK

`C:\multiple_ride\PickUp\android\app\build\outputs\apk\release\app-release.apk`

- Package: `com.multipleride.driver`; arm64-v8a; versionCode 1/version 1.0 (unchanged).
- SHA-256: `01F40EC6D78A61195A5B6A824B4739DD0DEE1B547CA6EEB25E5FD6253347A6E6`.
- 36,312,272 bytes; bundled JS present; runs without a Metro development server by artifact configuration.
- Signature: APK v2 verified; existing `CN=Android Debug` certificate.
- Certificate SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Internal testing release variant; not production-distribution signing. Native runtime/device
  behavior still needs physical-phone UAT. Customer APK was not rebuilt for this Driver-only change.
