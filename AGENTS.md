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
locations → goods → vehicle → FareEstimate (POST /v1/fare/quotes) → PaymentMethod (two options)
  → ReviewBooking (book needs an unexpired quote + a chosen method) → BookingConfirmed
  → FindingDriver (POST /rides {quoteId, paymentMethod, driverId}) → DriverAssigned
  → PickupOtpVerification → CustomerLiveTracking → (per drop) → TripCompleted
```

- No local fare is ever calculated or sent. The server quote is the only fare; any change to the
  route, vehicle or weight discards the quote and forces a new one (`BookingContext`).
- Payment methods are exactly **PAY_AT_PICKUP** and **PAY_AT_DELIVERY**. There is no prepaid /
  pay-now flow; those screens were removed.

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
