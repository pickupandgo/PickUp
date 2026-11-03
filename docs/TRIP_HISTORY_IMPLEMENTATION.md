# Backend-driven Trip History

Project: `D:\PU\PickUp-raj_driver`  
Verification date: 2 November 2026

## Result and remaining limits

The production Trip History list, historical details, and the existing Earnings trip-detail route now read authenticated backend records. No production history path falls back to a sample trip, including when the live-trip service is configured for development mocks. Unknown financial amounts stay unavailable; actual zero amounts stay zero.

The existing engine API returns at most 50 terminal trips, without a cursor or total counts. The app accurately displays everything that API makes accessible; it cannot retrieve older trips or authoritative totals once the cap is reached. Historical vehicle make/model/registration is also absent from the inspected backend contract. These are explicit backend dependencies, not completed frontend features.

Only Driver App files were changed. The Customer App was not inspected, modified or built. Backend sources were inspected read-only; no backend code, database records, authentication configuration or environment files were changed. Existing uncommitted work was preserved.

## Root cause and removed samples

`TripHistoryScreen` constructed its own list from `mockHistoricalTrip`, instead of using the history hook/service. `HistoricalTripDetailScreen` and `TripEarningsDetailScreen` always rendered the same imported fixture regardless of their route IDs. The old history service could also return an empty success without a real engine read.

Removed from production history:

- `mockHistoricalTrip`: `LOG-9921`, 24 October 2023 at 10:30 AM, Mini Truck, fictitious registration `LOG-9921`, Industrial Park / Wholesale Market / Retail Plaza / Final Hub, Electronics, 450 kg, fixed gross ₹1,800, commission ₹270, other deductions ₹80, net ₹1,450 and `paidToWallet: true`.
- Its list clones: `LOG-9920`, 23 October 2023 at 2:15 PM, Heavy Truck / `LOG-4402`, cancelled with fabricated zero earnings; and `LOG-9919`, 22 October 2023 at 9:00 AM, Furniture, fixed gross ₹2,200 and net ₹1,760.
- The generic “cancelled by user” and “paid to wallet” labels that were not supported by each trip's actual backend state.
- The pickup-inclusive fixed four-stop presentation. New cards count actual drop records and show their sequence.

No remaining `mockHistoricalTrip`, `LOG-9921`, `LOG-9920`, `LOG-9919`, or sample Industrial Park address is used by production history. Protocol fixtures are isolated in `__fixtures__/tripHistory.ts` and tests. Unrelated development mocks were left unchanged.

## Inspected contracts and endpoints actually used

Engine sources: `D:\PU\raj_engine\src\trips\trips.controller.ts`, `trips.service.ts`, `trip-views.ts`, and the trip/booking database models.

Payments sources: `D:\PU\PickUp-raj_backend` authenticated driver trips and earnings controllers/services, DTOs, and database models.

| Purpose | Existing endpoint | Authorization and behavior |
| --- | --- | --- |
| History | `GET /trips/history/driver/:driverId` | Existing Firebase bearer client. Engine verifies path identity matches authenticated subject. Query scopes `driverSubject`, terminal statuses, newest `updatedAt`, `take: 50`. Returns `{success, trips}`. |
| Historical detail | `GET /trips/:engineTripId` | Existing engine participant authorization. Frontend additionally requires the returned `driverId` to match the current Firebase UID and the returned ID to match the requested UUID. |
| Canonical trip earnings | `GET /v1/earnings?limit=100&cursor=...` | Existing payments bearer client and token refresh. Server scopes the earnings ledger to the authenticated driver. Actual response is `{items, nextCursor}`. |
| Existing Earnings detail route | `GET /v1/trips/:paymentTripId` | Existing driver-only payment trip authorization. This route uses a payment UUID, distinct from the engine UUID used by historical details. It then joins the actual earnings ledger. |

`GET /v1/trips` was inspected but not used as the history source: it also has a 50-record cap and lacks the engine's route/drop information. No invented endpoint, query parameter, websocket or database query was added.

## Display field mapping

| Display | Backend source and handling |
| --- | --- |
| Reference | `TripView.externalRef`, otherwise the actual engine `id`; never a constructed booking reference. |
| Date/time | `completedAt`, otherwise `cancelledAt`, otherwise `createdAt`; rendered using `en-IN` and `Asia/Kolkata`. Timeline uses each supplied event timestamp. |
| Vehicle category/icon | Historical booking category from `TripView.vehicleType`. Known categories map to existing icons; unknown category text is preserved. |
| Vehicle make/model/registration | Not supplied by `TripView` or its trip model. Displayed as unavailable. The current active vehicle is never substituted. |
| Pickup | `pickup.address`; missing text is explicitly unavailable. |
| Drops | Actual `stops`, sorted by `sequence`, with each `location.address` and actual status. No customer contacts, GPS coordinates or proof URLs enter the history model. |
| Drop count | Number of actual drop records, excluding pickup. |
| Distance / weight | `totalDistanceKm` / `weight`, only when supplied and valid. |
| Cancellation reason | `cancellationReason`; never inferred from `cancelledBy`. |
| Cancellation charges | Not supplied by this contract; unavailable rather than an assumed zero. |
| Timeline | Actual created, arrived, pickup-verified, started, delivered, completion-requested, completed and cancelled timestamps, when present. |

The parser validates response envelopes, UUIDs, dates, stop identities/sequences and current-driver ownership. Malformed or unauthorized records produce a retry/authentication state rather than a successful empty list.

## Status mapping, counts and pagination

Filters retain All Trips, Completed and Cancelled. Completed matches only `COMPLETED`; Cancelled matches only `CANCELLED`. All Trips shows all records returned under the backend's history rules (currently those two terminal statuses).

Supported presentation mappings also include `DRIVER_ASSIGNED` → Assigned, `DRIVER_ARRIVED` → At pickup, `PICKUP_VERIFIED` → Pickup verified, `IN_TRANSIT` → In transit, `DROP_PROGRESS` → Delivering, and `DELIVERED` → Deliveries finished. Unknown valid status strings remain neutral and are never converted to completion. Earnings/payment state does not determine trip completion.

With fewer than 50 returned rows, the inspected engine query is exhaustive and counts are calculated from deduplicated actual records. At 50 or more rows, totals are unknown: the tabs show `—` and a recent-history limitation notice. A filter without local matches then shows “Limited trip history” rather than incorrectly claiming there are no matching trips globally.

There is no history cursor/offset contract, so no load-more request is fabricated. This means full historical pagination remains blocked on backend work. Refresh preserves previously verified rows displaced from the server window during the same mounted session (bounded to 250 in memory); an exhaustive response replaces the snapshot, including a genuine empty response. Records use stable engine UUID keys and deterministic update-time ordering. A virtualized FlatList, memoized cards and unchanged row identities limit rendering work. Requests coalesce; invalidations during a pending primary read queue a fresh read. Selected filter state survives refresh and tab returns.

## Earnings definition

Only a matching canonical `EarningDto.netAmountPaise` is labeled partner earnings. Matching uses engine `paymentTripId` against earning `tripId` and verifies `paymentBookingId` against earning `bookingId` when supplied. Engine fare, customer payable totals, wallet balance and payment fee/share previews are not used to calculate earnings.

Details show actual gross, platform fee, other deductions, TDS and net values in paise converted using the existing money helpers. Actual earning states remain distinct: Awaiting settlement, Payable, On hold, In payout, Paid and Settled in cash. The actual `MIXED` settlement enum is now accepted and labeled Cash + online. No earning state is labeled “paid to wallet”.

The existing earnings cursor contract is used for enrichment, with page size 100 and a maximum of five pages per refresh (500 ledger rows). Lookup stops once matching earnings are found, the ledger ends, or the screen/session becomes inactive. Repeated cursors and mismatched booking identities fail safely. A missing record or an earning beyond the lookup bound stays unavailable; a backend net value of zero displays zero. The backend needs an authorized earning-by-trip lookup to remove this bounded-scan limitation efficiently.

## Synchronization and session safety

- Fetch on Trips/detail focus, returning from details or another tab, foreground resume and pull-to-refresh.
- Refresh every 30 seconds only while the history/detail screen is focused and the app is active. Backgrounding or leaving the screen cancels acceptance of stale responses and stops further enrichment/poll reads.
- Subscribe to changes observed by the existing `TripController` (trip ID, confirmed status or update timestamp) and invalidate history. Backend results remain authoritative.
- Existing validated, recipient-scoped, deduplicated foreground push handling invalidates history for recognized trip events, including completion/cancellation. No automatic navigation was added. Returning from a background notification also receives the focus/resume refresh.

No authenticated trip websocket/gateway was found in the inspected engine. This is focus/mutation/push-assisted synchronization with a 30-second active-screen fallback, not guaranteed instantaneous push delivery. Delivery still depends on existing server push infrastructure. Existing trip mutation implementations were not rewritten or treated as proof of backend success.

Each mounted query keeps a narrow in-memory projection only. Firebase account changes clear records; response acceptance checks generation, active state and session identity. 401/403 responses clear history. Same-user network failures may retain already verified records with an explicit error/retry message. There is no persistent customer-data cache or new sensitive logging. The pre-existing root development authentication bypass was preserved; history itself still requires an actual Firebase session.

Cards navigate to the existing `HistoricalTripDetail` route with the actual engine UUID. Detail is re-read with server authorization, displays actual route/timeline/financial data and stays read-only. The separate existing Earnings detail route retains its payment-trip UUID contract.

## Verification

| Check | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed. |
| Changed-file lint | ESLint passed on all changed/new TypeScript and TSX files, including tests and fixture. |
| Complete test suite | `npx --no-install jest --runInBand --silent --testTimeout=30000`: 37 suites, 386 tests passed (53.934 s). Includes 31 new history tests. |
| Android debug and release | `android\gradlew.bat assembleDebug assembleRelease --console=plain`: BUILD SUCCESSFUL, 1m 55s, 1,215 tasks (34 executed). Existing Gradle deprecation warnings remain. |

New regression coverage exercises actual response projections, true empty/error/auth states, exact filters/counts, capped-history totals and local empty filters, deduplication/coalescing, UUID navigation/authorization, cross-session races, focus/resume/status/push refreshes, financial cursor pagination/limits, booking joins, zero versus unavailable values, mixed settlement and backend timeline/detail rendering. Historical vehicle tests verify that the unavailable snapshot is not replaced with a current vehicle. They cannot validate unavailable backend snapshot fields or a nonexistent history pagination endpoint. Backend security source tests were inspected; no backend E2E suite or database mutation was run.

Generated files (local, not source changes):

- Debug APK: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\debug\app-debug.apk`
- Release APK: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\release\app-release.apk`
- Test log: `D:\PU\PickUp-raj_driver\trip-history-tests.log`
- Build log: `D:\PU\PickUp-raj_driver\android-trip-history-build.log`
- Device screenshot: `D:\PU\PickUp-raj_driver\artifacts\trip-history\phone-empty-history.png`

### Physical device

Installed and launched the Driver debug APK on the connected realme RMX3870 (Android 16 / API 36), using Metro on host port 8082 with device port 8081 reversed to it. No app data or account was cleared.

The signed-in account successfully reached the backend-driven empty state with All Trips (0), Completed (0), and Cancelled (0). Verified all three filters and their appropriate empty descriptions, pull-to-refresh, and returning Home → Trips with Completed still selected and refreshed. The five bottom tabs remained visible. A screenshot records the actual empty result.

This account returned no history records, so populated cards, actual detail navigation, real completion/cancellation reconciliation and populated financial data were not verified on hardware. No production trip was created, completed or cancelled for demonstration. Full history pagination cannot be physically verified because the backend has no pagination contract. These cases have frontend automated coverage where contracts exist and require an authorized account/test trip for end-to-end verification. A second account and tablet were not available for this run.

## Required backend follow-up (proposals, not existing API calls)

1. Extend the existing driver-history endpoint with authorized cursor pagination, an explicit end marker, status filtering and authoritative all/completed/cancelled totals. Use a stable order such as `(updatedAt, id)` and document cursor/count semantics, including refresh behavior.
2. Persist the assigned vehicle's ID, make/model, category and registration as an immutable trip snapshot at assignment, then expose permitted snapshot fields in `TripView`. Joining the current active vehicle would corrupt history.
3. Add an indexed, authenticated canonical earning lookup by payment trip UUID (or a batch lookup), verifying driver ownership and returning its real financial state. This avoids scanning at most 500 recent ledger rows.
4. Expose explicit cancellation compensation/charge amounts and their financial status if supported by the business model. They cannot be derived from a missing earning or customer fare.

## Exact source files changed

Existing files modified (8):

1. `src/data/mockData.ts`
2. `src/hooks/useTripHistory.ts`
3. `src/screens/earnings/TripEarningsDetailScreen.tsx`
4. `src/screens/trips/HistoricalTripDetailScreen.tsx`
5. `src/screens/trips/TripHistoryScreen.tsx`
6. `src/services/notifications/notifications.ts`
7. `src/services/payments/earningsDto.ts`
8. `src/services/trip/TripService.ts`

New files (14):

1. `src/types/tripHistory.ts`
2. `src/services/trip/TripHistoryService.ts`
3. `src/services/trip/TripHistoryStore.ts`
4. `src/services/trip/tripHistoryEvents.ts`
5. `src/services/trip/tripHistoryPresentation.ts`
6. `src/components/trips/TripHistoryCard.tsx`
7. `src/components/trips/TripFinancialDetails.tsx`
8. `src/hooks/useTripFinancialRecord.ts`
9. `__fixtures__/tripHistory.ts`
10. `__tests__/tripHistoryService.test.ts`
11. `__tests__/tripHistoryStore.test.ts`
12. `__tests__/tripHistoryScreens.test.tsx`
13. `__tests__/tripHistoryRefresh.test.tsx`
14. `docs/TRIP_HISTORY_IMPLEMENTATION.md`

These 22 source/report files remain uncommitted for this task. APKs, logs and device screenshots are generated, ignored artifacts.
