# PICKUP Customer App — Project Context for AI Assistants

> Read this file before changing code.

## What this is

PICKUP is the **customer-side** React Native app for a multi-drop logistics/delivery service.
It is a real app wired to two backends (not a mock-only prototype):

- **Trip engine** (dispatch, rides, trips, live state, handover OTPs) — `env.apiBaseUrl`.
- **Payments backend** (`/v1`: fare quotes, customer account, booking payment state, the payment
  gate) — `env.paymentsApiBaseUrl`.

> History: this started as a UI-only Expo prototype with hardcoded mock data. It is now bare
> React Native (no Expo) integrated with the Phase 8 engine/backend contracts. The old
> "mock only, no API calls, Pay Now / prepaid" rules are obsolete — do not reintroduce them.

## Tech stack

| Tech | Version | Purpose |
|---|---|---|
| React Native | 0.81.5 | Core framework (bare RN, not Expo) |
| React | 19.1.0 | UI |
| TypeScript | 5.9 | Types |
| React Navigation (native-stack + bottom-tabs) | 7.x | Navigation |
| @react-native-firebase/auth | 26.x | Customer authentication |
| react-native-config | 1.7 | Build-time env (`EXPO_PUBLIC_*` names kept for continuity) |
| react-native-maps | 1.20 | Maps |
| Jest 29 + react-test-renderer 19 | | Tests (API/state/logic) |

Entry: `index.js` → `App.tsx`.

## Frozen ownership (do not re-implement on the client)

- The **engine** owns dispatch, driver assignment, the trip lifecycle, stop progression, the OTP
  operational flow, and live trip/location state.
- The **payments backend** owns fare, quote, payment, paymentGate, collection, financial
  confirmation, earnings, settlement, payout, refund and audit.
- The Customer App is **never authoritative** for fare, payment status, payment confirmation,
  handover authorization, delivery completion or stop completion. It displays server state.

## Booking flow (the real path)

```
locations -> vehicle -> goods/value -> ReviewBooking (server fare + payment preference/timing)
  -> in-place finding/result (durable POST /rides, server-owned dispatch)
  -> Trip Details -> pickup OTP -> live tracking -> completion
```

- No local fare is ever calculated or sent. The server quote is the only fare; any change to the
  route, vehicle or weight discards the quote and forces a new one (`BookingContext`).
- Payment timing remains exactly **PAY_AT_PICKUP** and **PAY_AT_DELIVERY**. Cash/UPI on the merged review is a collection preference sent in existing booking metadata instructions, not a new payment timing or payment confirmation. Actual collection/paid state remains backend-owned. There is no prepaid/pay-now flow. FareEstimateScreen and PaymentMethodScreen were removed; use ReviewBookingScreen only.

## OTP / payment gate (security)

- The pickup and drop OTPs come only from the gated engine route `GET /rides/:id/otps`. The
  server withholds a code until the payment backend allows that handover; the app shows whatever
  the server releases and never derives or logs an OTP.
- The payment state the UI shows comes from `GET /v1/bookings/:paymentBookingId` (the customer
  payment gate and per-drop state). Never show "paid" from local state.

## Auth / identity

- Firebase is the single auth. Every protected request carries the Firebase ID token (see
  `src/api/http.ts` and `src/api/payments.ts`); it is refreshed once on a 401. The customer's id
  is the Firebase uid (the token subject) — never a client-supplied id. Call `POST /v1/customers/me`
  after sign-in (done in `SessionContext`).

## Conventions that still hold

1. Screens receive `navigation` as a prop; do not use `useNavigation()`.
2. Theme tokens only (`src/theme.ts`) — no hardcoded colours/sizes.
3. Reuse the existing atoms/molecules/organisms in `src/components/`.
4. No dead buttons; run `node scripts/check-wiring.js`.
5. Customer-only app: no driver/admin features.
6. Do not add new features/screens/flows without explicit instruction.

## Layout

```
src/
  api/        http.ts, engine.ts, payments.ts, types.ts, matching.ts, geocoding.ts, directions.ts
  state/      BookingContext.tsx (draft, quote, paymentMethod, ride/trip), SessionContext.tsx
  hooks/      useTripStatus.ts, useRideOtps.ts, useRoute.ts, useNearbyDrivers.ts, ...
  screens/    auth, booking, payment, tracking, logistics, profile, support, home
  data/       mockData.ts (labels, vehicle catalogue + category codes), paymentMethods.ts
config/env.ts  apiBaseUrl, paymentsApiBaseUrl, googleMapsApiKey
__tests__/     Jest (API/state/logic)
```

## Running

```
npm install
npm run typecheck
npm test
npm run check:wiring   # navigation wiring (pre-existing warnings for tab/nested routes)
```

## Read-only vehicle map preview (user approved 2026-11-01)

The vehicle-selection map may display nearby vehicle icons through the authenticated Engine `/drivers/preview` contract (`useVehiclePreview`). This is display-only and never selects a driver, controls dispatch, promises availability, or supplies an identity to booking creation. Do not re-enable the legacy `useNearbyDrivers` enumeration/count hook. No driver counts or fabricated movement: use only verified category, fresh GPS and actual-coordinate interpolation. Pause on blur/background, abort on category/account changes, expire old markers. See `engine/docs/CUSTOMER_VEHICLE_PREVIEW.md` for deployment and existing process-local presence limits.

## Booking-screen refresh (2026-11-01)

ReviewBookingScreen owns the in-place search UI after Book. BookingConfirmedScreen was removed. FindingDriverScreen is a recovery/deep-link wrapper around that same review component in searchMode; do not reintroduce a separate finding layout. useBookingSearch reuses the durable matching API and server-owned dispatch. Cross-stack transitions use resetBookingDestination because SelectVehicle belongs to BookingStack and assignment/cancellation/result belong to ActiveTripStack. Keep draft details on vehicle change and never treat the loading animation as a timeout. The user explicitly deferred emulator builds/installs until new refresh milestone M6. M4 response-window/live-preview and M5 in-place no-driver result are implemented in source; M6 deployment/native/live validation remains pending.

NoDriversAvailableScreen is now also a legacy recovery wrapper around the same finding/review result UI. Server exhaustion sets an in-place result; it never navigates to a separate failure popup. Try again explicitly retries the same registered booking; its frozen server fare remains authoritative even after the original quote expires. Home/vehicle actions call leaveFailedSearch first. Vehicle change preserves details and gets a new quote; it never silently books a changed price. Foreground/focus recovery reads status and must not replay a prior dispatch retry.
