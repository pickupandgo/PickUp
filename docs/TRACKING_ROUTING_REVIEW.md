# Driver tracking and routing review — 2026-11-01

Status: **BLOCKED for production/distribution.** Local implementation only; nothing committed, pushed or deployed. Customer and Admin files were not changed. No real trips or staging records were used for testing.

## Workspaces and scope

- Driver: `C:\multiple_ride\PickUp`, `raj_driver`, base `1e1efc7e1956910311df2eb3ce663a88dd165f22`.
- Engine: `C:\multiple_ride\tracking-engine`, `codex/tracking-engine`, base `1e85c5e2d378ef3a7ee52b6ed1ce795b1e8c7c0b` from `origin/raj_engine`.
- Backend: `C:\multiple_ride\tracking-backend`, `codex/tracking-backend`, base `6ed064e55ab1b5508f2332c799307fe85536f23e` from `origin/raj_backend`.
- Customer reference, read-only: `latest-vicky-customer-app`, inspected SHA `414a433077ce6d55866b837c09f5acd9f63e6b78`. Its installed APK/source/configuration match remains UNVERIFIED. The old local Customer APK is not evidence of the latest physical test.
- Engine retains lifecycle/dispatch/OTP ownership; the Backend supplies road geometry only. No fare, payments, wallet, KYC, account or Admin behavior was edited.

## Root causes and implemented behavior

The previous GPS heartbeat lived inside `useDriverDispatch`, enabled only in `searching`. Accepting a trip changed the screen state to `active_trip` and removed that publisher. The dormant TrackingAdapter addressed a nonexistent tracking route and swallowed failures. The foreground service collected GPS but had no authenticated HTTP publisher.

The existing TrackingService/TrackingAdapter now coordinate one native Android publisher for the authenticated session. Dispatch only announces availability and polls offers. Trip events, startup recovery, periodic recovery (15 seconds), and returning to the foreground keep tracking independent of navigation screens. A failed recovery is not treated as a completed trip. Stale recovery responses cannot override newer trip events or signout. Going offline does not interrupt an active trip. Completion/cancellation removes the trip context; online sharing continues only if the Driver remains online. Signout stops native publishing immediately through the native Firebase auth listener as well as session cleanup.

The foreground service publishes real Fused Location fixes directly to the existing Engine endpoint while JavaScript is suspended. Online GPS interval: 15 seconds (fastest 8); active trip: 5 seconds (fastest 2), including stationary fixes. There is one HTTP flight and one pending latest fix, no historical upload backlog. Transient failures use bounded exponential backoff (2–15 seconds); expired fixes are discarded. Firebase refresh is bounded and attempted once after a 401. Terminal 401/403 stops the publisher. Tokens and location histories are neither persisted nor logged. HTTPS is required and the native client refuses redirects.

The Engine formerly stored positions only in process memory and invented default coordinates for unknown Drivers. The new migration stores one latest position per verified subject in the Engine's existing PostgreSQL database. Atomic conditional upserts reject duplicate/older captures across app instances. Positions expire from reads after 60 seconds; no default coordinate is reported as live. Existing records retain only their latest fix, not a history. Retention/deletion policy still needs product/privacy approval before public distribution.

The previous real Driver routing provider silently substituted MockRoutingProvider's arbitrary geometry when Google failed. Driver routing now calls a separate authenticated Backend endpoint and reuses the existing Google service's `HIGH_QUALITY` geometry, timeout, validation and concurrency bounds. The Customer route and its authorization are unchanged. Pickup is the target until transit; remaining drops preserve their Engine order. Route requests are bounded, single-flight per planner, rate-limited, refreshed on deviation/age, and guarded against obsolete itinerary responses. Unknown GPS, missing assignment and routing errors clear the road line rather than fabricate a route or estimated distance/ETA. Existing map layout and navigation actions remain.

## Authentication and API contracts

`PATCH /drivers/:firebaseSubject/location`

- Existing Engine Firebase issuer/audience/signature/expiry verification remains mandatory. The path subject must equal the verified caller; an arbitrary client Driver ID cannot authorize anything.
- Body: `{ latitude, longitude, capturedAt, accuracy, tripId? }`. `capturedAt` is the original GPS UTC epoch milliseconds, not retry time. `accuracy` is meters. `tripId` is the Engine trip UUID, when active.
- Finite coordinates must be in geographic bounds; accuracy must be 0–100 m; capture age <=30 s and future skew <=5 s. Unexpected fields and malformed values are rejected (400).
- With an active Engine trip, its persisted Driver subject proves ownership. A supplied foreign/ended trip is rejected (403). Outside a trip the existing Backend Driver eligibility resolution is required; unprovisioned/non-Driver callers fail closed. New-work eligibility is not reinterpreted for an already assigned trip, so expiry of new-work eligibility cannot interrupt an existing trip's GPS.
- Success: `{ success: true, driver: { id, accepted, capturedAt } }`. `accepted:false` acknowledges a duplicate/older fix without replacing the current position.
- The publisher never marks a Driver available. Availability=true on a busy Driver remains false, and dispatch still excludes durable active assignments and checks Backend eligibility.

`GET /drivers/:firebaseSubject`

- Existing Customer success shape is preserved: `{ success:true, driver:{ id, latitude, longitude, ... } }`.
- Additional fields: `capturedAt` (epoch ms), `receivedAt` (ISO UTC), `accuracy`, `lastSeen` (capture epoch ms), `locationStatus:'LIVE'`.
- Allowed to the Driver themselves or the Customer of their active assigned Engine trip. Other identities receive 403. The unscoped `GET /drivers` no longer enumerates everyone; it is limited to the caller's own current position. Existing nearby-dispatch discovery remains separate and unchanged in purpose.
- Expired/unknown positions: 404, top-level Engine `code:'LOCATION_UNAVAILABLE'`. No successful default/stale coordinate. Existing auth errors are 401; database/service outages remain errors. The Customer currently retains an old marker on these errors: see the blocked handoff.

`POST /v1/driver/routes/road`

- Normal Firebase bearer authentication and database-resolved registered Driver principal. Service additionally requires role DRIVER and ownership of the non-completed/non-cancelled Backend trip. It never accepts a Driver ID as authority.
- Body: `{ tripId, origin:{latitude,longitude}, destination:{latitude,longitude}, waypoints?:[{latitude,longitude}] }`. Here `tripId` is the Backend `paymentTripId` already supplied by the Engine.
- Waypoints followed by destination must be an ordered subset of the immutable quote pickup/drops (coordinate tolerance 0.00001 degrees). Origin is the fresh Driver GPS. Route optimization/reordering is not enabled. Historical trips without a bound quote fail honestly rather than inventing an itinerary.
- Success unchanged from the Customer geometry service: `{ encodedPolyline, distanceMeters, durationSeconds }`; no Google credential. `Cache-Control:no-store`, 30 requests/minute, existing Google 8-second timeout. Driver adapter bounds Firebase wait to 10 seconds and HTTP wait to 12 seconds, with one token refresh. Failure yields an accurate unavailable state.
- `/v1/routes/road` remains Customer-only. No fare or trip state changes occur in either geometry endpoint.

## Recovery and scale limits

All Engine instances sharing the same existing PostgreSQL database see the same latest GPS. Restarting an Engine app does not erase a fresh fix or turn an unknown coordinate into a live position. Expired fixes remain unavailable until a newly captured fix is accepted. A new local app instance was tested against the same fixture database.

No Redis/infrastructure component was introduced. Existing dispatch availability/vehicle display metadata remain process-local; fully distributed dispatch recovery is outside this change. Do not claim unrestricted horizontal dispatch readiness. Any move to multiple dispatch instances needs an approved shared presence/lease design and load testing. Benchmark PostgreSQL GPS write/read capacity at the intended fleet size before distribution. A database outage cannot supply a live position; the Driver retries only still-fresh GPS after recovery.

Android uses a location foreground service started while the app is visible, with precise while-in-use permission. It can then operate while minimized/screen locked within Android/OEM limits. It does not request all-the-time location or silently restart from boot/force-stop. After process/service termination, reopening the app recovers the active trip and starts tracking when permission permits. iOS continuous publishing is explicitly unsupported by this Android implementation.

The existing Go Live and navigation permission dialogs disclose location sharing before requesting permission. Notification permission is requested on Android 13+. If notification permission is denied, Android may show the service in its active-apps controls instead of the notification drawer; this requires device verification. Platform restrictions and Play review are separate: removing ACCESS_BACKGROUND_LOCATION does not automatically exempt a foreground-service use case from Play location review.

Official references reviewed: [Android background FGS start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions), [Google Play background location requirements](https://support.google.com/googleplay/android-developer/answer/9799150), [Google Maps API security](https://developers.google.com/maps/api-security-best-practices). Required before public distribution: approved privacy policy/Data safety/retention wording, prominent disclosure review, applicable Play foreground-service/location declarations and evidence, restricted Android Maps SDK key, release signing/versioning, and full release-device tests. Existing release configuration uses the debug signing key and versionCode 1; it is not public-distribution ready.

## Two-device physical acceptance procedure — NOT EXECUTED

1. Review these changes first and separately authorize any UAT migration, deployment, candidate APK build/install and synthetic UAT trip creation. No staging change has been made for this work. Apply the additive Engine migration before using the new Driver. The new capture-time/accuracy contract requires a coordinated Driver/Engine release; old lat/lng-only Driver builds are rejected. Confirm Engine runtime table grants (SELECT/INSERT/UPDATE), a shared Engine database, UTC clocks and working TLS.
2. Record each actual APK's SHA-256, package, versionCode/versionName, signing certificate, build time, source SHA, build variant, Engine/Backend HTTPS hosts and Firebase project (no keys/tokens). Customer APK must come from the teammate; do not substitute the old local APK. Record actual device metadata with `adb shell dumpsys package com.multipleride.driver` and `adb shell dumpsys package com.multipleride.customer` when connected. A package version alone does not prove a source SHA.
3. Test at least the supported minimum API 24, location/background changes on API 29/31, notification changes on API 33, FGS restrictions on API 34, and target API 36; include an OEM device with normal battery restrictions. Sign in normally through Firebase on two physical phones using authorized UAT accounts. Do not copy tokens manually or bypass eligibility.
4. From Driver offline, tap Go Live. Confirm the disclosure precedes the OS precise-location request. Test denial, approximate-only grant, provider-off and permanent denial: no fabricated marker/route, no crash, and recovery after enabling precise GPS. Test notification grant/denial according to Android behavior. Confirm exactly one running location foreground service.
5. With a fresh fix, go ONLINE. Create an authorized test booking on Customer, accept on Driver, and record acceptance time. Walk/move safely (passenger-operated device only). Over at least 2 minutes, observe increasing Engine capture times and changing coordinates, and Customer marker movement at its existing polling interval (about 5 s). Publishing must continue after `searching` -> `active_trip`.
6. Switch Driver Home -> Active Trip -> Navigation -> Multi-stop -> another tab and back. Confirm one publisher/service, no duplicate request bursts and continued changing Customer position. While the trip is active, confirm no new offers reach this Driver, including attempts to announce availability=true.
7. Navigate to pickup and complete only the normal existing pickup/OTP/payment gates. Then test transit, first drop, a second drop and a failed/closed drop recovery. Before transit route only to pickup; afterward follow ordered remaining drops. Verify the line follows actual roads in both apps. Customer routing must remain unchanged. Drive safely off the planned road to check recalculation from actual GPS.
8. Minimize Driver and lock its screen for at least 10 minutes while moving safely. Confirm the foreground service remains active and Customer position advances. Repeat during pickup, transit and between drops. Observe battery/thermal impact and Android/OEM behavior; automated tests do not prove these results.
9. Disable Driver network for 90 seconds, then restore it. GPS must not be replaced with defaults. Engine returns unavailable once its last fix expires; Customer stale/error display remains BLOCKED until its developer implements the handoff. After reconnect, upload only the newest still-fresh fix, never a burst of old history, and observe movement resume without duplicate publishers.
10. Disable location services/withdraw precise permission. Confirm Driver navigation no longer presents a live GPS route once its fix expires. Re-enable GPS/permission in the foreground; verify recovery and no crash. Test routing-provider failure and missing routing configuration: an honest routing error and no straight/mock road line; restoring service recovers routing.
11. With a fresh accepted position, restart only the approved UAT Engine process. Confirm the same database supplies that fix only until its 60-second freshness limit, unknown Drivers return unavailable, and new Driver updates resume. Repeat with temporary database disconnection and recovery under authorization. Never reset a database.
12. Kill/force-stop Driver and reopen it. Android force-stop ends execution: continuous publishing is not promised while force-stopped. On reopening, recover the active trip, start one service from the visible app and resume positions. Check signout/account switch stops the old identity's publisher and rejects stale recovery responses.
13. Complete/cancel the trip through normal supported lifecycle actions. If offline, confirm service stops and no further GPS PATCHes occur. If still online, only the online publisher remains; the completed trip context must be removed. Completed-trip Customers must lose access to that Driver's subsequent position.
14. Run release-candidate crash/startup, permission, lock/background, network, multi-drop, real-Google routing, HTTPS, signing, privacy and Play checks. Record actual results, times/build hashes and sanitized status/error codes. All critical failures keep release BLOCKED.

## Local verification

Tests use synthetic tokens/identities/trips and disposable PostgreSQL databases only, in a dedicated loopback-only cluster (`127.0.0.1:55439`). They do not call staging, real Firebase, Google or payment providers. Engine fixtures use UTC to match existing timestamp assumptions. Initial failures from missing Backend dependencies, an outdated GPS fixture, a mismatched synthetic vehicle category and local fixture timezone were investigated and corrected without changing authentication or financial behavior.

The final test result record and exact changed-file inventory accompany this document in `TRACKING_ROUTING_RESULTS.md` and `TRACKING_ROUTING_FILES.md`. Customer handoff: `CUSTOMER_TRACKING_HANDOFF.md`.
