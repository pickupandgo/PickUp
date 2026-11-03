# Partner background system implementation and verification

Date: 2 November 2026. Driver project: `D:\PU\PickUp-raj_driver`.

**Status:** Driver/native implementation and backend patches are prepared. Debug and release APKs build. The debug app was installed on the connected phone. Backend deployment, full PostgreSQL migration integration and controlled live notification/road comparisons remain pending. Overlay grant/use tests were explicitly deferred by the user to Play Store testing after Android blocked the sideloaded APK's restricted permission.

The Customer App source was not modified. Existing Driver changes were backed up before this task; no reset, staging, commit or push was performed. Pricing, payouts, payment integrations, existing tab names/routes and the preceding fare-task rollback were preserved.

See [the exact change manifest](./PARTNER_BACKGROUND_FILES.md) and [backend patches and rollout notes](./backend-background/README.md).

## Road distance

The old incoming-offer helper calculated Haversine displacement and summed straight lines between drops. Assigned-trip Navigation already used the backend Google Routes v2 service. Its Driver route endpoint required an assigned payments-trip UUID, so it could not authorize an incoming offer.

The new Driver request is `POST /rides/:rideId/offer-road-route`. It sends only fresh Driver GPS coordinates, accuracy and capture time. The engine verifies authenticated ownership, current REQUESTED state, expiry, booking state and current vehicle/KYC eligibility. It rechecks the offer after the provider returns and limits repeated requests.

The engine calls `POST /v1/internal/routes/offer` using its existing internal credentials. That endpoint resolves pickup and ordered drops from the persisted booking's fare quote. Mobile-supplied destination coordinates are not accepted.

Both pickup and delivery legs use the same `RoutingService` as Navigation:

- Google Routes v2 `directions/v2:computeRoutes`.
- DRIVE profile and the existing route options.
- Driver origin to pickup.
- Pickup to the final drop with every intermediate drop retained in persisted sequence.
- Provider metres divided by 1,000; duration seconds rounded up to displayed minutes.
- Existing provider timeout, response validation and in-flight coalescing.

The incoming UI refreshes for material movement of approximately 50 metres, with a 10-second minimum interval and a 30-second refresh window. Displacement math is used only to trigger a new route request. It is never displayed as a road distance. Missing, stale, expired or failed route requests show unavailable labels. Zero provider distance remains a valid zero.

No monetary field or price-based Accept rule was added. Backend road results need deployment before they can be compared with a real accepted trip on the phone. No live offer with the new server endpoint was created during this task, so a physical same-coordinates comparison is still pending.

## Notifications

The existing Firebase project, token registration, Firebase authentication, token refresh, foreground listeners and invalid-token cleanup were reused.

The backend already had persisted inbox records, but most business modules had no Partner notification hooks, offers had no dispatch call, push IDs were not stable inbox IDs, and FCM failures had no durable retry queue. The Driver history adapter was also unconnected.

The new migration captures actual committed events:

| Event family | Authoritative source |
| --- | --- |
| Incoming and cancelled offers | Persisted targeted engine offers, verified internal enqueue API |
| Assignment, pickup verification, trip/drop progression, delivery completion, cancellation | Payments backend trip and booking-stop state transitions |
| Wallet credit/debit, confirmed recharge, fee ledger entries and reversals | Posted wallet ledger entries |
| Low and critical wallet balance | Confirmed ledger balance after the transaction; configured policy and persisted alert state |
| Recharge failure | Failed DRIVER_WALLET_TOPUP payment record |
| Earnings, hold/payable/cash/paid state | Driver earning record |
| Payout prepared/submitted/processed/failed/reversed | Driver payout record |
| Customer collection and merchant settlement | Collection and settlement records, explicitly distinguished from Partner bank payout |
| KYC and personal documents | KYC application/document transitions |
| Vehicle and vehicle documents | Vehicle/document transitions |
| Profile and account status | Changed persisted Driver/User records |
| Existing chat messages | Existing notification path, now keyed by the actual message ID |

Notifications and their queue records are persisted transactionally. Push is sent after commit by a leased queue worker. It rechecks recipient/token ownership, checkpoints accepted devices, backs off on failures and retains the inbox even when push is disabled. Invalid tokens are deactivated. Stable notification IDs are included in FCM data and Android tags. Queue completion is not a device delivery acknowledgement.

Wallet threshold settings are listed in the backend rollout notes. No production amounts were selected. Tests use isolated examples only. Alerts are based on authoritative balance-after-ledger values, not earnings or frontend refreshes. Hysteresis rearms alerts after recovery; repeated refreshes do not create alerts.

The Driver now reads real authenticated inbox pages, uses server unread counts when supplied, marks records read through the backend and rejects late responses after account switching. An older server that omits unread counts can still return its real history; the count remains unknown. No count is inferred or invented. Foreground pushes refresh the inbox and show a banner without forcing navigation. Taps open the authorized inbox record, with an explicit action to the related Driver section.

Optional category/sound preferences are server-backed. Important account/security notices remain enabled under the explicit policy shown in the UI. New ordinary Driver channels use normal importance; incoming offers use a high-importance channel. Silent channels support the sound preference. Customer notification channel names are retained on the shared backend.

There is no fabricated proof-approved event, expiry-reminder job, support response or announcement. Those categories need actual supported business events. No live recharge, payout, deduction, booking or synthetic production notification was created for verification.

## Availability and native service

Explicit Online preference is saved per Firebase account in native SharedPreferences. Home subscribes to the session coordinator instead of resetting a local screen state to Offline.

Screen/component teardown no longer writes availability=false or stops the user-started native session. Manual availability changes are serialized, require backend confirmation, persist the preference and roll back on failure. Logout clears the preference and stops session tracking. Existing active-trip tracking remains separate from new-work availability.

Connection health is distinct from preference:

- CONNECTED: the running native publisher has a recent acknowledged fix.
- RECONNECTING: service started but has not yet acknowledged a fix.
- STALE: last acknowledged location exceeded the health window.
- DISCONNECTED: native service is not running.

The existing authenticated native GPS publisher continues while JavaScript is suspended. Online updates use the existing 15-second policy; active trips use the existing faster policy. The native location foreground service starts through the visible app, with precise-location permission, a clear disclosure and an ongoing notification. No background-location permission or full-screen intent was added.

The engine patch persists explicit availability independently of location freshness. Dispatch requires recent valid GPS and current eligibility, and excludes active trips. A stale device does not become dispatchable simply because its preference remains Online. Explicit preference is not erased by a connection loss or engine restart.

The service remains START_NOT_STICKY and does not use a boot receiver or a restart loop. Force Stop stops execution. Visible reopening can restore the saved preference and start authorized sharing. Android foreground-service restrictions still apply; see [Android's foreground-service background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

## Optional floating window

Settings contains an explicit opt-in and Android permission flow. The native panel uses TYPE_APPLICATION_OVERLAY, a compact window, a draggable header, Open, collapse/expand and Hide controls. It does not take full-screen touch ownership.

Implemented states are Online/connection health, authenticated incoming offer with countdown, and actual active-trip status. Offer details come from the authenticated inbox; route metrics come from the same road endpoint. Accept/Decline reopen Partner and use the existing shared response handler, including backend revalidation and existing action guards.

The panel hides on Offline, logout, permission loss, service stop, foreground return and phone lock. Missing overlay permission does not block Online sharing or the normal inbox/FCM paths.

On the connected Android 16 phone, Android showed “App was denied access” and disabled the permission switch for the APK. No app-ops grant or restricted-setting bypass was used. The user explicitly deferred granted-permission, dragging, collapse, offer-action and active-trip overlay verification to Play Store testing. These behaviors are implemented but **not claimed as physically verified**.

Play Console foreground-service declarations and the location disclosure/privacy review still need checking against the release submission. See [Google Play foreground-service requirements](https://support.google.com/googleplay/android-developer/answer/13392821). A successful APK build does not establish Play Store approval.

## Verification

| Check | Result |
| --- | --- |
| Driver TypeScript | Passed |
| Driver full Jest suite | 48 suites, 502 tests passed, including the final inbox compatibility changes |
| Driver changed-file lint | No errors; existing unused mockReact and nested tabBar-render warnings remain |
| Backend TypeScript/build | Passed in isolated raj_backend checkout |
| Backend Jest | 58 suites, 647 tests passed |
| Engine TypeScript/build | Passed in isolated raj_engine checkout |
| Engine Jest | 14 suites, 91 tests passed |
| Notification SQL behavior | Passed in isolated PGlite fixture schema |
| Full historical PostgreSQL migrations/restricted-role integration | Pending staging PostgreSQL; fixture tests do not replace this |
| Android debug and release assembly | Passed |
| Git whitespace/patch checks | Checked without staging or rewriting existing work |

The first render of several React Native UI fixtures cold-loaded native host components for more than Jest's default five seconds on Windows. The affected first-render tests now have explicit 15-second allowances. No functional assertion was removed.

APK locations:

- `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\debug\app-debug.apk`
- `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\release\app-release.apk`

Debug was installed with app data preserved and run using Metro. Release uses the project's existing signing configuration; no signing or Firebase identity change was made.

Connected device: realme RMX3870, Android 16/API 36.

| Physical check | Observed result |
| --- | --- |
| Go Live from visible app | Native location foreground service started; Home showed Connected |
| Minimized / Android Settings active | Same native foreground service remained running |
| Overlay permission denied | Service remained running; no floating window |
| Screen locked | Foreground service remained running across the lock interval |
| Force Stop | Service stopped; saved explicit Online preference remained true |
| Explicitly reopen app | Native foreground sharing recovered while visible |
| Manual Offline with no active trip | UI became Offline, saved preference became false, service disappeared |
| Real notification inbox | Two existing backend records rendered; missing server unread total remained unknown |
| Actual incoming road offer and navigation comparison | Pending deployed backend and approved offer |
| Real wallet/payment/payout push | Pending deployed backend and genuine approved event |
| Overlay grant and interactions | Deferred to Play Store testing by user |
| GPS revocation, battery restrictions, reboot, tablet and extended network-loss scenarios | Not claimed as physically verified |

The phone was left Offline after testing.

Genuine screenshots are in `D:\PU\PickUp-raj_driver\artifacts`:

- `background-go-live-disclosure.png`
- `background-online-connected.png`
- `background-final-home.png`
- `background-overlay-opt-in.png`
- `background-permission-blocked.png`
- `background-manual-offline.png`
- `background-inbox-final.png`

No requested live-offer, wallet-threshold, payout or successful-overlay screenshot was fabricated.

## Remaining work before claiming production completion

Review/deploy the backend patches and migrations, configure approved wallet thresholds and existing Admin credentials, verify deployment identities, and run controlled real-event tests. Compare incoming and Navigation routes for the same persisted coordinates. Complete the explicitly deferred Play Store overlay tests and the remaining OS/device matrix. The implementation does not claim permanent availability after Force Stop or claim production readiness from APK assembly.
