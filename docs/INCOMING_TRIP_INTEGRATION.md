# Incoming trips: UI and API audit (2026-11-02)

## Read-only Customer reference, before implementation

Customer uses Inter, navy primary (#03071D), light neutral canvas (#F7F9FC), white rounded cards, restrained borders and map/bottom-sheet composition. Driver already has equivalent theme tokens; reuse them. Customer pickup, ordered drops, goods weight and vehicle selection feed a server fare quote. Changes invalidate the quote. FindingDriver calls matching with quoteId, paymentMethod, pickup address and ordered drop/receiver details. The current matching implementation POSTs once, then polls the booking; server dispatch owns driver selection. Coordinates/price come from the quote. No client fare or OTP may be invented. Customer source remains read-only. The inspected local raj_engine snapshot still requires driverId in POST /rides, unlike current Customer source: deployed compatibility must be verified, not assumed from either local snapshot.

## Existing Driver / backend contracts

- GET /ride-requests/:authenticatedUid returns persisted pending offers, offerId, rideId, coordinates, ordered drops, vehicle category, weight (kg), customer fare and expiresAt. It does not supply Partner net earnings, goods description, package count, vehicle capacity or routed distance.
- PATCH /drivers/:uid/availability and /location publish availability and GPS; native session tracking owns continuous location publication.
- POST /rides/:rideId/accept locks the booking, validates targeting/expiry/eligibility and prevents competing assignments. Same-driver repeat returns the existing trip. POST /rides/:rideId/reject declines. Client deduplication supplements server atomicity.
- GET /trips/active/driver/:uid and GET /trips/:id restore authoritative state. Arrival, pickup OTP, start, drop arrival, drop OTP, delivery, failure and explicit completion are separate existing operations. Payment/outbox confirmation can leave completion pending.
- POST /v1/driver/routes/road requires an assigned trip UUID. It cannot authorize routing an unaccepted offer. Offer distances must be explicitly approximate sums of coordinate legs; fresh driver GPS is required for pickup distance.
- Current full-screen TripOffer navigation and paused polling allow stale presentation. The existing mapper wrongly labels customer fare as earnings and fabricates an expiry for missing deadlines.

## Notification / evidence gaps

Driver already registers Firebase tokens per authenticated recipient, handles refresh/logout, deduplicates recipient-validated messages, requests Android notification permission and creates high-importance `ride_updates`. FCM notification payloads render through Android while backgrounded, without overlays/full-screen intents. No offer-dispatch FCM sender exists in the inspected engine. Payments notifications use a legacy FCM sender and return simulated success without a server key; deployed delivery is unverified. No new FCM event name or notification action contract is assumed.

Delivery confirm currently sends `photo: { uri }`; the engine stores proof URI/metadata and awaits payment confirmation. A phone-local URI is not uploaded image bytes. Private durable photo upload/retrieval, historical vehicle snapshot and Partner earnings offer contracts require backend work. Existing truthful history/evidence unavailable states must remain.

## Device / environment

ADB identifies realme RMX3870 (Android 16) and installed packages com.multipleride.customer (Pick Up) and com.multipleride.driver (MultipleRide Partner), confirmed against Android configuration. Customer has a dedicated EXPO_PUBLIC_ENGINE_API_BASE_URL override: both projects' resolved engine host is pickup-engine.onrender.com; payments use pickup-backend-engine-v2.onrender.com. The initial audit missed this override; the raw legacy API variables alone do not establish a mismatch. No verified staging/payment test configuration is available. User explicitly approves a controlled live Mini Truck booking, current-location pickup, Jodhpur destination, under 500 kg and Cash. Use 10 kg and preserve both sessions. Do not claim the installed Customer binary matches the independently changing source tree.

## Planned implementation

Use a session-scoped, non-modal offer surface above the live safe-area tab bar. Keep underlying tabs usable, allow collapse and restore, reconcile against backend polls/foreground refresh, and navigate only after explicit backend-confirmed acceptance. Use actual deadline, weight and category; show unavailable Partner offer amount. Recheck current identity, offer and expiry before mutations; retain errors/reconcile uncertain outcomes. Preserve and verify existing lifecycle rather than manufacturing missing server operations.

## Implemented Driver changes

- Reused TripOfferSheet as a compact, collapsible, non-modal card mounted once across authenticated Main tabs. No offer arrival navigation. Tab scenes reserve the measured offer height; controls remain above the existing dynamic system inset and tab row. Scrollable details and 48dp actions support smaller screens, tablets and increased font scale.
- IncomingOffers serializes polls and actions, revalidates the authenticated Partner and current server offer before either action, expires against the actual deadline, handles failures without inventing success, and deduplicates competing Accept/Decline taps. Availability writes settle before acceptance/offline transitions. Polling runs while foregrounded and explicitly LIVE, independent of tab focus.
- Only confirmed explicit Accept navigates to ActiveTrip. The legacy route now consumes the live inbox, ignores offer params as proof of validity and reuses the same card.
- Missing expiry fails closed. Weight/category use the offer record. Customer fare is never rendered as Partner offer earnings; the inspected contract has no Partner offer amount, so the card says Not supplied. No fake goods/capacity/ETA.
- Both incoming distances are approximate Haversine values. Pickup distance requires a fix no older than 30s, no more than 5s in the future, accuracy 0–100m, and valid coordinates; it updates with fresh fixes. Delivery distance sums pickup → each drop in backend order. Missing/invalid coordinates yield unavailable. Assigned-trip road routing remains the existing authorized provider.
- Recipient-validated/deduplicated foreground pushes now request an authenticated inbox refresh. Push payloads never assign trips. Existing Android permission, token refresh, recipient validation, logout cleanup and notification rendering remain. No overlay permission, full-screen intent or invented action endpoint was added.
- Acceptance fallback must belong to the requested ride; decline failure propagates. TripController guards asynchronous work against logout/account changes and stale restoration. Recovery re-reads a known trip if the active index disappears, so cancellation/completion can replace stale state. An unfinished restored trip remains accessible on Home before LIVE is toggled.
- Active screens refresh on focus/resume, show actual weight/category and backend status instead of an invented On Time claim. Arrival → pickup OTP → Start → each drop arrival/OTP/evidence → explicit Complete remain separate server operations. Completion requires confirmed COMPLETED, not merely delivered or a missing completion flag.
- Completion removed its mock-trip fallback and customer-fare-as-earnings display. It reuses actual history financial records, settlement, weight, measurement availability, historical vehicle availability and photo-reference gallery. Recap no longer marks every pending/failed drop as successful.

## Actual APIs used

Existing engine routes: PATCH /drivers/:uid/availability; native PATCH /drivers/:uid/location; GET /ride-requests/:uid; POST /rides/:rideId/accept and /reject; GET /trips/active/driver/:uid; GET /trips/:id; POST /trips/:id/arrive, /pickup/verify-otp, /start, /stop/arrive, /stop/verify-otp, /stop/confirm-delivery, /stop/fail, /refresh, /complete. Existing payments collection: POST /v1/trips/:paymentTripId/collections with server amount, stop sequence and idempotency key. Earnings/history use the existing authenticated adapters. No new backend endpoints, Socket.IO events or production backend source changes.

## Connected phone: cooperative controlled live test

Device: realme RMX3870 / Android 16, ADB HY9P4PSOM775UOGU. Both existing sessions preserved. Final release installed with adb install -r; Customer source and binary unchanged.

The user approved a Mini Truck, current-location pickup in Luni Tehsil, Jodhpur, less than 500 kg and Cash. The actual test used 10 kg, description Controlled integration test, ₹1 declared test value, no insurance, and the existing two-drop draft (Bhagat Ki Koth Railway Station, then Luni Tehsil). The server quoted ₹614.90. The user separately confirmed physical pickup/drop arrival, actual cash receipt and each real wallet debit.

| Check | Actual result |
| --- | --- |
| Customer booking | Confirmed once through installed Pick Up; no duplicate booking or online charge initiated |
| Incoming acceptance | User manually accepted the real offer; agent did not capture the incoming card before acceptance |
| Offer distances visible on phone | Unconfirmed; user could not confirm both were visible |
| Assignment | Both apps converged on the same two-drop, 10 kg trip |
| Pickup arrival | Backend confirmed DRIVER_ARRIVED |
| Pickup OTP | Actual gated Customer four-digit code entered in Partner, backend verification succeeded; code not printed |
| Start | Separate Start succeeded; Partner In transit and Customer On the way to the drop |
| Drop 1 | Backend arrival, ₹339.90 cash receipt, ₹33.99 wallet fee explicitly approved, real receiver OTP verified; user completed photo/delivery confirmation on phone; both apps reported delivered |
| Drop 2 | User confirmed location/cash/camera readiness; backend arrival, ₹275 cash receipt, ₹27.50 wallet fee verified within approved cap, actual receiver OTP succeeded. Agent captured a real camera photo; user explicitly chose the dark test image and completed photo confirmation on phone |
| Completion | Agent invoked separate COMPLETE TRIP after backend confirmed both drops; both apps confirmed completion |
| Financial reconciliation | ₹614.90 gross − ₹61.49 platform fee = ₹553.41 net; Cash / Settled in cash. ₹0 other deductions and TDS shown |
| Real financial effect | Two approved cash records; total real Partner wallet fees ₹61.49. No QR/UPI payment was initiated |
| History / final build | After final release reinstall, All Trips (3), Completed (3), Cancelled (0); newest record showed ₹553.41; detail repeated gross, fee and cash settlement |
| Photos / historical vehicle | Both drops have DEVICE_ONLY photo-reference metadata and unavailable secure previews. Historical model/registration were not recorded. No fabricated image or vehicle snapshot |
| Road service | Road routing unavailable during device checks; existing UI displayed the failure. No exact road-distance verification |
| FCM / other apps / locked / killed | Not verified with real offer FCM delivery; do not infer success from app acceptance/builds |
| Restart with active trip | Automated restoration/race checks passed; physical reinstall was after completion, not an active-trip restart test |
| Phone/tablet/insets | Automated cases cover smaller phone, tablet, landscape and larger fonts; physical checks only on this realme phone |

This was a cooperative real test: the user also operated the phone, including acceptance and photo confirmations. Screenshots below reflect observed device states, not static fixtures.

## Notification configuration and remaining infrastructure

Android POST_NOTIFICATIONS is granted on this phone. Driver creates ride_updates with IMPORTANCE_HIGH (4) and standard default sound; the inspected device channel is high importance. Existing FCM notification payloads can be rendered by Android while backgrounded, and the existing background handler avoids a second local notification. User/OS battery, lock-screen, permission and channel settings still apply.

The inspected engine has no persisted-offer FCM emission integration. Payments notification delivery uses a legacy FCM sender and simulated success when unconfigured; deployed credentials/delivery have not been validated. Backend must connect persisted targeted offers to real FCM sending, proper recipient/token lifecycle, per-offer deadline/TTL and cancellation/expiry reconciliation. Use the existing ride_updates channel and high transport priority for urgent offers, then test actual foreground/background/locked/terminated delivery. Native Accept/Decline notification actions are not implemented by the existing architecture; notification taps still use the existing authenticated inbox. No foreground sound/haptic preference contract was invented.

Cold launch still begins searching availability OFFLINE until LIVE is enabled; a pending offer following a killed-app notification is not independently restored into the offer card in that state. The active-trip restoration path is separate and retained. This limitation must be addressed/tested with an authoritative persisted availability and offer-notification contract before claiming killed-app actionable offers.

Secure delivery-image binary upload, durable private object references and authorized thumbnail/original retrieval are missing from the inspected contract. Sending photo:{uri} and receiving DELIVERED proves the backend recorded delivery, not that image bytes were uploaded. The real history check confirmed both photo references are device-only. A backend upload/retrieval contract is required; onboarding/private-document access must not be reused for unrelated trip images without authorization.

Other missing offer data: Partner offered/net amount, goods description/package count, capacity, pre-acceptance road routing and actual historical vehicle model/registration. Missing fields stay unavailable. No Customer/backend code was modified to work around these gaps.

## Verification results

- npm run typecheck: PASS.
- Full Jest suite: 46 suites / 491 tests PASS. Includes incoming rendering/no auto-navigation, expiry, coordinate/ordered-drop distances, fresh/missing/stale GPS, cancelled/taken offer preflight, duplicate/conflicting actions, failure/session races, active restoration/cancellation, pickup/drop/payment steps and completion/history reconciliation.
- Changed-file ESLint: 0 errors, one existing react/no-unstable-nested-components warning in MainTabNavigator's tabBarIcon render callback.
- Android assembleDebug + assembleRelease: BUILD SUCCESSFUL (final run 1m 9s; 1,215 tasks, 34 executed).
- git diff --check: PASS (existing LF/CRLF conversion notices only).
- Mock tests do not prove real FCM, competing-Partner backend transactions, private photo upload or physical tablet behavior. Those are explicitly unverified.

APKs: [debug](D:/PU/PickUp-raj_driver/android/app/build/outputs/apk/debug/app-debug.apk), [release](D:/PU/PickUp-raj_driver/android/app/build/outputs/apk/release/app-release.apk). Debug uses Metro for JavaScript; final release was installed and tested.

## Genuine device screenshots

- [Assigned Partner trip](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-after-booking.png)
- [Pickup arrival](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-arrived.png)
- [Pickup verified](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-pickup-verified.png)
- [In-transit Partner](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-started.png)
- [In-transit Customer](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/customer-started.png)
- [Drop 1 payment gate](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-drop-arrived.png)
- [Drop 1 cash confirmed](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-cash-confirmed.png)
- [Actual camera capture review](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/drop2-camera-review.png)
- [All drops delivered](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-all-drops-delivered.png)
- [Driver completion](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-completed.png)
- [Customer completion](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/customer-completed.png)
- [Final-build Trip History](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-history.png)
- [History photo availability](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-history-finance.png)
- [History settlement](D:/PU/PickUp-raj_driver/artifacts/incoming-trip/driver-history-settlement.png)

No genuine incoming-card, both-distances or other-app heads-up screenshot was captured; none has been fabricated.

## Exact files changed for this request

- [src/components/organisms/TripOfferSheet.tsx](D:/PU/PickUp-raj_driver/src/components/organisms/TripOfferSheet.tsx)
- [src/components/organisms/JourneyRecap.tsx](D:/PU/PickUp-raj_driver/src/components/organisms/JourneyRecap.tsx)
- [src/components/trips/IncomingTripOffer.tsx](D:/PU/PickUp-raj_driver/src/components/trips/IncomingTripOffer.tsx)
- [src/hooks/useDriverDispatch.ts](D:/PU/PickUp-raj_driver/src/hooks/useDriverDispatch.ts)
- [src/navigation/MainTabNavigator.tsx](D:/PU/PickUp-raj_driver/src/navigation/MainTabNavigator.tsx)
- [src/screens/home/DriverHomeScreen.tsx](D:/PU/PickUp-raj_driver/src/screens/home/DriverHomeScreen.tsx)
- [src/screens/trip/NewTripOfferScreen.tsx](D:/PU/PickUp-raj_driver/src/screens/trip/NewTripOfferScreen.tsx)
- [src/screens/trip/ActiveTripScreen.tsx](D:/PU/PickUp-raj_driver/src/screens/trip/ActiveTripScreen.tsx)
- [src/screens/trip/MultiStopJourneyScreen.tsx](D:/PU/PickUp-raj_driver/src/screens/trip/MultiStopJourneyScreen.tsx)
- [src/screens/trip/TripCompletedScreen.tsx](D:/PU/PickUp-raj_driver/src/screens/trip/TripCompletedScreen.tsx)
- [src/screens/trip/DropOTPScreen.tsx](D:/PU/PickUp-raj_driver/src/screens/trip/DropOTPScreen.tsx)
- [src/screens/trip/DeliveryProofPreviewScreen.tsx](D:/PU/PickUp-raj_driver/src/screens/trip/DeliveryProofPreviewScreen.tsx)
- [src/services/trip/IncomingOffers.ts](D:/PU/PickUp-raj_driver/src/services/trip/IncomingOffers.ts)
- [src/services/trip/incomingOfferRuntime.ts](D:/PU/PickUp-raj_driver/src/services/trip/incomingOfferRuntime.ts)
- [src/services/trip/offerDistances.ts](D:/PU/PickUp-raj_driver/src/services/trip/offerDistances.ts)
- [src/services/trip/TripController.ts](D:/PU/PickUp-raj_driver/src/services/trip/TripController.ts)
- [src/services/trip/TripService.ts](D:/PU/PickUp-raj_driver/src/services/trip/TripService.ts)
- [src/services/engine/dispatch.ts](D:/PU/PickUp-raj_driver/src/services/engine/dispatch.ts)
- [src/services/tracking/TrackingService.ts](D:/PU/PickUp-raj_driver/src/services/tracking/TrackingService.ts)
- [src/services/notifications/notifications.ts](D:/PU/PickUp-raj_driver/src/services/notifications/notifications.ts)
- [src/types/trip.ts](D:/PU/PickUp-raj_driver/src/types/trip.ts)
- [__tests__/incomingOffers.test.ts](D:/PU/PickUp-raj_driver/__tests__/incomingOffers.test.ts)
- [__tests__/incomingOfferUI.test.tsx](D:/PU/PickUp-raj_driver/__tests__/incomingOfferUI.test.tsx)
- [__tests__/tripCompletionSummary.test.tsx](D:/PU/PickUp-raj_driver/__tests__/tripCompletionSummary.test.tsx)
- [__tests__/dispatch.test.ts](D:/PU/PickUp-raj_driver/__tests__/dispatch.test.ts)
- [__tests__/tripFlow.test.ts](D:/PU/PickUp-raj_driver/__tests__/tripFlow.test.ts)
- [__tests__/trackingLifecycle.test.ts](D:/PU/PickUp-raj_driver/__tests__/trackingLifecycle.test.ts)
- [docs/INCOMING_TRIP_INTEGRATION.md](D:/PU/PickUp-raj_driver/docs/INCOMING_TRIP_INTEGRATION.md)

Pre-existing uncommitted Driver edits were preserved. Generated device XML/screenshots remain in ignored artifacts/incoming-trip; test/build logs are ignored. No commit/push was performed for this request.

