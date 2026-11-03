# Trip History and Trip Details redesign

Project: `D:\PU\PickUp-raj_driver`  
Date: 2 November 2026

## Implemented UI

Trip History now uses flat white rows with subtle bottom dividers instead of large rounded cards. Each row has a 36dp neutral vehicle icon container, destination summary, IST date/time, compact actual reference, multiple-stop count where applicable, actual net earnings or unavailable state, semantic trip status, and a neutral chevron.

The normal minimum row height is 108dp; there is no fixed or maximum height, so dates/status/amounts can wrap with accessibility text. The destination and reference are single-line summaries with complete destination in the accessibility hint and full information available in details. References longer than 28 characters use actual prefix/suffix characters separated by an ellipsis; they are never replaced with generated IDs. The real engine UUID remains the list key and navigation argument.

Full pickup/drop addresses, vehicle-unavailable explanations, cancellation reasons, payout details and financial breakdown are no longer repeated in every history row. `TripHistoryCard` retains its existing import name for compatibility but now renders the compact row. No sample trip was introduced; the earlier removal of production mock history is preserved.

The existing `HistoricalTripDetail` route now renders `TripDetailsScreen`. Its compatibility export retains existing imports without introducing a second route. It still independently reads the selected ID through `useTripHistory(tripId)` and the authenticated detail endpoint, rather than accepting a copied list object.

Detail sections:

1. **Summary:** compact actual reference, real status badge, actual date/time and recorded start time. A disclosure exposes selectable complete reference and engine trip ID, without a long UUID headline. No clipboard dependency was added.
2. **Vehicle:** historical booking category and corresponding icon. Actual model/registration remain explicitly unavailable because the source model does not retain them.
3. **Route and delivery:** connected vertical markers for pickup and each ordered drop, real addresses/statuses and available pickup/drop timestamps. Arrival, delivery and failure timestamps have distinct labels. Drop count, supplied distance and weight appear together at the bottom.
4. **Earnings:** actual gross, platform fee, other deductions and TDS, with a separate emphasized net total, actual settlement method and actual earning state. Missing earnings are not converted to zero.
5. **Timeline:** connected chronological event markers, distinct failure/cancellation markers and actual individual-drop events. Future timestamps are excluded from the occurred-event presentation; no future/pending lifecycle events are invented.

Cancelled records additionally show their actual cancellation reason and an unavailable-charges state where the contract provides no amount. Loading uses static skeleton rows/sections, avoiding unnecessary motion. Errors retain retry/authentication handling and no fake fallback. Scrollable content and existing safe-area/bottom-tab integration remain intact.

## Backend inspection and data mappings

Backend sources were inspected read-only. Only Driver App files were changed.

| Information | Actual existing source |
| --- | --- |
| History | `GET /trips/history/driver/:FirebaseUID`, existing engine bearer client and server same-identity authorization |
| Selected detail | `GET /trips/:engineTripUUID`, server participant authorization plus frontend current-driver and requested-ID checks |
| Reference | `TripView.externalRef`, otherwise actual `id` |
| Vehicle category | `TripView.vehicleType`, from `EngineBooking.vehicleCategory` |
| Pickup / drops | `pickup.address`; `stops[].location.address` in `sequence` order |
| Drop event times | Existing `stopView` fields `arrivedAt`, `deliveredAt`, `failedAt` |
| Measurements | Existing `totalDistanceKm`, `weight` |
| Trip lifecycle | Existing created, arrived, pickup-verified, started, delivered, completion-requested, completed and cancelled timestamps |
| Canonical earnings | Existing authenticated `GET /v1/earnings?limit=100&cursor=...`; match engine payment trip ID and booking ID |
| Partner amount | `EarningDto.netAmountPaise`, formatted using existing INR/paise helpers; never engine customer fare |
| Settlement | Actual `ONLINE`, `CASH`, `MIXED`; labels Online, Cash, Cash + online. Actual earning status remains separate. Online is not relabeled Wallet/Bank. |
| Settlement timeline event | Only actual `paidAt` when earning status is `PAID`; no inferred settlement completion |

`HistoryStop` now retains the real optional arrival/delivery/failure timestamps. These fields are validated with the existing timestamp parser and included in the sorted lifecycle projection. Missing dates remain null. Receiver contacts, proof URLs and GPS coordinates remain excluded from the history model. No new endpoint or response property was invented.

### Historical vehicle limitation

Inspected `D:\PU\raj_engine\prisma\schema.prisma` → `EngineTrip` and `src\trips\trip-views.ts`. The trip stores booking ID, driver subject, payment-trip ID, statuses and lifecycle timestamps. It has no vehicle ID relation or historical make/model/manufacturer/registration snapshot. `TripView.vehicleType` is only the booking category. The frontend is not dropping an existing vehicle-registration field.

Required backend follow-up: persist the assigned vehicle ID plus an immutable category/make/model/manufacturer/registration snapshot at assignment, then expose permitted snapshot fields in the authorized trip DTO. The partner's currently active vehicle must not be substituted for historical data. No backend schema or business logic was changed in this task.

## Counts, pagination, refresh and navigation

The authenticated service/store, filters and refresh mechanisms remain in place. Exact `COMPLETED`/`CANCELLED` statuses determine filters; unknown statuses never become completed. The selected filter stays in the mounted list screen on Back. Stable keys and the unchanged FlatList instance preserve position where possible; no forced scroll-to-top was introduced. List virtualization and memoized rows remain.

The inspected history endpoint still returns at most 50 terminal trips and has no cursor, status query or authoritative global totals. Fewer than 50 rows provide exhaustive deduplicated counts. At the cap, counts remain unknown (`—`) with the limitation notice, and locally unmatched filters show limited history rather than falsely claiming a global empty result. No fake pagination request, cursor, global count or load-more spinner was added. Older previously verified rows can still be retained by the existing bounded in-memory store.

Full history pagination requires an authorized backend cursor/end marker, stable ordering and authoritative counts/filter metadata. This remains a backend dependency. Earnings enrichment continues to use the actual financial cursor contract, bounded to five 100-record pages; a direct authorized earning-by-trip lookup is still needed to remove that limitation.

Existing focus/return/resume, pull-to-refresh, confirmed TripController changes and validated trip-push invalidation are preserved, along with the existing 30-second foreground/focused fallback. This task added no polling or websocket dependency. No instant real-time delivery guarantee is claimed.

Authentication, logout fix, OTP, documents, payments/business calculations, notifications, bottom-tab routes and Android inset implementation were not changed. All earlier uncommitted work remains preserved.

## Verification

- TypeScript: `npm run typecheck` passed.
- Changed-file ESLint: passed with zero errors/warnings.
- Full suite: **41 suites / 427 tests passed**, 44.032 seconds. Six additional tests cover compact reference/icon/layout, detail routes/metrics/financial display, skeleton/auth failures, cancellation state, and actual drop timestamps/timeline ordering. Existing filter, session, ownership, financial pagination and refresh regression tests remain green.
- `git diff --check`: passed.
- Android debug and release: `assembleDebug assembleRelease` passed. The final confirming build completed in **53 seconds**, 1,215 tasks (34 executed, 1,181 up-to-date). The preceding build also passed in 1m 47s. Existing Gradle/React Native dependency warnings remain.

Artifacts:

- Debug APK: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\debug\app-debug.apk`
- Release APK: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\release\app-release.apk`
- Build log: `D:\PU\PickUp-raj_driver\android-trip-redesign-build.log`
- Test log: `D:\PU\PickUp-raj_driver\trip-redesign-all-tests.log`
- TypeScript/lint logs: `trip-redesign-typecheck.log`, `trip-redesign-lint.log`
- Driver-only device captures: `artifacts\trips-redesign\history.png`, `details-route.png`

### Physical device status

Installed the release on the connected realme RMX3870, Android 16/API 36, preserving the signed-in account. The actual account returned one completed trip: All Trips (1), Completed (1), Cancelled (0). Verified its compact row, actual net amount and completed status, and opened its independently fetched detail record. The vehicle category/unavailable snapshot state and real pickup/drop, supplied distance/weight and recorded timestamps were visible in the scrollable detail view.

The phone switched away from the Driver app during the remaining checks. Further input was guarded/stopped while Driver was not foreground; full hardware checks of the earnings/timeline bottom sections, cancelled filter, Back/position restoration and large accessibility/tablet layouts remain outstanding. Automated tests cover their available frontend behavior. The final timestamp-label refinement was included in a subsequent confirming build and that final release was installed successfully without clearing data or switching the foreground app; its labels still need a final visual recheck. The screenshots record the earlier candidate check, before that label refinement.

No production trip was created, completed, cancelled or edited for this task. No mock production trips were used. No physical test can validate full history pagination or historical registrations until those backend fields/contracts exist.

## Exact files changed in this task

Existing files updated (10):

1. `src/screens/trips/TripHistoryScreen.tsx`
2. `src/screens/trips/HistoricalTripDetailScreen.tsx`
3. `src/components/trips/TripHistoryCard.tsx`
4. `src/components/trips/TripFinancialDetails.tsx`
5. `src/services/trip/TripHistoryService.ts`
6. `src/services/trip/tripHistoryPresentation.ts`
7. `src/types/tripHistory.ts`
8. `src/navigation/stacks/TripsStack.tsx`
9. `__tests__/tripHistoryScreens.test.tsx`
10. `__tests__/tripHistoryService.test.ts`

New files (2):

1. `src/components/trips/TripLoadingSkeleton.tsx`
2. `docs/TRIPS_UI_REDESIGN.md`

These 12 source/report files are this task's changes. Screenshots, APKs and logs are ignored generated artifacts. All changes remain uncommitted.
