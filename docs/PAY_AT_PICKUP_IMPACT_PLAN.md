# PAY AT PICKUP: impact plan (A–V)

> **Superseded where they conflict by [`PAYMENT_FLOW_FINAL_REVIEW.md`](PAYMENT_FLOW_FINAL_REVIEW.md)**
> (master prompt review, 14 Oct 2026). In particular, the refund, no-show and undelivered-stop
> policies (D-67, D-68, D-70) are open business decisions, and the stop backfill (D-69) is replaced
> by the legacy booking model.

Scope: replace "Pay Now" (online, before driver assignment) with "Pay at Pickup" (after the driver
arrives, before handover). Pay at Delivery stays as approved.

Inspected:

- `raj_backend`: HEAD `dc54485` plus the uncommitted M2/M3 work
- driver app: `PickUp`, branch raj_driver, `27abd4f`
- customer app: `raj_customer`, `9e36582`
- engine: `origin/engine-v2`, `4555ade`
- `engine-payment-integration/spec.html`

**No code has been changed for this spec.**

---

## 0. What the inspection found

| # | Finding (current code) | Consequence |
|---|---|---|
| F1 | **PAY_AT_PICKUP already exists in the backend.** It has an enum value and cash/QR collections with stage `PICKUP`. Collection is allowed from `DRIVER_ARRIVED` until `DELIVERED` (`trip-lifecycle.ts`, `PICKUP_COLLECTION_WINDOW`). Only `COMPLETED` is gated: `BookingsService.complete()`, DB `bookings_completed_is_paid` and `guard_trip_change`. | Today an **unpaid** PAY_AT_PICKUP trip can be pickup-verified, started and delivered. The change is mostly a **gate**, not a new flow. |
| F2 | **"Pay Now" is `PREPAID_UPI`.** It uses customer Razorpay Checkout (`POST /v1/bookings/:id/payment` and `/verify`), `BookingPaymentFinalizerService`, and creates an ONLINE earning from the payment. **No dispatch gate exists in code:** `markSearching` and `assignDriver` never check payment. "Pay before assignment" exists only in `spec.html` §6.1 and in my unbuilt M4 plan. | Nothing to undo in dispatch. The prepaid path is retired, not redesigned. |
| F3 | **PAY_AT_DELIVERY in code is one collection for the whole booking, allowed only after the last drop** (`DELIVERY_COLLECTION_WINDOW = {DELIVERED}`, the safe default from D-19/D-50). The payment backend has no stops. | Conflicts with Parts 6–8 (pay per drop, before handover). The approved per-drop model (M4–M6) is **not built yet**. It is the largest part of this work. |
| F4 | **engine-v2 has no payment integration.** It has no payment fields and makes no `/v1/internal/*` calls. It accepts a client fare (`rides.service.ts:72`) and has a pickup path with no OTP (`POST /trips/:id/pickup/confirm`). | Engine work belongs to your friend (D-51). `spec.html` must be rewritten. |
| F5 | **The driver app runs arrive → pickup OTP → start as one call chain** (`advanceTripTo` via `TripController.verifyPickupOTP`). It auto-completes after the last drop, and `DeliveryProofPreviewScreen` goes to TripCompleted even when the confirm call fails. Payment never gates the trip buttons. `collectAvailability` treats PREPAID_UPI as paid even while UNPAID. | The pickup flow must be split and gated on backend state. |
| F6 | **The customer app never calls the payment backend** (no `/v1` calls). Fares are computed locally and sent to the engine (`CreateRideInput.fare`). Today's options are UPI / Cash on Delivery / Cash at Pickup; "UPI" leads to a static QR image and a mock "Pay ₹X" chain. `AGENTS.md` still says Expo with mock data only. | Needs a new payments client, quote, the two options and the pickup prompt. `AGENTS.md` needs updating. |

## 1. Decisions to confirm before coding

| ID | Question | Recommended | Alternative |
|---|---|---|---|
| D-63 | What counts as "handover" at pickup? | **The pickup OTP step (trip `PICKUP_VERIFIED`).** For PAY_AT_PICKUP it is refused until the booking is PAID. Strict ordering then makes `IN_TRANSIT` impossible too. | Allow the OTP and gate only `IN_TRANSIT`. That breaks "no goods before payment". |
| D-64 | Can the customer pay inside the Customer App at pickup? | **No.** The customer pays cash to the driver, or scans the driver's booking-linked QR. The app shows the prompt and live status only. | In-app payment at pickup: a third channel for the same obligation, which needs extra exclusion rules. |
| D-65 | What happens to PREPAID_UPI? | **Refused for new bookings**, in the API (`422 PAYMENT_METHOD_NOT_OFFERED`) and by a DB insert trigger. The customer Checkout routes are unregistered. The prepaid-only services and tests are removed once the PAY_AT_PICKUP tests pass. The enum value stays, and so does the order/webhook code shared with wallet top-ups. | Keep the prepaid code dormant and tested behind a disabled flag. |
| D-66 | Cash at pickup when the wallet can't cover the platform fee (D-17)? | **Keep "reject; the wallet is never negative".** The trip stays at pickup until the driver recharges or the sender pays by QR. The driver app shows the required fee before the driver takes cash. | Exclude such drivers from cash bookings at assignment. This is a new dispatch rule and is not approved. |
| D-67 | The booking is cancelled after pickup payment but before handover. | **Allowed, with a reason, and flagged** in the paid-cancelled report. No automatic refund (D-22) unless `REFUND_AUTO_ON_CANCEL=before_handover` is set. QR: audited admin refund (M8). Cash: an audited admin "cash returned" record, which reverses the collection and credits the fee back to the wallet. | Forbid cancellation once paid. |
| D-68 | The sender never pays (no-show at pickup). | **No timer.** The driver or ops cancels with a reason and the open QR is closed. No charge (D-23) and no driver compensation (not approved). | Auto-cancel after N minutes. Needs a business rule. |
| D-69 | Existing rows when stops are introduced | **Backfill one stop per existing booking** (whole fare, full fee share), so there is one code path. Unfinished legacy rows the new rules can't move are listed for admin resolution. They exist only in dev; production is empty. | Version the snapshot and keep the old rules for old rows: two code paths. |
| D-70 | A drop can't be delivered on a PAY_AT_PICKUP booking (the sender already paid). | **An admin marks the stop UNDELIVERED.** The money stays collected, and the earning is recorded on what was collected. Any refund is an admin decision (M8) and puts an unpaid earning ON_HOLD. | Automatic per-drop refund. That policy is not approved. |
| D-71 | How does the engine apply the backend's gates? | **Backend first.** The engine reports `PICKUP_VERIFIED` or stop `DELIVERED` and commits its own state only after a 200. On `409 PAYMENT_REQUIRED` it refuses the driver's action. Before accepting a drop OTP it reads `paymentGate.handoverAllowed`. | The engine commits first and the backend refuses later, so goods could change hands with no recorded payment. |

With this spec, **D-19** (multi-drop) and **D-50** (collection windows) become resolved. **D-53** (QR and
cash paid at the same moment) stays as is: the QR is closed before cash is accepted, and any
leftover race is flagged.

---

## A. Current PAY NOW flow

**Customer app (mock only):**

1. `ReviewBookingScreen` "Choose Payment Method" (the mock value is Google Pay).
2. `PaymentMethodScreen` offers UPI (default), COD and Cash at Pickup.
3. UPI goes to `PaymentMethodSelectedScreen`, a static `upi_qr.png` with "Pay ₹X".
4. Then Processing → Pending → Successful.

None of this calls a backend. The ride is created later by `FindingDriverScreen` (`POST /rides` with
a client fare and no payment mode).

**Backend (built and tested):**

1. The engine registers the booking as `PREPAID_UPI` with `confirmedFarePaise`.
2. The customer calls `POST /v1/bookings/:id/payment` with an Idempotency-Key. The amount is
   `booking.finalFareMinor`. A booking has one live payment (`uq_payments_booking_active`).
3. The customer pays in Checkout.
4. Payment is confirmed by `/verify` (signature checked against our stored order id, then a Razorpay
   fetch), by the `payment.captured` webhook, or by an admin sync.
5. Payment becomes PAID and the booking PAID (`applyBookingPaid`).
6. At `DELIVERED` the trip moves to `PAYMENT_CONFIRMED` automatically, then `COMPLETED`.
7. An ONLINE earning is created: AWAITING_SETTLEMENT, then PAYABLE after settlement, then the weekly
   payout.

**Dispatch:** never checks payment. "Poll until PAID, then dispatch" exists only in `spec.html` §6.1.

**Driver app:** for PREPAID_UPI it shows "The customer paid in the app. Nothing to collect", even
while the booking is UNPAID.

**Paid booking cancelled:** allowed. It is flagged with a `PAYMENT_ANOMALY` log and appears in
`/v1/admin/reconciliation/paid-cancelled-bookings`. Nothing is refunded (D-22, D-52).

## B. New PAY AT PICKUP flow

| # | Actor | Call | Stored result |
|---|---|---|---|
| 1 | Customer App | `POST /v1/fare/quotes`, choose PAY AT PICKUP, confirm with the engine `{quoteId, paymentMethod}` | quote |
| 2 | Engine | `POST /v1/internal/bookings {externalRef, customerSubject, quoteId, paymentMethod: PAY_AT_PICKUP}` | booking `CREATED`, `UNPAID`, frozen snapshot |
| 3 | Engine | `/searching`, then dispatch **immediately**, then `/assign` | trip `DRIVER_ASSIGNED` |
| 4 | Driver App | ARRIVED → engine `/arrive` → backend `DRIVER_ARRIVED` | gate `PAYMENT_REQUIRED` (stage PICKUP, amount = booking payable) |
| 5 | Customer App | "Driver has arrived. Payment is required to start the trip." Cash to driver / ask the driver for the QR | read only |
| 6a | Driver App, cash | `POST /v1/trips/:tripId/collections {method: CASH}` + Idempotency-Key | One transaction: fee debited from the wallet, collection `COMPLETED`, booking `PAID` |
| 6b | Driver App, QR | `{method: ONLINE_QR}`, then the customer scans and pays | Collection `PENDING`. Webhook, driver poll or admin sync re-fetches from Razorpay, then collection `COMPLETED` and booking `PAID` |
| 7 | — | — | gate `PAYMENT_CONFIRMED`, `handoverAllowed = true` (trip still `DRIVER_ARRIVED`). The Customer App reveals the pickup OTP |
| 8 | Driver App | Sender OTP → engine verifies → backend `PICKUP_VERIFIED` (409 `PAYMENT_REQUIRED` if unpaid, plus a DB trigger) → engine commits | handover recorded |
| 9 | Driver App | START TRIP → engine `/start` → backend `IN_TRANSIT` | trip started |
| 10 | Each drop | stop `ARRIVED` → drop OTP → stop `DELIVERED` (no payment step) | — |
| 11 | Engine | trip `DELIVERED` → auto `PAYMENT_CONFIRMED` → `COMPLETED` | Earning. CASH: `SETTLED_IN_CASH`. QR: ONLINE, AWAITING_SETTLEMENT → PAYABLE → payout |

Failure branches:

- QR still pending: the trip stays at pickup.
- QR expired or closed: `PAYMENT_FAILED`, then a new QR or cash.
- Wallet too low: cash is refused (D-66).
- Cancel or no-show: D-67 and D-68.

## C. PAY AT DELIVERY (approved; replaces current code)

1. Register with `PAY_AT_DELIVERY` and dispatch.
2. Pickup OTP with no payment, then `IN_TRANSIT`.
3. For each **stop n, in order**:
   - stop `ARRIVED`; the gate becomes `PAYMENT_REQUIRED` (stage DROP, stop n, amount = stop n's
     frozen payable)
   - cash or QR **for stop n only**
   - stop `PAYMENT_CONFIRMED`, so `handoverAllowed` is true
   - drop OTP, then stop `DELIVERED`, then the next stop
4. If a receiver refuses: `DELIVERY_FAILED`, then either a retry (`ARRIVED`) or an admin marks it
   `UNDELIVERED`. The stop amount stays unpaid and the booking becomes `PARTIALLY_PAID`.
5. The trip becomes `DELIVERED` once every stop is DELIVERED or UNDELIVERED, then
   `PAYMENT_CONFIRMED`, then `COMPLETED`.
6. One earning per trip (`MIXED` if cash and QR were both used).

Change from the current code: this replaces the single whole-booking collection after the last drop.

## D. State-machine changes

Principle: **no new trip or booking statuses.** The spec's PAYMENT_REQUIRED, PROCESSING, FAILED and
HANDOVER_ALLOWED are derived from stored facts and exposed as `paymentGate`. New stored states appear
only where a fact has no home today: booking payment `PARTIALLY_PAID`, and stop status.

| Spec state | Stored as |
|---|---|
| BOOKING_CREATED | `bookings.status` `CREATED` / `SEARCHING_DRIVER` |
| DRIVER_ASSIGNED | `bookings.status` `DRIVER_ASSIGNED` + `trips.status` `DRIVER_ASSIGNED` |
| DRIVER_ARRIVED_AT_PICKUP | `trips.status` `DRIVER_ARRIVED` |
| PAYMENT_REQUIRED | derived: arrived + `UNPAID` + no live QR |
| PAYMENT_PROCESSING | derived: a `PENDING` ONLINE_QR collection for the obligation |
| PAYMENT_FAILED | derived: latest collection `FAILED` (expired or closed); retry allowed |
| PAYMENT_CONFIRMED (pickup) | `bookings.payment_status = PAID` + `COMPLETED` collection with stage `PICKUP` |
| HANDOVER_ALLOWED | derived: paid + trip `DRIVER_ARRIVED` (drop: stop `PAYMENT_CONFIRMED`) |
| handover done / TRIP_STARTED | `trips.status` `PICKUP_VERIFIED` / `IN_TRANSIT` |
| DRIVER_ARRIVED_AT_DROP | `booking_stops.status = ARRIVED` (trip `DROP_PROGRESS`) |
| drop PAYMENT_CONFIRMED | `booking_stops.status = PAYMENT_CONFIRMED` + `COMPLETED` collection for that stop |
| DELIVERED (drop) | `booking_stops.status = DELIVERED` |
| COMPLETED | trip `PAYMENT_CONFIRMED` → `COMPLETED`; booking `COMPLETED` (unchanged) |

The trip-level `PAYMENT_CONFIRMED` (just before `COMPLETED`) keeps its current meaning: "financially
settled". It is not the pickup confirmation.

| Rule | API | DB |
|---|---|---|
| PAY_AT_PICKUP: `DRIVER_ARRIVED → PICKUP_VERIFIED` requires booking `PAID` | `409 PAYMENT_REQUIRED {stage: PICKUP, amountPaise}` | `guard_trip_change` |
| `IN_TRANSIT` only from `PICKUP_VERIFIED` | existing strict order | existing |
| Stop `ARRIVED` only when the trip is moving, every earlier stop is final, and no other stop is current | new stop endpoint | `guard_booking_stop_change` + partial unique |
| PAY_AT_DELIVERY: stop `DELIVERED` only from `PAYMENT_CONFIRMED` | `409 PAYMENT_REQUIRED {stage: DROP, stopSequence, amountPaise}` | `guard_booking_stop_change` |
| Stop `PAYMENT_CONFIRMED` only with a `COMPLETED` collection for that stop; set by the backend only | cash transaction / finalizer | trigger |
| PAY_AT_PICKUP stop: `ARRIVED → DELIVERED` | stop endpoint | trigger (booking must be PAID) |
| Trip `DROP_PROGRESS → DELIVERED` only when every stop is DELIVERED or UNDELIVERED | `409 STOPS_PENDING` | `guard_trip_change` |
| Payment: `UNPAID → PARTIALLY_PAID → PAID`; `PAID`/`PARTIALLY_PAID → REFUND_PENDING → REFUNDED` | finalizers | `guard_booking_update` |
| Planned dispatch gate on `/searching` and `/assign` | **dropped** (never built) | — |

## E. Database changes

**Migration A, enums.** Enum values must be committed before they are used, so this is its own
migration:

- `booking_payment_status` gets `PARTIALLY_PAID`
- `earning_settlement` gets `MIXED`
- new `booking_stop_status`: PENDING, ARRIVED, PAYMENT_CONFIRMED, DELIVERED, DELIVERY_FAILED,
  UNDELIVERED

**Migration B, snapshot, stops and gates:**

- **bookings:**
  - Add `fare_quote_id` (UNIQUE, FK; one booking per quote), `pricing_version_id`, `tax_paise` and a
    frozen `platform_fee_paise`. All are immutable (extends `guard_booking_update`).
  - `final_fare_minor` stays the payable amount.
  - A BEFORE INSERT trigger refuses `PREPAID_UPI`.
  - Payment-status transitions are extended as in D.
- **booking_stops (new):**
  - Columns: `sequence` 1–5, `fare/tax/payable_paise`, `platform_fee_share_paise`, `status`,
    timestamps for arrived, payment confirmed, delivered and failed, and admin resolution fields.
  - Indexes: UNIQUE(`booking_id`, `sequence`); UNIQUE(`booking_id`, `id`) for a composite FK; a
    partial UNIQUE(`booking_id`) where the status is ARRIVED or PAYMENT_CONFIRMED (one current stop).
  - A deferred totals trigger checks that Σ payable = booking payable, Σ fee share = booking fee, and
    sequences run 1..n.
  - Amounts are immutable. Transitions are guarded. Rows cannot be deleted or truncated.
- **payment_collections:**
  - Add `booking_stop_id`, with a composite FK (`booking_id`, `booking_stop_id`) →
    `booking_stops(booking_id, id)`. A collection can never point at another booking's stop.
  - CHECK `(stage = 'PICKUP') = (booking_stop_id IS NULL)`.
  - `uq_collection_booking_active` is replaced by `uq_collection_pickup_active` (on booking_id, stage
    PICKUP, PENDING/COMPLETED) and `uq_collection_stop_active` (on booking_stop_id, stage DELIVERY,
    PENDING/COMPLETED).
  - A BEFORE INSERT guard checks: stage matches the booking's payment method; amount = booking
    payable (PICKUP) or stop payable (DELIVERY); cash fee = booking fee or the stop's fee share.
  - `booking_stop_id` is immutable.
- **trips:** `guard_trip_change` adds the pickup gate and the all-stops-final rule.
- **driver_earnings (M7):**
  - `MIXED` settlement, cash/online split columns, and an `earning_collections` link table. The link
    table replaces `earnings_single_source` for earnings fed by several collections.
  - Single-collection PAY_AT_PICKUP earnings keep their current shape.
- **payment_refunds (M8)** and **financial_events (M9)**: append-only.
- **Grants:** the API role gets SELECT, INSERT and UPDATE (status and timestamps only) on
  `booking_stops`, and DELETE nowhere. The least-privilege test is extended.
- **Backfill (D-69):** one stop per existing booking.

## F. API changes

**Internal (engine):**

- `POST /v1/internal/bookings`
  - Body: `{externalRef, customerSubject, quoteId, paymentMethod: PAY_AT_PICKUP|PAY_AT_DELIVERY}`.
    `confirmedFarePaise` and `vehicleCategory` are removed; both come from the quote. Unknown fields
    are rejected.
  - Errors: `PREPAID_UPI` → 422 `PAYMENT_METHOD_NOT_OFFERED`; quote errors 422 / 409.
  - Idempotent on `externalRef`.
  - The response adds the snapshot, `stops[]` and `paymentGate`.
- `POST /v1/internal/trips/:tripId/status`: adds the pickup gate (409 `PAYMENT_REQUIRED`) and
  `STOPS_PENDING`.
- **New** `POST /v1/internal/trips/:tripId/stops/:sequence/status {ARRIVED|DELIVERED|DELIVERY_FAILED, reason?}`.
  Strict order; repeats are no-ops.
- `GET /v1/internal/bookings/:id` and `/by-ref/:ref`: add `paymentGate` and `stops[]`.
- `/searching`, `/assign` and `/cancel`: unchanged.

**Driver:**

- `GET /v1/trips` and `/v1/trips/:id`: `payment` adds:
  - `paymentGate {stage, stopSequence, state, amountPaise, handoverAllowed, collectionId}`
  - `stops[] {sequence, payablePaise, status, paid}`
  - `cashFeePaise`
- `POST /v1/trips/:tripId/collections`:
  - adds `stopSequence`: required for PAY_AT_DELIVERY, forbidden for PAY_AT_PICKUP
  - `amountPaise` stays as a **confirmation echo only**. The server computes the amount and refuses a
    mismatched echo (a stale screen). It never uses the client's number.

**Customer:**

- `POST/GET /v1/fare/quotes` (M3)
- `GET /v1/bookings/:id`: adds payable, `stops[]` (per-drop amount, paid, delivered) and a
  customer-safe `paymentGate` (no internal ids)
- **New** `GET /v1/bookings/by-ref/:externalRef`, limited to the customer's own bookings
- `POST /v1/customers/me` (M2)
- `POST /v1/bookings/:id/payment` and `/verify`: retired (D-65)

**Admin:**

- `GET /v1/admin/bookings/:id` (the existing chain view) adds the snapshot, stops, per-stop
  collections, the gate, refunds and audit events
- `POST /v1/admin/bookings/:id/stops/:sequence/resolve` (M5)
- Refunds, including cash returned (M8)
- `GET /v1/admin/audit-logs` (M9)

## G. Engine changes (friend's work; spec.html rewrite)

1. Booking confirmation takes `{quoteId, paymentMethod}` from the customer. Delete the client `fare`,
   and take `customerSubject` from the verified token (§4.2).
2. Take the route from `GET /v1/internal/fare-quotes/:id`, so the trip run is the route that was
   priced.
3. Register with the backend (outbox, retries, idempotent `externalRef`) and **dispatch immediately
   for both methods**.
4. On `/assign`, store `paymentBookingId` / `paymentTripId` and expose them on the engine's trip API
   for both apps.
5. `/arrive` reports `DRIVER_ARRIVED` **on arrival**, as its own step.
6. Pickup OTP is backend-first (D-71). On 409 `PAYMENT_REQUIRED`, reject with "Payment required
   before handover". **Remove the no-OTP `pickup/confirm` bypass.**
7. `/start` reports `IN_TRANSIT`.
8. Report each stop: `ARRIVED`; read `handoverAllowed` before accepting a drop OTP; report
   `DELIVERED` backend-first; report `DELIVERY_FAILED` with a reason.
9. Unchanged: the `COMPLETED` retry loop and `/cancel` with a reason. The engine never sends
   `PAYMENT_CONFIRMED` or any amount.
10. Reliability: a durable outbox per status report. Treat 409 `PAYMENT_REQUIRED` as "not yet" and
    `INVALID_*` as an alert. Socket.IO, if added, carries ids and states only.

## H. Payment backend changes

- **bookings:**
  - registration v2: redeem the quote, freeze the snapshot, create stops, allocate the fee by largest
    remainder (ties to the lower sequence)
  - refuse PREPAID_UPI
  - pickup gate in `updateTripStatus`
  - new `booking-stops.service` (stop transitions) and `payment-gate.ts` (derived gate)
  - mappers and the customer by-ref route
- **collections:**
  - resolve the obligation: PICKUP is the booking; DELIVERY is the *current* stop
  - amount and fee per obligation
  - lock order booking → trip → stop → collection → wallet
  - the finalizer sets stop `PAYMENT_CONFIRMED` and booking `PARTIALLY_PAID` or `PAID`
  - QR description and notes include the stop
- **booking-payment-state.ts:** `applyBookingPaid` becomes obligation-aware.
- **earnings:** PAY_AT_PICKUP unchanged; MIXED earnings for delivery (M7).
- **payments:** retire the booking Checkout routes and services (D-65). Top-ups untouched.
- **New error codes:** `PAYMENT_METHOD_NOT_OFFERED`, `STOPS_PENDING`, `INVALID_STOP_TRANSITION`,
  `STOP_NOT_FOUND`, `STOP_REQUIRED`. `PAYMENT_REQUIRED` is reused.
- Refunds (M8), reconciliation and the audit log (M9).

## I. Customer App changes

1. **Payment option screen:**
   - exactly **PAY AT PICKUP** "Pay when the driver arrives at your pickup location." and **PAY AT
     DELIVERY** "Receiver pays when the driver arrives at the delivery location."
   - replaces the three options in `PaymentMethodScreen`
   - `ReviewBookingScreen` shows the chosen option and the **server quote** (per-drop amounts for PAY
     AT DELIVERY)
   - Book is disabled without an unexpired quote
2. **Remove the prepaid chain from the flow:** `PaymentMethodSelectedScreen` (static UPI QR),
   Processing, Pending, Successful, Failed, CashPaymentStatus, PaymentSelection, PaymentConfirmation.
   Either delete them or make them Gallery-only (`check-wiring.js` GALLERY_ONLY).
3. **Server fare only:**
   - Delete the local maths: SelectVehicle rates, the FareEstimate sum, "Taxes & Fees = fare − base",
     and the receipt's ×0.8/×0.2 split.
   - Re-quote on any route, vehicle or weight change, and on expiry.
   - Remove `CreateRideInput.fare`. Booking confirmation sends `quoteId` and `paymentMethod`.
4. **Payments-backend client:** base URL config, Firebase Bearer token, `POST /v1/customers/me` after
   sign-in. Email, Google and Apple users must add a verified phone.
5. **Pickup screen (PAY AT PICKUP):**
   - shows "Driver has arrived. Payment is required to start the trip." with the amount and two ways:
     cash to the driver, or ask the driver for the QR
   - shows live status from the backend (polling; push later, D-36)
   - **the pickup OTP is shown only after payment is confirmed** (defense in depth)
6. **Tracking (PAY AT DELIVERY):** each drop's amount and paid/delivered state. Gate the current
   drop's OTP display the same way.
7. **Receipts and history:** backend amounts and labels ("Paid at pickup: Cash/Online", "Paid by
   receivers"). No mock "Paid via UPI".
8. **AGENTS.md / WIRING_MAP.md / README** are stale (Expo, mock-only, no API calls). They need
   updating with your OK.

## J. Driver App changes

1. **Split the pickup chain:**
   - ARRIVED (button, or geofence plus confirm) calls the engine `/arrive`
   - `advanceTripTo` stops chaining arrive, OTP and start
   - START TRIP is an explicit step after the OTP
2. **ArrivedAtPickupScreen:**
   - PAY_AT_PICKUP shows "Payment required ₹X" with COLLECT CASH and SHOW QR (CollectPaymentScreen,
     stage PICKUP)
   - **ENTER SENDER OTP stays disabled until the backend says `handoverAllowed`**
3. **Drops:** for PAY_AT_DELIVERY, "Collect ₹X for drop n" comes first. The drop OTP is enabled only
   on `handoverAllowed`, and "delivered" only after the backend accepts.
4. **Collections:**
   - `collectAvailability` is driven by `paymentGate`, fixing the prepaid-while-UNPAID bug
   - CollectPaymentScreen sends `stopSequence` and shows the current obligation and its cash fee
   - the wallet shortfall is shown up front (D-66)
5. **Id mapping:** use the engine's `paymentTripId`, or match on `externalRef`.
6. **Fix error handling:** DeliveryProofPreview must not go to TripCompleted on failure, and there is
   no auto-complete without the backend.
7. i18n strings (EN/HI) and Jest tests.

## K. Razorpay / webhook changes

- No new products or events for this change:
  - live QR Codes (D-47), test-mode Payment Links
  - existing events `payment_link.*`, `qr_code.*`, `payment.captured`
  - raw-body signature check, event-id dedupe, provider re-fetch, outcome codes, the 503-and-retry
    path
- The QR stays tied to one obligation: the collection id is the reference and notes; the booking,
  stage and stop are in the notes and description.
- Customer Checkout orders for bookings are retired. Top-up orders and webhooks are unchanged.
- Refund events and API (M8).
- **Recovery job (M9):** re-fetch PENDING collections older than N minutes, for provider success
  followed by a crash.

## L. Cash collection changes

- Same endpoint. The obligation is resolved server-side: pickup = the booking; delivery = the current
  ARRIVED stop. The fee is the booking fee or the stop's fee share.
- The ledger key becomes `cash-ride-fee:<collectionId>`. One debit per collection; the live-collection
  index prevents two per obligation; existing rows keep their keys.
- Refused requests:
  - wrong or non-current stop: 409 `COLLECTION_NOT_ALLOWED`
  - already paid: 409 `BOOKING_ALREADY_PAID`
  - closed or cancelled: 409 `BOOKING_CLOSED`
  - echo mismatch: 422 `COLLECTION_AMOUNT_MISMATCH`
  - wallet: 409 `INSUFFICIENT_BALANCE` with `requiredFeePaise`
- Records are immutable (existing trigger). Corrections go through the audited admin "cash returned"
  record (D-67).

## M. Wallet and earning impact

- **PAY_AT_PICKUP:**
  - cash: the whole fee is debited at pickup (same amount as today, earlier timing); earning
    `SETTLED_IN_CASH`
  - QR: ONLINE earning, AWAITING_SETTLEMENT → PAYABLE → payout (unchanged)
- **PAY_AT_DELIVERY:**
  - fee shares are frozen per stop; each cash stop is debited at its own collection
  - one earning per trip, with cash/online split and payout = online collected − online fee (M7)
  - unpaid UNDELIVERED stops earn nothing
- Wallet: never negative (existing CHECK and ledger) and append-only (existing trigger). Earnings: one
  per booking (existing unique).
- Failed payout puts the earning ON_HOLD with no silent retry (M7). That replaces the current `#14`
  retry behaviour.

## N. Refund impact

- PAY_AT_PICKUP before payment: nothing to refund, so cancellation moves no money.
- After payment, a refund references the actual completed collection:
  - QR: a Razorpay refund of its `pay_` id
  - cash: an audited CASH_RETURNED record with the fee credited back to the wallet
- PAY_AT_DELIVERY: only completed stop collections are refundable.
- M8 infrastructure is unchanged:
  - one live refund per source
  - `X-Refund-Idempotency`
  - API and webhooks converge on one state
  - `REFUND_PARTIAL_ALLOWED` off by default
- `REFUND_AUTO_ON_CANCEL` becomes `off | before_handover` (default off).

## O. Admin impact

The API covers the financial trail: booking, payment mode, frozen fare, stops, per-drop collections
(method and provider reference), fee, earning, settlement, refund, payout and audit.

Gaps to build: the snapshot/stops/gate view, stop resolution (M5), refunds and cash returned (M8), and
the audit-log endpoint (M9).

No admin UI work now; the admin panel is a separate mock branch.

## P. Idempotency

| Operation | Key | DB guard |
|---|---|---|
| Booking registration | `externalRef`; quote single use | `uq_bookings_external_ref`, `bookings.fare_quote_id` UNIQUE, `fare_quotes.redeemed_at` once |
| Trip / stop status | monotonic; repeats are no-ops | transition triggers |
| Cash / QR collection | driver-scoped Idempotency-Key | `uq_collections_idempotency_key`, live-collection partial uniques per obligation |
| Wallet fee debit | `cash-ride-fee:<collectionId>` | ledger unique idempotency key |
| QR completion | provider payment id | `uq_collection_provider_payment`, `uq_collection_provider_reference` |
| Webhooks | event id (or body hash) | `uq_payment_events_event_id` |
| Earning | booking / trip | `uq_earnings_booking`, `uq_earnings_trip` |
| Refund | refund id = provider idempotency key | one live refund per source (M8) |
| Payouts | existing batch / item keys | existing |

## Q. Concurrency and the Part 23 scenarios

Lock order everywhere: **booking → trip → stop → collection/payment → wallet**. Today's order is
booking → trip → payment/collection → wallet; the stop is inserted after the trip. `PrismaService`
does not retry transactions itself. Every retry is a new call that meets the same idempotency guards.

| # | Scenario | Mechanism | Expected final state |
|---|---|---|---|
| 1 | Double-tap confirm | engine `externalRef` replay; quote redeemed once | 1 booking; a second ref with the same quote → 409 `QUOTE_ALREADY_USED` |
| 2 | Assigned twice | `/assign` idempotent per driver | 1 trip; another driver → 409 `TRIP_ALREADY_ASSIGNED` |
| 3 | Arrives twice | repeat = no-op | `DRIVER_ARRIVED`, first `arrivedAt` kept |
| 4 | Payment started twice | live QR reused; same key replays; one live collection per obligation | 1 `PENDING` collection |
| 5 | Paid, app times out | driver poll re-fetches Razorpay; webhook | collection `COMPLETED` once, booking `PAID` |
| 6 | Paid, backend crashes | webhook left unprocessed → 503 → Razorpay retries; driver refresh; admin sync; M9 job | `COMPLETED` once |
| 7 | Webhook twice | event-id dedupe | `ALREADY_APPLIED`; one completion |
| 8 | Webhook before API response | the QR is shown only after its row commits; the poll then returns `COMPLETED` | `COMPLETED` once |
| 9 | API response before webhook | refresh completes it; webhook → `ALREADY_APPLIED` | `COMPLETED` once |
| 10 | Invalid signature | rejected before storage | nothing stored or applied |
| 11 | Payment stays pending | gate `PAYMENT_PROCESSING`; handover/start refused; expiry → `FAILED` | `UNPAID`, trip `DRIVER_ARRIVED` |
| 12 | Payment fails | a failed UPI attempt keeps the QR payable; expiry → `FAILED` | `UNPAID`, retry allowed |
| 13 | Retry after failure | same QR, or a new one (old `FAILED`) | exactly one `COMPLETED` collection |
| 14 | Start before payment | `IN_TRANSIT` needs `PICKUP_VERIFIED` (API + DB) | 409; trip `DRIVER_ARRIVED` |
| 15 | Handover before payment | `PICKUP_VERIFIED` refused (API + DB); engine refuses the OTP; customer OTP hidden | 409 `PAYMENT_REQUIRED`; trip `DRIVER_ARRIVED` |
| 16 | Cash submitted twice | same key → replay; new key → 409; concurrent → locks + unique | 1 collection, 1 fee debit |
| 17 | QR webhook duplicated | dedupe | applied once |
| 18 | Wrong booking's QR | payment applies to that QR's own booking only (reference + amount + booking checks) | current booking `UNPAID`, handover blocked; the other booking's extra payment flagged for refund |
| 19 | Wrong drop's QR | a QR can only be created for the current stop; a stale stop's QR applies to that stop only | current stop unpaid; `DELIVERED` refused; extra payment flagged |
| 20 | Drop 1 payment against drop 2 | request for a non-current stop → 409; echo ≠ stop payable → 422; DB composite FK + amount guard | no cross-stop credit |
| 21 | Pays drop 1, refuses drop 2 | `DELIVERY_FAILED` → retry or admin `UNDELIVERED` | booking `PARTIALLY_PAID`; stop 2 never `DELIVERED`; earning on paid stops only |
| 22 | Cancel races payment | booking lock serializes. Cancel first: QR closed; late capture → `PAID_AFTER_CANCELLATION` flagged; cash → 409 `BOOKING_CLOSED`. Paid first: cancel allowed and flagged | money recorded truthfully; refund review (D-67) |
| 23 | Driver cancels / unassigned during payment | V1 has no reassignment; driver cancel = booking cancel | as #22 |
| 24 | Paid, driver becomes unavailable | booking `PAID`, trip `DRIVER_ARRIVED` | driver resumes, or ops cancels → refund review. **Gap:** reassignment after payment is not supported |
| 25 | Crash after the cash transaction | committed → same-key retry replays; not committed → retry creates | exactly one collection and debit |
| 26 | Crash after provider success | as #6 | `COMPLETED` once |
| 27 | Transaction retries | unique keys on every financial insert | one record |
| 28 | Concurrent collections | row locks + per-obligation partial uniques | one wins; others replay or 409 |
| 29 | Concurrent refunds | one live refund per source + provider idempotency key (M8) | one refund |
| 30 | Concurrent payouts | existing batch/item uniqueness; M7 adds an explicit concurrency test | one payout per item |
| 31 | Wallet would go negative | ledger refuses; cash refused 409 `INSUFFICIENT_BALANCE` | nothing written; stays at pickup or stop |
| 32 | Provider ≠ internal state | re-fetch, apply only valid transitions; mismatch → anomaly outcome → report | no blind overwrite; fixed only by audited admin action |
| 33 | Settlement delayed | `AWAITING_SETTLEMENT`; overdue report (D-62) | not payable |
| 34 | Payout provider timeout | no second payout for the same items; resolved by re-query or webhook; failure → `ON_HOLD` (M7) | to verify against payout-execution in M7 with a test |
| 35 | Payout webhook duplicated | `payout_events` dedupe; never rolls back (existing test #16) | applied once |
| 36 | Bank account changed mid-payout | step-up change suspends the old account; existing test "#14 a bank account suspended after preparation is never paid" | no payout to an unapproved account |

## R. Security changes

- **No client amounts:**
  - the engine sends a `quoteId`
  - the driver sends a method, a stop and an echo
  - the customer sends nothing financial
  - amount fields are rejected as unknown
- **Gates in API *and* DB:** pickup handover, stop delivered, stop payment confirmed, and
  obligation/stage/amount on collection insert. Triggers apply to every role, including the owner.
- **Authorization:**
  - customer: own bookings, enforced by query scoping
  - driver: own trips (`driverId` match)
  - engine: `X-Internal-Api-Key`
  - admin: role + reason + audit
- The engine's no-OTP pickup path is removed; engine token auth (§4.2) remains a must.
- Customer app OTP display is gated (defense in depth). Throttles on the new routes. Least-privilege
  grants for `booking_stops`.

**A malicious or buggy client cannot:**

- change the amount
- mark payment, a collection or handover confirmed (no write path; derived or provider-only)
- start the trip, or deliver an unpaid drop (409 + trigger)
- reuse another booking's or drop's payment (provider reference unique; reference + amount + booking
  checks; composite FK)

## S. Reconciliation

Existing reports are kept: wallet mismatches, unprocessed and anomalous webhooks, pending payments,
duplicate provider payments, earning, payout and cash-fee mismatches, failed payouts, paid-cancelled
bookings, stale collections, payable-without-bank, payout-webhook issues.

New reports:

- pickup-gate violations (PAY_AT_PICKUP past `PICKUP_VERIFIED` while UNPAID; should be empty)
- stop/collection mismatches (stop confirmed without a collection; amount ≠ stop payable; Σ
  collections ≠ booking paid)
- partially paid bookings awaiting resolution
- "provider paid, internal pending" (recovery job)
- "internal paid, provider refunded/failed" (periodic re-fetch)
- refunds pending or failed (M8)
- legacy rows after the backfill

No silent fixes: resolution is always an audited admin action.

## T. Test plan

**Backend integration** (real Postgres, real migrations, fake Razorpay):

- **`pickup-payment.int-spec.ts` (new):**
  - cash and QR happy paths
  - `PICKUP_VERIFIED` / `IN_TRANSIT` refused while unpaid, by the API and by the DB (owner-role SQL
    bypass attempts)
  - duplicate and concurrent cash
  - pending QR blocks handover; expiry then retry
  - cash closes an open QR; cash refused after a paid QR
  - wrong booking's QR
  - cancel races (cancel → late capture flagged; paid → cancel flagged)
  - wallet shortfall
  - authorization: another driver, customer, engine
- **`delivery-stops.int-spec.ts` (new):**
  - frozen per-stop amounts; current stop only; wrong stop and amount tampering refused
  - mixed cash/QR/cash
  - unpaid stop `DELIVERED` refused (API + DB)
  - drop 2 refused → `UNDELIVERED` → `PARTIALLY_PAID` → completion → earning on paid stops
  - concurrent collections on one stop; composite-FK cross-stop attempt via SQL
- **Registration v2:** quote required, PREPAID refused (API + DB), amount fields refused, another
  customer's / expired / used quote, replay, concurrent double registration.
- **Crash simulation:** finalizer throws after the provider reports paid → webhook 503 → retry applies
  once; the driver-refresh path.
- **M7:** failed payout → `ON_HOLD`, payout concurrency and timeout. **M8:** duplicate/concurrent
  refunds, webhook + API convergence, cash returned.
- Updated: `collections`, `trips-earnings`, `fee-rules`, `least-privilege`, `payouts`, helpers
  (`registerBooking` uses a quote fixture). `booking-payments.int-spec.ts` is removed with D-65.

**Backend unit:** gate derivation, largest-remainder fee allocation, stop transition table, Fare (M3).

**E2E (`run-local-e2e.mjs`), 3 flows:**

1. PAY AT PICKUP cash
2. PAY AT PICKUP QR → settlement → payout
3. PAY AT DELIVERY with 3 drops, cash/QR/cash

**Driver app (Jest):** gate-driven availability, OTP/START disabled until `handoverAllowed`,
`stopSequence` in requests, DTO parsing.

**Customer app:** there is no test setup; add minimal Jest for the option, quote and gate logic.

## U. Migration and backward compatibility

- The `PREPAID_UPI` enum value stays, and old rows are untouched. A DB insert trigger and the API
  refuse new ones.
- The pickup gate applies to transitions after the migration only.
- `PICKUP_COLLECTION_WINDOW` stays as is, so any old unpaid pickup row past arrival can still be
  collected. For new bookings the gate makes it effectively arrival-only.
- Stops are backfilled (D-69). The new collection indexes are created before the old one is dropped,
  in the same transaction.
- **No deployed consumer exists** (engine-v2 never calls the backend), so the internal registration
  contract changes in place under `/v1`. `spec.html` and the PDFs are updated (M13).
- The driver-app DTO change is additive. An old app version still collects at pickup. Per-stop
  collection needs the new version; an old app gets a clean 422 `STOP_REQUIRED`.
- M3 (Fare) is unaffected. The dev DB is migrated; dev-account relink stays in M10.

## V. Files that change

**raj_backend:**

- `prisma/schema.prisma`, two new migrations, `prisma/sql/02-app-grants.sql`
- `src/bookings/`: `bookings.dto.ts`, `bookings.service.ts`, `bookings.mapper.ts`,
  `booking-payment-state.ts`, `trip-lifecycle.ts`, `customer-bookings.controller.ts`; new
  `booking-stops.service.ts`, `payment-gate.ts`, `fee-allocation.ts`
- `src/engine/internal-bookings.controller.ts`
- `src/collections/`: `collections.service.ts`, `collection-finalizer.service.ts`,
  `collections.dto.ts`, `collections.mapper.ts`, `driver-collections.controller.ts`
- `src/earnings/*` (M7)
- `src/payments/`: `booking-payments.controller.ts`, `booking-payment.service.ts`,
  `booking-payment-finalizer.service.ts` (retired), `payments.module.ts`, `razorpay-webhook.service.ts`
  (refunds)
- `src/reconciliation/*`, `src/audit/*`, `src/common/errors/error-codes.ts`, `src/config/*` (refund
  settings)
- tests: `test/helpers/{flows,fixtures}.ts`, the specs listed in T, `test/e2e/run-local-e2e.mjs`
- docs: `OPEN_DECISIONS.md`, `RAZORPAY_INTEGRATION.md`, `ARCHITECTURE_TRACEABILITY.md`,
  `DATABASE_SETUP.md`

**Driver app (`PickUp`):**

- engine and trip: `src/services/engine/dispatch.ts`,
  `src/services/trip/{TripService,TripController}.ts`
- screens:
  `src/screens/trip/{ArrivedAtPickupScreen,PickupOTPScreen,DropOTPScreen,DeliveryProofPreviewScreen,CollectPaymentScreen}.tsx`
- payments: `src/services/payments/{collectionFlow,collectionsDto,paymentsApi}.ts`
- `src/hooks/useCollectableTrips.ts`, `src/components/molecules/CollectPaymentBanner.tsx`,
  `src/i18n/index.tsx`, `__tests__/collections.test.ts` + new tests

**Customer app (`raj_customer`):**

- payment screens: `src/screens/payment/PaymentMethodScreen.tsx` (two options); the prepaid chain
  screens (removed from the flow)
- booking screens: `src/screens/booking/{ReviewBookingScreen,FareEstimateScreen,SelectVehicleScreen}.tsx`
- tracking: `src/screens/tracking/{FindingDriverScreen,DriverAssignedScreen,CustomerLiveTrackingScreen}.tsx`,
  `src/screens/logistics/PickupOtpVerificationScreen.tsx`
- state and API: `src/state/BookingContext.tsx`, `src/api/{types,engine,http}.ts`, new
  `src/api/payments.ts`, `src/config/env.ts`
- `App.tsx`, `src/data/mockData.ts`
- docs and checks: `AGENTS.md`, `WIRING_MAP.md`, `scripts/check-wiring.js`

**Engine (`origin/engine-v2`, friend):** `src/rides/{rides.types,rides.service}.ts`,
`src/trips/{trips.service,trip-state.service,trips.controller}.ts`, plus a new payment-backend client
and outbox.

**Friend's docs:** `engine-payment-integration/spec.html` and `architecture.html`, and their PDFs.

## Revised milestones

- **M3 Fare (in progress):** unchanged.
- **M4 Booking snapshot:** registration v2 `{quoteId, paymentMethod}`, PREPAID refused, stops + fee
  allocation, backfill, views and by-ref. The old dispatch gate is dropped from scope.
- **M5 Gates and stops:** pickup handover gate (API + DB), stop endpoint and state machine, trip
  `DELIVERED` rule, `paymentGate`, admin stop resolution.
- **M6 Collections by obligation:** pickup, plus per-stop for delivery, fee shares, finalizer,
  `PARTIALLY_PAID`.
- **M7 Earnings and payouts:** MIXED earnings; failed payout → `ON_HOLD`.
- **M8 Refunds:** including cash returned and `before_handover`.
- **M9 Reconciliation and audit:** new reports, financial event log, recovery job, audit endpoint.
- **M10 Wrap-up:** prepaid retirement (D-65), docs, the 3 E2E flows, full suites, drift check, dev
  relink.
- **M11** Driver app. **M12** Customer app. **M13** Engine spec and architecture PDFs, and the final
  report.
