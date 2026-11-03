# Trip vehicles, segmented filters and delivery-proof investigation

Project: `D:\PU\PickUp-raj_driver`  
Date: 2 November 2026

## Outcome and remaining blocked features

| Requirement | Outcome |
| --- | --- |
| Consistent vehicle presentation | One normalized mapping supplies history, summary and Vehicle section. All use the actual booked category. Repeated generic unavailable headings are removed for known categories; the missing historical model/registration note appears once in Vehicle details. |
| Actual historical model/registration | **Not resolved.** The inspected engine model has no assigned vehicle relation/snapshot. No current-vehicle substitution was introduced. |
| Segmented filters | Implemented: one rounded container, equal options, animated navy selected pill, real counts and unchanged actual-status filtering. |
| Vehicle image | Implemented 52dp supplied category artwork where a reliable asset exists, with neutral icon fallback. This is an illustration, **not a photograph of the actual historical vehicle**. |
| Delivery Photos section | Implemented per-drop confirmed-proof metadata and truthful missing/unavailable states. |
| Actual thumbnails and full-screen zoom viewer | **Blocked by missing persisted image/upload/retrieval contracts.** No functioning gallery/viewer is claimed or disguised with stock images, local-path reads or invented endpoints. |

All work is in the Driver App. Backend files were inspected read-only; no database, backend, Customer App, authentication, payment, OTP or completion rule was modified. Prior uncommitted work is preserved.

## 1. Historical vehicle root cause

Inspected the engine Prisma models, `src/trips/trip-views.ts`, trip assignment/completion code, and the existing payments driver-trip DTO/controller.

`EngineTrip` persists booking ID, driver subject, payment trip ID, statuses and lifecycle timestamps. It has no assigned vehicle ID, vehicle relation or immutable vehicle snapshot. `TripView.vehicleType` comes from `EngineBooking.vehicleCategory`. The payment trip response also provides no historical make/model/registration/image association.

Consequently, marking a vehicle inactive or choosing another active vehicle is not the observed loss mechanism: the inspected engine schema never associated that vehicle record with the trip. Existing driver/onboarding vehicle records can contain make/model/registration, but they describe vehicle records available to the partner, not proof that a particular vehicle performed an old trip.

`historicalVehicle(trip)` is now the single presentation mapping. It returns the actual booked category title/icon/artwork and explicit absent model/registration values. The list, summary and Vehicle section consume it. They cannot disagree because none performs its own active-vehicle lookup. Known categories such as Mini truck are displayed consistently rather than three repeated unavailable headings. The Vehicle section separately states that model and registration were not recorded.

This does not reconstruct or fix historical model/registration. The smallest backend correction is to persist a trusted assigned vehicle reference and an immutable snapshot (category, make/model, registration, optional manufacturer/image reference, capture time) when assignment is confirmed, and expose it through the authorized trip DTO. Old records require a reliable historical source before backfill; copying today's active vehicle into them is unsafe.

### Database-access boundary and actual record evidence

The engine checkout has no configured `.env`, and this execution session has no `DATABASE_URL`. No direct SQL/database read was performed. No deployment credentials were requested or extracted.

The current partner's authorized production API response was exercised through the Driver app. Its trips expose the booked category; the latest inspected drop exposes confirmed device-local proof metadata. These are actual API observations, combined with the inspected schema/source, **not a claim that a live database row was queried directly**. Backend/deployment differences beyond the inspected contracts require an authorized database/deployment audit.

## 2. Segmented-control implementation

`TripSegmentedFilters` replaces the separate capsule controls:

- One soft-neutral rounded parent with three equal flex cells and no individual outlines.
- One navy pill behind the selected cell, with white selected text and neutral unselected text.
- A 180ms native-driver translation animation based on measured container width.
- Recalculation on layout/rotation; text can wrap and each option retains at least a 48dp interaction height.
- Reduced-motion support; motion is disabled when the accessibility preference requests it.
- Accessible tab labels and selected state.
- Actual counts, including the existing unknown-total `—` behavior.

The selected filter remains the parent screen's existing state. All Trips selects actual records; Completed matches only `COMPLETED`, Cancelled only `CANCELLED`. Filter, deduplication, ownership, refresh and real earnings behavior are unchanged. No fictional totals, pagination parameters or new polling were added. The existing server history cap of 50/no cursor still limits full pagination and global totals at the cap, as documented in the earlier history report.

## 3. Vehicle artwork

`HistoricalVehicleImage` uses the existing `VehicleAvatar` component and supplied MultipleRide assets. Dimensions are **52 × 52dp**, `resizeMode="contain"`, with a neutral container aligned to the first text line. Source files were not changed:

- Bike: `assets/vehicles/bike.png`
- Cargo three-wheeler: `assets/vehicles/cargo_three_wheeler.png`
- Mini truck: existing mapping to `assets/vehicles/pickup_truck.png`
- Pickup: existing mapping to `assets/vehicles/mini_truck.png`

The existing mapping accounts for filenames whose pictured vehicle differs from their name. Four-wheeler/unknown categories use the existing neutral category icon when no unambiguous supplied artwork is available. Image load failure also falls back to the neutral icon. No current vehicle photo, unrelated stock image or fabricated historical photo is fetched.

`VehicleAvatar` only gained an optional image-error callback; its existing consumers and mappings remain unchanged.

## 4. Delivery-photo trace and exact failure

Traced the existing Driver capture/confirmation flow and the engine's committed record:

1. `DeliveryProofCameraScreen` calls the native image picker camera (`quality: 0.7`, `saveToPhotos: false`) and passes the returned device URI to Preview.
2. `DeliveryProofPreviewScreen` calls `TripController.confirmDropDelivery` with that URI. Confirmed delivery still depends on the engine; a failed request does not change status in this task.
3. `dispatch.confirmStopDelivery` sends JSON `{stopId, photo: {uri}}` to the actual `POST /trips/:tripId/stop/confirm-delivery` action. **No image bytes, multipart upload, storage initiation or upload-completion operation occurs in this path.**
4. The controller validates a nonempty URI; the trip service verifies driver/current-stop/OTP/payment rules and queues the existing delivery command.
5. Only after the payment backend accepts it, `outbox-effects.applyStopDelivered` writes `EngineStop.status = DELIVERED`, `deliveredAt`, `proofUri` and `proofSubmittedAt`.
6. `stopView` returns that scalar field as `deliveryProof: {type: PHOTO, uri, submittedAt}` under the particular stop.

Thus, a proof reference is persisted and linked to a real drop, but the inspected camera flow does not upload the image binary for later retrieval. A camera cache path is not a private-S3 media object or an authorized preview grant. It may be inaccessible to another device and may disappear from the originating device. The current schema also has only one URI per stop, not a list of persisted photo records.

The new parser retains only confirmed `DELIVERED` stop proof metadata: device-only versus preview-unavailable availability, and actual submission time. It discards the raw local path, arbitrary HTTPS URL, signed query parameters and storage secrets. Pending/arrived/failed references are not treated as confirmed delivery evidence. The UI calls the timestamp **Recorded**, not captured, because the server supplies submission/commit time, not a verified camera capture time.

`DeliveryPhotoGallery` groups this metadata by the actual ordered stop and short address. No record produces “No delivery photo recorded for this drop.” A confirmed reference without a retrieval contract produces a truthful secure-preview-unavailable explanation. No image-shaped failed placeholders, thumbnail fetches, stock evidence or fake photo records are added.

The existing KYC/Vehicle document preview service is not a delivery-evidence service: its reference kinds and ownership checks concern onboarding documents. Passing a stop ID or proof path as a KYC/vehicle document ID would bypass the correct association and was not attempted.

### Missing secure gallery/viewer contracts

No authorized proof-media list, thumbnail grant, original-image grant or signed-URL refresh contract was found in the inspected engine. A device URI or arbitrary HTTPS URI returned in trip data is not evidence that the backend authorized an image download. Therefore a working thumbnail gallery/full-screen pinch/pan viewer cannot be completed safely from this Driver-only change.

Smallest safe backend/storage follow-up (proposals, not endpoints called by this app):

1. Introduce owned media records linked to the actual trip **and** stop, with uploader/driver association, immutable storage object reference/version, content type/size/hash, upload-confirmed state and submitted/captured timestamps when genuinely supplied.
2. Authorize upload initiation/completion for the current partner/drop, upload binary bytes to private storage, verify the object exists, and associate the confirmed media ID through the existing delivery rules/outbox transaction. An upload attempt alone must not mark delivery complete.
3. Support one-to-many photo records per drop if multiple evidence images are required. Retain backward-compatible unavailable states for old URI-only records; do not fabricate or copy evidence between drops.
4. Provide authenticated listing and short-lived grants for separate thumbnails and full-resolution originals, verifying partner trip ownership and exact media/stop association. Supply expiry/refresh semantics and thumbnail metadata.
5. Once that approved contract exists, connect thumbnails and a full-screen pinch/pan viewer using opaque IDs, grant refresh, loading/retry/denied states and session-scoped cleanup. Do not expose AWS keys, publicize S3 or download originals just to make thumbnails.

No server photo/status record was changed in this task. Old local references cannot be claimed recoverable without the original bytes and a supported verified migration process.

## 5. Verification

| Check | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed. |
| Changed-file ESLint | Passed with zero errors and zero warnings. |
| Full suite | **43 suites / 453 tests passed**, 46.998 seconds. |
| Android debug/release | `assembleDebug assembleRelease`: **BUILD SUCCESSFUL in 1m 9s**, 1,215 tasks; 34 executed. Existing dependency/Gradle warnings remain. |
| Diff whitespace | `git diff --check` passed. |

Nine new tests cover the normalized category-only vehicle mapping, supplied-artwork dimensions/failure fallback, equal borderless segments, real counts, narrow/wide layout measurement and animation, reduced motion, per-drop proof grouping, missing photos, pending/failed references and non-disclosure/non-fetching of arbitrary signed/private URIs. Existing authenticated trip/detail/ownership/session, earnings, filters, count limits and refresh tests remain green.

No test claims support for a nonexistent historical vehicle relation, multiple persisted photo records, expiring image grants or a working full-screen evidence viewer. Those end-to-end cases are blocked on the contracts above.

## 6. Physical-device results

Installed the release on the connected realme RMX3870 (Android 16/API 36), preserving the existing account and its live/offline setting. Verified:

- Actual history: All Trips (2), Completed (2), Cancelled (0).
- Shared segmented control and supplied mini-truck category artwork.
- Cancelled selected correctly and showed the genuine zero-result empty state.
- Completed selected correctly and returned two real records.
- Actual selected trip opened its separately authorized details.
- Summary and Vehicle section each showed the same Mini truck category; one model/registration note appeared, and repeated “Vehicle details unavailable” headings did not.
- Short addresses, measurements, timestamps and real earnings remained visible.
- Delivery Photos showed **one confirmed device-local proof reference** for the inspected drop, with its real recorded timestamp.
- **Actual delivery photographs displayed: 0.** No uploaded/securely retrievable image was available through the current contract; the screen did not pretend the reference was an image.
- Back returned to history with Completed still selected.

No trip was created, completed, cancelled or edited for testing. No photo was uploaded, copied or generated. Physical rotation/tablet, large-font and secure image preview/expiry tests were not performed; width changes/reduced-motion behavior were exercised in automated tests. The phone remained on Driver history after the final check.

Local Driver captures: `artifacts/trip-vehicle-photos/history.png`, `details.png`, `proof-state.png`.

## 7. Exact files changed for this task

Existing files updated (7):

1. `src/components/atoms/VehicleAvatar.tsx`
2. `src/components/trips/TripHistoryCard.tsx`
3. `src/screens/trips/TripHistoryScreen.tsx`
4. `src/screens/trips/HistoricalTripDetailScreen.tsx`
5. `src/services/trip/TripHistoryService.ts`
6. `src/types/tripHistory.ts`
7. `__tests__/tripHistoryScreens.test.tsx`

New files (6):

1. `src/services/trip/historicalVehicle.ts`
2. `src/components/trips/HistoricalVehicleImage.tsx`
3. `src/components/trips/TripSegmentedFilters.tsx`
4. `src/components/trips/DeliveryPhotoGallery.tsx`
5. `__tests__/tripVehiclePhotos.test.tsx`
6. `docs/TRIP_VEHICLE_FILTER_PHOTOS.md`

These 13 source/report files are this task's scope and remain uncommitted alongside preserved earlier changes. Screenshots, APKs and logs are ignored generated artifacts.

## 8. APK and verification paths

- Debug: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\debug\app-debug.apk`
- Release: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\release\app-release.apk`
- Build log: `D:\PU\PickUp-raj_driver\android-trip-gallery-build.log`
- Full tests: `D:\PU\PickUp-raj_driver\trip-gallery-all-tests.log`
- TypeScript/lint: `trip-gallery-typecheck.log`, `trip-gallery-lint.log` in the project root.
