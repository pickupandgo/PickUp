# PICKUP — Customer App

Customer-side React Native app for a multi-drop logistics/delivery service, integrated with the
Pickup-Go trip engine and the payments backend (Phase 8 contracts).

> This was once a UI-only Expo prototype with mock data. It is now **bare React Native** (no Expo)
> wired to real services. The older README describing "Expo, mock-only, no API calls" is obsolete.

## Architecture

- **Trip engine** (`env.apiBaseUrl`): dispatch, rides, trips, live trip/location state, and the
  gated handover OTPs (`GET /rides/:id/otps`).
- **Payments backend** (`env.paymentsApiBaseUrl`, `/v1`): fare quotes, the customer account
  (`POST /v1/customers/me`), and the booking payment view with the payment gate and per-drop
  state (`GET /v1/bookings/:id`).

The client is never authoritative for money. It sends a server **fare quote id** and a **payment
method**, and displays server state; it never sends or computes a fare, and never infers a paid
or delivered state locally.

## Booking and payment

1. Pick locations, goods and a vehicle.
2. `POST /v1/fare/quotes` → the server prices the route; the app shows the fare. Any change to the
   route, vehicle or weight discards the quote and asks for a new one. Booking is disabled without
   an unexpired quote.
3. Choose a payment method — exactly **Pay at pickup** or **Pay at delivery**. No prepaid/pay-now.
4. Confirm → `POST /rides { quoteId, paymentMethod, driverId }`.
5. A driver is found and assigned; the trip is tracked live.
6. Pay at pickup: the pickup OTP is withheld until payment is confirmed. Pay at delivery: each
   drop is paid at delivery, tracked per drop; one drop's payment never satisfies another.

## Auth

Firebase authentication (phone, with email/Google/Apple requiring a verified phone). Every
protected request carries the Firebase ID token, refreshed once on a 401. The customer id is the
Firebase uid; the client never supplies an identity.

## Environment

Set in a build-time `.env` (see `.env.example`):

```
EXPO_PUBLIC_API_BASE_URL=            # trip engine base URL (https in release)
EXPO_PUBLIC_PAYMENTS_API_BASE_URL=   # payments backend base URL (https in release)
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=     # Google Maps Platform key
```

The payments base URL is accepted only over https in release builds (plain http is allowed only in
development builds), so tokens are never sent in clear text.

## Develop

```
npm install
npm run typecheck     # tsc --noEmit
npm test              # Jest (API / state / logic)
npm run check:wiring  # navigation wiring check
npm start             # Metro
npm run android       # or: npm run ios
```

## Tests

Jest covers the integration-sensitive layer: the engine and payments clients (booking body,
quote, auth/401 refresh, gated OTPs), the booking state (quote invalidation), and the payment
options (exact copy, no prepaid). See `__tests__/`.
