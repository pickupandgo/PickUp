# Driver onboarding contract and QA checkpoint

Backend release packaging is now local on `codex/professional-onboarding-staging`, based on
Admin Batch 1 `88a08ee`. The Driver UI remains separate, uncommitted work; no mobile files are
part of this backend candidate. Nothing is pushed or deployed and Manual KYC remains disabled.
See `staging-professional-onboarding-release.md` for commit manifests, actual owner-role staging
exceptions and the gated backup/migration/recovery procedure. Its role-specific guidance takes
precedence over generic migrator/grants setup examples below.

## Stage A: implementation boundary

Existing: Firebase bootstrap; authenticated self-onboarding; S3 version-bound uploads;
GuardDuty quarantine; admin-only evidence retrieval, reviews and audited decisions;
atomic vehicle replacement; authoritative backend/engine eligibility.

Additive work: detailed personal profile, computed age (no stored age), encrypted optional
licence data, persisted category-only draft, category-specific document policy, safe
owner previews, scan/review timestamps, multi-screen mobile onboarding and restricted
pre-approval dashboard. Existing name-only clients remain supported. Full-profile saves
opt an existing driver into profile contract version 2; new database records default to v2.
The migration preserves approved historical profiles, and requires v2 for pending accounts.
A name-only legacy request may save a name
for a new account, but cannot complete its v2 profile, downgrade its contract or authorize it.

UI: Personal information -> Vehicle type -> Identity verification -> Vehicle details ->
Review -> Verification status. Restricted Home/Profile/Help remain available. Operational
tabs are absent from this restricted navigator. Engine/backend still authorize all work.

Policy NOT approved: minimum driving age; accepted identity alternatives and consent/
retention; portrait requirements; category-specific insurance/PUC/permit evidence; RC
owner authorization. No Aadhaar-number field is introduced. Photo comparison is manual.
Manual KYC stays disabled until approved policy and security infrastructure are verified.

## Additive configuration (values must be approved separately)

- `ONBOARDING_MINIMUM_AGE`: integer 1..100; unset means age eligibility is unknown and
  version-2 profiles cannot receive final approval.
- `ONBOARDING_IDENTITY_ENCRYPTION_KEY`: 64 hex characters, server-only AES-256-GCM key.
  Optional licence-number collection/reveal is disabled without it. Back up keys securely;
  do not rotate without a ciphertext re-encryption plan. No plaintext number in summaries.
- `VEHICLE_REQUIRED_DOCUMENTS_BY_CATEGORY`: JSON object mapping the five supported
  categories to arrays of approved document codes. If supplied, missing categories are
  disabled for verification; no global-list fallback. Without it the legacy
  `VEHICLE_REQUIRED_DOCUMENTS` continues unchanged for older deployments.
- Existing manual KYC policy/checklist, storage and scanner configuration remain required.

New nullable profile columns and a version flag preserve registered drivers. Apply the new
migration with the migrator, then the shared grants script, before deploying code. No live
database changes are part of this task.

## Driver HTTP contract

Firebase bearer authentication and DRIVER role are mandatory for every self route. All
resource ownership is resolved from that principal. Existing endpoint paths are unchanged.

| Method and path (`/v1/drivers/me/onboarding`)                                       | Request / response                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/`                                                                             | Existing summary plus `profile`, `capabilities`, supported categories, selected category and per-category document lists                          |
| PATCH `/profile`                                                                    | Legacy `{name}` or detailed payload below. Returns existing `id`, `profileName`, `updatedAt` plus `saved:true`. Read summary again for completion |
| PATCH `/vehicle-category`                                                           | `{category}`. Persists only a preference, never an incomplete Vehicle or a verified vehicle mutation                                              |
| GET `/documents/:kind/:documentId/preview`                                          | `kind=KYC                                                                                                                                         | VEHICLE`. Owner only, clean scanned evidence only. Short-lived version-pinned URL and content type; 404 for missing, foreign or unsafe evidence |
| POST `/kyc`                                                                         | Start/resume actual KYC application; 503 while unavailable                                                                                        |
| POST `/kyc/:id/documents`                                                           | `{documentType,contentType,sizeBytes}` -> document id and private presigned PUT descriptor                                                        |
| POST `/kyc/:id/documents/:documentId/complete`                                      | Re-reads bytes/metadata/version, computes SHA-256, checks JPEG/PNG/PDF signature; remains quarantined until trusted scan                          |
| POST `/kyc/:id/submit`                                                              | Requires policy enabled and all latest required documents uploaded and clean-scanned; moves to IN_REVIEW                                          |
| POST `/vehicles`, PATCH `/vehicles/:id`                                             | Existing `{category,registrationNumber,makeModel}`. Manufacturer/model use the existing combined field. Verified identity stays locked            |
| POST `/vehicles/:id/documents`, POST `/vehicles/:id/documents/:documentId/complete` | Existing private upload/completion flow, using the actual vehicle's category policy                                                               |
| POST `/vehicles/:id/submit`                                                         | Requires latest required evidence clean-scanned                                                                                                   |
| POST `/vehicle-replacements`                                                        | Existing vehicle input plus reason. Review leaves the old vehicle active; approval atomically switches vehicles                                   |

Detailed profile example (synthetic only; not an approved identity-document policy):

```json
{
  "profileVersion": 2,
  "name": "Synthetic Driver",
  "dateOfBirth": "1995-05-03",
  "email": "driver@example.test",
  "residentialAddress": "123 Synthetic Road",
  "city": "Test City",
  "state": "Test State",
  "pinCode": "342001"
}
```

Optional fields: `gender` (FEMALE/MALE/OTHER/PREFER_NOT_TO_SAY), protected
`drivingLicenseNumber` (only when server encryption is configured), `licenceExpiresOn`
(YYYY-MM-DD), and `licenceVehicleClasses` (array of approved-code-shaped strings).
These are declared metadata, not proof of verification. `legalName` remains admin-owned.
Never send phone/UID/role/approval/KYC status in this request. Unexpected fields are rejected.
Names/identity fields are locked during review and after verification. Corrections must be
authorized through the existing KYC workflow. No identity number appears in ordinary summaries.

Summary includes `profile.detailsComplete`, `missingFields`, `age`, `minimumAge` and
`ageEligible` (null = policy unavailable), authenticated phone, saved address and masked
licence last four. `profileComplete` preserves the historical v1 contract only for migrated
approved drivers; v2 accounts require all profile fields. `capabilities` reports actual
server configuration, accepted file types/size and whether optional licence capture is enabled.

No optional or statutory document list is invented. Portrait, licence, RC, insurance, permit,
PUC and vehicle photograph cards appear when their approved codes are configured. Until
that policy exists, their absence is shown as unavailable rather than simulated upload.
The mobile picker currently accepts JPEG/PNG evidence; existing PDF evidence remains available
to authorized admins through the original download API. In-app PDF viewing is not offered.

Authenticated GuardDuty results arriving before mobile upload completion remain recorded as
unknown and untrusted. Completion reconciles that original event only after binding the S3
version and independently checking the trusted clean tag. Replayed event ids cannot change
their object/result binding. Audit-row locks protect concurrent recovery. The app's retry
confirmation action reuses the existing completion endpoint; outages never grant clean status.

## Document status mapping

| Backend record                      | Mobile presentation                                                        |
| ----------------------------------- | -------------------------------------------------------------------------- |
| No record                           | NOT UPLOADED                                                               |
| Actual in-flight PUT                | UPLOADING + transferred-byte percentage; indeterminate when length unknown |
| UPLOADING after interrupted session | UPLOADING; choose/retry upload                                             |
| QUARANTINED with no scannedAt       | SCANNING                                                                   |
| QUARANTINED with clean scannedAt    | PENDING REVIEW (never VERIFIED)                                            |
| VERIFIED                            | VERIFIED                                                                   |
| REJECTED                            | REJECTED + real reason / replacement control when lifecycle permits        |
| SCAN_FAILED or STORAGE_UNAVAILABLE  | Failure/unavailable, no submission authority                               |
| KYC NEEDS_CORRECTION                | CORRECTION REQUIRED + real KYC reason                                      |

Only the latest version counts. The app refreshes on foreground/resume and periodically;
failed refreshes show retryable errors. Unsaved edits are retained during screen navigation;
saved fields and category are restored from backend after restart. No AsyncStorage approval flag.
Camera uses the platform camera intent through the existing picker (no extra CAMERA permission
is declared). Picker errors/cancellation are handled. Photos are not saved to public albums;
private picker cache copies are removed after use and stale copies pruned after 24 hours.
Private previews close on background/expiry, and fetch/download responses use no-store.

## Admin frontend handover

The existing admin login/session remains unchanged. ADMIN role and ACTIVE account are enforced
by the shared Firebase guards; there are no new admin identities or auth bypasses.

| Method and path                                         | Purpose                                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/v1/admin/onboarding/drivers`                      | Existing queue; no full licence numbers                                                                                                                         |
| GET `/v1/admin/onboarding/drivers/:id`                  | Profile/DOB/computed age eligibility, masked licence + expiry/classes, KYC and vehicle evidence metadata, policy/checklist, replacement history and audit trail |
| POST `/v1/admin/onboarding/drivers/:id/licence/reveal`  | `{reason}`. Explicit audited, no-store protected-number access; 503 without encryption, 404 without encrypted metadata                                          |
| GET `/v1/admin/onboarding/documents/:kind/:id/download` | Existing audited, temporary exact-version evidence URL, only clean eligible evidence                                                                            |
| PATCH `/v1/admin/onboarding/documents/:kind/:id/review` | `{decision:VERIFIED                                                                                                                                             | REJECTED,reason}`; only clean submitted evidence |
| PATCH `/v1/admin/onboarding/kyc/:id/review`             | `{decision:REJECTED                                                                                                                                             | NEEDS_CORRECTION,reason}`                        |
| PATCH `/v1/admin/onboarding/kyc/:id/verify`             | `{reason,checklist,legalName}`; all configured checklist items true and all required evidence verified                                                          |
| PATCH `/v1/admin/onboarding/vehicles/:id/review`        | Existing VERIFIED/REJECTED/IN_REVIEW decision and reason                                                                                                        |
| PATCH `/v1/admin/onboarding/drivers/:id/decision`       | Existing APPROVE/REJECT/CORRECTION/SUSPEND decision and reason; approval remains separate                                                                       |

Admin compares declared name, DOB and configured identity evidence with licence/portrait and
vehicle evidence manually. Do not infer RC ownership permission or automatic face matching.
The policy determines alternatives, consent, masking, retention, applicable licence classes
and vehicle-category evidence. A clean malware scan is only a security check. The admin should
request correction on the parent application/vehicle when a rejected document needs replacement.
KYC correction/rejection may reopen a previously verified identity. It atomically revokes
APPROVED driver status to PENDING, never clears an existing suspension, and preserves the prior
decision in the audit trail. Current eligibility and final approval use the newest KYC
application, never an older verified record. Reverification still requires a separate final
driver approval. Profile/upload/submission/admin review serialize on driver then parent locks.

Swagger UI is `/docs` and JSON `/docs/openapi.json` when `SWAGGER_ENABLED=true` (actual code
routes, not the older architecture document's `/api`). Detailed response metadata and request
validators feed the build's existing Swagger plugin. Approved admin-origin CORS now permits
PATCH so browser review operations work. No admin frontend was changed.

## Eligibility and activation order

The internal engine contract is unchanged: authenticated
`GET /v1/internal/drivers/by-subject/:subject/eligibility` (or the existing UUID route).
User ACTIVE, driver APPROVED, current valid KYC, verified active vehicle and required verified
documents remain mandatory. V2 adds complete profile, configured passing age eligibility and
unexpired supplied licence expiry. Final approval enforces these before the existing audited
database function. Client state never grants eligibility. Engine ONLINE/offers/acceptance/
assignment enforcement is preserved; no engine source changes were needed.

1. Independently review migration and grants; backup the target before authorized rollout.
2. Apply additive migration using the migration role, then shared grants using the authorized
   role. Do not give runtime migration privileges. Do not edit old deployed migrations.
3. Deploy compatible backend before distributing the new Driver APK. Older server summaries
   produce an explicit app upgrade/unavailable state for detailed profile saving.
4. Keep `MANUAL_KYC_ENABLED=false` until approved required documents, portrait/identity/privacy
   policy, minimum age, category-specific vehicle requirements and checklist are authorized.
5. Validate private versioned S3, GuardDuty plan, protected result tags, EventBridge authentication,
   retries/DLQ, integrity checks and exact-version retrieval using authorized staging evidence.
6. Authorized operator provisions staging admin separately; run document rejection/correction,
   KYC verification, vehicle verification, separate final approval and suspension/revocation.
7. Run the existing real backend/engine contract suite and physical Android UAT, including
   release camera/gallery selection, cache cleanup, private previews and restart/resume.

Do not use the synthetic test fixtures as live verification. No real S3 request, staging admin,
live database migration, AWS/Render change, deployment, push or eligibility override was performed.
