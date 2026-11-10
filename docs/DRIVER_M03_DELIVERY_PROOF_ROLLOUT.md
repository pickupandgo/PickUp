# M03: durable delivery evidence — local implementation

2026-11-07. Implemented locally in Driver, Backend and Engine. Customer unchanged. No production DB operations, migration execution, deployment, push or APK build performed.

## What changed

Previously the delivery command carried a phone-only `file://`/`content://` path. It could mark the stop delivered without storing the image bytes. Now:

1. Camera captures a bounded-size photo; the existing preview/retake screen remains.
2. Driver requests a private upload for the current, assigned, arrived and OTP-verified drop.
3. Backend checks the assigned driver/payment trip/drop and issues a signed PUT to its existing private document storage under `delivery-proofs/`. Supported photo types: JPEG/PNG; maximum 5 MB, also subject to any lower configured document limit.
4. Driver sends actual bytes to storage, without a Firebase token in that request. Upload/verification states and errors are visible. A failed upload never calls delivery confirmation. Verification retries reuse the already-uploaded proof ID in memory; a restart before verification may require retaking the photo.
5. Backend validates metadata, byte size/type and checksum using the existing storage verifier, then requires a clean scan of the same immutable object version. GuardDuty must confirm a clean version/tag, or the configured HTTP scanner must return CLEAN. Storage/scanner failures fail closed.
6. The Engine rechecks that this verified proof belongs to the actual assigned driver, Engine trip, stop, sequence and payment trip. The existing backend-first DELIVERED command, payment gates, OTP gates, duplicate handling and explicit final trip completion remain.
7. Only `proof:<UUID>` is persisted in the Engine stop/outbox. Signed URLs are temporary, never saved as the proof identity. Repeated confirmed delivery remains a no-op; no second final completion is invented.

## Contract

All Engine routes require the existing verified Firebase token. The Engine derives identity and binding from its own trip; caller-supplied owner/amount is not accepted.

| Engine route | Purpose |
|---|---|
| POST `/trips/:tripId/stops/:stopId/proof` | Body `{contentType,sizeBytes}`; returns `{proofId,upload:{url,headers,expiresInSeconds}}` |
| POST `/trips/:tripId/stops/:stopId/proof/:proofId/complete` | Verify the uploaded object; returns `{proofId,ready:true}` only after validation/scan |
| POST `/trips/:tripId/stop/confirm-delivery` | Existing command; `photo.uri` must now be `proof:<UUID>` and `stopId` selects the drop |
| GET `/trips/:tripId/stops/:stopId/proof` | Reauthorizes an assigned driver or the owning customer, reloads the stored reference and returns a fresh 60-second signed read URL |

Backend `/v1/internal/delivery-proofs`, `/:id/complete`, `/:id/read` are POST routes protected by the existing internal-key policy. Engine-only binding includes paymentTripId, engineTripId, engineStopId, sequence and the assigned driver subject. This is separate from KYC document records, while reusing their existing storage/scanning implementation.

The read endpoint supports another authorized client after restart. Actual second-client storage retrieval has not yet been exercised. Historical local-only photo paths cannot be recovered into real image bytes; the read endpoint reports durable evidence unavailable for those records.

## Rollout before live acceptance

1. Backend engineer reviews/applies migration `backend/prisma/migrations/20261107000000_delivery_proofs/migration.sql` to the intended database using the normal migration process. Additive table/FK/index only; no existing data reset. Generate Prisma and grant the app role the required access if deployment uses separate migration/API roles.
2. Configure existing `DOCUMENT_STORAGE_*` and `DOCUMENT_SCANNER_*` settings securely. Require a private, encrypted, versioned compatible bucket. Storage credentials/policy and scanner need access to the new `delivery-proofs/` prefix, including version reads. Keep public access blocked. Do not enable uploads with scanning disabled or disable validation to make a test pass.
3. Review bucket lifecycle/retention: completed evidence must preserve its pinned version; unfinished/abandoned uploads need a separate approved cleanup policy. No retention interval or production delete job was invented in this milestone.
4. Deploy Backend, then the compatible Engine and Driver version together in a controlled release window. Old Driver builds submit local paths and will be refused by the new Engine. Do not activate that Engine for old active-delivery clients without an app update/rollout decision.
5. With a controlled paid/OTP-verified drop: capture, preview, upload, verify and confirm. Restart and use an authorized second client to request/read the proof; outsider/wrong-stop access must fail. Exercise offline PUT, missing file, scan pending/failure, duplicate confirm and last-stop explicit completion. Verify delivery/payment states in both services.

## Checks and remaining limits

- Driver typecheck passed; 3 focused suites / 41 tests passed (byte upload, retry, privacy fences, invalid input, upload failure preventing delivery and existing trip/payment UI behavior).
- Backend typecheck and Prisma generation passed; 3 focused suites / 44 tests passed (new evidence authorization/binding/scan/read tests, existing byte/version storage validation and payment gates).
- Engine typecheck passed; 3 focused suites / 19 tests passed (proof gate, participant reads, existing progression/outbox policy). Relevant DB E2E fixtures now submit proof references through an explicitly fake verified receipt; they do not certify S3 or scanning.
- Git whitespace checks passed. No native APK build or live financial/booking mutation performed.
- Database-backed E2E/migration application and actual private storage/scanner/second-client acceptance have not run. The separate `engine/test/contract/run-contract-e2e.mjs` harness still contains legacy local-photo fixtures and needs real upload/verification fixtures before its delivery cases can be used for M07; do not interpret their new rejection as a payment-gate regression or bypass the proof gate.

M03 is implemented locally, not closed as production/live verified.
