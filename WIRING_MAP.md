# Wiring map — Customer App

How screens connect, and where each talks to the engine / payments backend. Run
`node scripts/check-wiring.js` to verify navigation targets. (It reports pre-existing warnings for
tab routes and nested navigator containers, which it does not model.)

## Navigators (`App.tsx`)

- `AuthNavigator` — Login → SignUp / OtpVerification → CreateProfile.
- `MainNavigator` → `MainTabs` (Home, Trips, Profile), `BookingStack`, `ActiveTripStack`, plus
  global/profile/support screens and a `Gallery` dev launcher.

## Booking (real flow)

```
Home → AddressSearch → SelectDropLocation → SelectVehicle → GoodsDetails → GoodsInsurance
  → ReceiverDetails → FareEstimate → ReviewBooking → (PaymentMethod) → BookingConfirmed
  → FindingDriver
```

- **FareEstimate** → `POST /v1/fare/quotes` (payments). Shows the server fare; re-quotes on any
  route/vehicle/weight change; Continue is disabled without a valid quote.
- **PaymentMethod** → sets `PAY_AT_PICKUP` / `PAY_AT_DELIVERY` in `BookingContext`. Two options
  only; the prepaid chain (PaymentSelection/Processing/Pending/Successful/Failed/Confirmation/
  MethodSelected/CashPaymentStatus) has been removed.
- **ReviewBooking** → Book requires an unexpired quote **and** a chosen method; guarded against
  double-tap.
- **FindingDriver** → `GET /drivers/nearby`, then `POST /rides { quoteId, paymentMethod, driverId }`
  per candidate until one accepts (client dispatch; the engine has no server-side matching).

## Active trip (`ActiveTripStack`)

```
FindingDriver → DriverFound → DriverAssigned → PickupOtpVerification → CustomerLiveTracking
  → (CurrentDropDetails / NextDrop per drop) → FinalDeliverySummary → DigitalReceipt / TripCompleted
```

- Trip status is polled from the engine (`GET /trips/:id`, `useTripStatus`); no websockets.
- **Handover OTPs** come from `GET /rides/:id/otps` (`useRideOtps`). The pickup OTP and each drop
  OTP are withheld by the server until the payment backend authorizes that handover:
  - **DriverAssigned** shows a "payment at pickup" hint for pay-at-pickup (no OTP yet).
  - **PickupOtpVerification** shows the pickup OTP only once released; otherwise "payment required
    to start the trip".
  - **CustomerLiveTracking** shows the pickup OTP, then the current drop's OTP once that drop's
    payment is confirmed.
- Cancellation: `POST /rides/:id/cancel` (before assignment) or `POST /trips/:id/cancel`, with a
  reason and no client identity.

## State & API

- `src/state/BookingContext.tsx` — `draft` (pickup, drops, vehicle, weight, `quote`,
  `paymentMethod`), `ride`, `trip`, and `customerId` = Firebase uid.
- `src/api/engine.ts` — rides, trips, nearby drivers, gated OTPs, cancellations.
- `src/api/payments.ts` — `/v1` customer account, fare quotes, booking payment view.
- `src/api/http.ts` — engine transport (Firebase bearer, one 401 refresh, retry/backoff for GETs).

## Gallery-only / edge screens

Alternate layouts and error/edge states (e.g. ValidateBooking, ActiveTripTracking, Error,
SearchUnavailable, EmptyState, LoadingSkeleton) are reachable from the `Gallery` route by design,
not from the linear journey.
