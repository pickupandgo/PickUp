# MultipleRide trip engine (engine-v2)

The trip engine of MultipleRide / Pick Up: dispatch, offers, the operational trip and stop
state, and the handover OTPs. Since payment flow Phase 8 it is persistent (its own PostgreSQL
database), authenticates every app request with Firebase, and works with the payment backend
(branch `raj_backend`) through that backend's internal API.

## Who owns what

| Engine | Payment backend (authoritative for money) |
|---|---|
| Dispatch and offers to drivers | Fare quotes and the frozen fare, tax and platform fee |
| Trip and stop movement (arrive, start, drops, failures) | Payment, collections (cash and QR), the payment gate (`paymentGate`) |
| Pickup and drop OTPs, delivery photos | Earnings, settlement, payouts, refunds, the financial audit |

The engine never sends an amount, a fee, a payment status or `PAYMENT_CONFIRMED`, and never
decides that something is paid. Every amount it shows is a display copy of the backend's quote.

## How the engine works with the payment backend

Every call goes to `PAYMENT_BACKEND_URL` with `X-Internal-Api-Key` and an `X-Request-Id`
(`eng-reg-<rideId>`, `eng-ob-<outboxId>-<attempt>`, `eng-gate-<tripId>`, ...). The backend's
contract is on branch `raj_backend`: `docs/RAZORPAY_INTEGRATION.md` §10, and contract F of
`docs/PAYMENT_FLOW_FINAL_REVIEW.md`.

### Driver eligibility (Phase 2B)

The backend owns driver approval, KYC, vehicle verification and suspension. Before a driver can
become available, before an offer is created, and again immediately before an assignment is
persisted, the engine calls:

```text
GET /v1/internal/drivers/by-subject/:firebaseSubject/eligibility
```

The Firebase subject comes only from the engine's verified app token. The backend resolves it
through `auth_identities`, returns the authoritative backend driver UUID and echoes the subject;
the engine rejects a mismatched or malformed response. There is no eligibility cache. Network,
timeout, backend authentication and response-contract failures are fail-closed, and remove the
driver from local future dispatch. A later revocation never cancels or mutates an already assigned
trip; it prevents future offers and assignments instead.

| App action (engine route) | Backend call | How | The engine commits |
|---|---|---|---|
| Customer confirms (`POST /rides`) | `GET /v1/internal/fare-quotes/:quoteId`, then `POST /v1/internal/bookings` `{ externalRef, customerSubject, quoteId, paymentMethod }` | Synchronous | The booking is stored first (`PENDING_REGISTRATION`, `externalRef = ENG-<rideId>`), so a retry registers the same reference. It is offered to a driver only after a 201/200 that matches the quote. |
| First offer | `POST .../bookings/:id/searching` | Event | – |
| Driver accepts (`POST /rides/:id/accept`) | `POST .../bookings/:id/assign` `{ driverSubject }` | Command | The trip is created with its ASSIGN. A 2xx stores `paymentTripId`. A refusal (driver not provisioned or not approved) cancels the trip, frees the driver and reopens the booking. |
| Arrive at pickup | trip `DRIVER_ARRIVED` | Event | At once |
| Pickup OTP (`POST /trips/:id/pickup/verify-otp`) | Gate read (`GET .../bookings/:id`), then trip `PICKUP_VERIFIED` | Gate, then command | The OTP is checked only when `handoverAllowed`; `PICKUP_VERIFIED` only after the backend's 2xx. |
| Start | trip `IN_TRANSIT` | Command | After the 2xx |
| Arrive at a drop (also the retry of a failed drop) | stop `ARRIVED` | Event | At once |
| Drop OTP | Gate read | Gate | Only when that drop's `handoverAllowed` |
| Drop delivered (photo) | stop `DELIVERED` | Command | After the 2xx: an unpaid drop is never delivered |
| Drop failed (`POST /trips/:id/stop/fail`, reason required) | stop `DELIVERY_FAILED` `{ reason }` | Event | At once |
| Follow the backend (`POST /trips/:id/refresh`) | `GET .../bookings/:id` | Read | An admin's RETRY / UNDELIVERED of a failed drop, or a cancellation |
| Complete | trip `COMPLETED` | Command, retried while `PAYMENT_REQUIRED` | After the 2xx (202 meanwhile) |
| Cancel (ride or trip, reason required) | `POST .../bookings/:id/cancel` `{ reason }` | Event; pending commands are superseded | At once. No refund behaviour: the backend flags paid cancellations for review. |

**Gates fail closed.** Before a gate read the engine delivers the booking's pending reports, so the
backend knows the driver is there. No answer, or reports still pending, is a 503 and nothing is
committed. A 409 `PAYMENT_REQUIRED` carries `{ stage, stopSequence, amountPaise, paymentState }`
from the backend.

## The outbox

Every report to the backend is a row of `engine_outbox`, written in the same transaction as the
state it reports. A crash never loses one, and nothing is sent for a change that rolled back.

- **Commands** (backend first): ASSIGN, `PICKUP_VERIFIED`, `IN_TRANSIT`, stop `DELIVERED`,
  `COMPLETED`. The engine applies the transition only when the backend accepts. **Events**:
  `SEARCHING`, `DRIVER_ARRIVED`, stop `ARRIVED`, stop `DELIVERY_FAILED`, cancel. The engine already
  committed them.
- **Ordered per booking:** only the oldest pending record of a booking is sent.
- **One sender at a time:** a record is claimed with a lease (`FOR UPDATE SKIP LOCKED`, `locked_until`,
  `claim_id`). This holds across engine instances and the synchronous flush. A sender that died
  loses its lease and the record is sent again; the backend treats repeats as no-ops. The answer
  is recorded under the booking lock after re-checking the claim, so it is applied once.
- **Retried** with exponential backoff and equal jitter until a definitive answer. No answer
  (network, timeout, 5xx, 408, 425, 429, a refused internal key, an unreadable answer) is retried.
  A 4xx is final and recorded as `REFUSED`, except `COMPLETED` refused with `PAYMENT_REQUIRED`,
  which waits for the payment.
- **Never dropped:** a database trigger refuses to delete a pending record. Alerts are JSON log
  lines with an `alert` key, listed under Operations.
- The background sender runs every `OUTBOX_POLL_INTERVAL_MS`. Commands and gate reads also flush
  the booking synchronously.

## Persistence

Prisma 7 with the PostgreSQL adapter, in the engine's own database. It is never the payment
backend's database. The migration is
[`prisma/migrations/20261022120000_engine_persistence`](prisma/migrations/20261022120000_engine_persistence/migration.sql):

| Table | Holds |
|---|---|
| `engine_bookings` | The ride: UUID id, `external_ref` (unique), `quote_id`, `customer_subject`, `payment_method`, status, `payment_booking_id`, the quote's route and display amounts, the pickup OTP |
| `engine_stops` | The drops in the quote's order, each with its OTP, status, proof and failure reason |
| `engine_offers` | Offers to drivers, at most one live per booking |
| `engine_trips` | The trip with `payment_trip_id` and `current_stop_index`. One live trip per booking, and one active trip per driver (partial unique indexes). |
| `engine_outbox` | The reports to the backend (above) |

A booking is unique per `(quote_id, customer_subject)`. Another customer's attempt with the same
quote is refused by the backend and blocks nobody. CHECK constraints guard formats, amounts and
status facts. Rollback: `down.sql` next to the migration. It is manual, and it refuses once a
booking is recorded.

Driver presence (online, location, vehicle) stays in memory: the apps send it again after a
restart. Whether a driver is busy comes from the database.

## API changes for the apps (Phases 9-10)

- **Authentication.** Every route needs `Authorization: Bearer <Firebase ID token>` (same project
  as the payment backend), except `GET /`, `GET /health` and the display-only `/fare/*`
  estimates. The caller is the token's subject. A `driverId` / `customerId` in a body or path must
  be that subject (403 `IDENTITY_MISMATCH`), and is never used otherwise.
- **`POST /rides`** takes `{ quoteId, paymentMethod: PAY_AT_PICKUP | PAY_AT_DELIVERY, driverId,
  customerId?, pickup?, drops? | drop? }`. The quote comes from the backend's
  `POST /v1/fare/quotes`. `pickup` and `drops` add addresses and receivers; any coordinates must
  be the quote's (422 `QUOTE_ROUTE_MISMATCH`). An amount field is 400 `CLIENT_AMOUNT_REJECTED`; any
  other unknown field (`weight`, `vehicleType`, ...) is 400 `VALIDATION_FAILED`. The drop limit
  is the backend's.
- **Ids are UUIDs** (they were `R1`, `T1`). Rides and trips show `externalRef`, `paymentBookingId`
  and `paymentTripId`. The Driver app uses `paymentTripId` for its collections at the backend.
- **OTPs are never in ride or trip responses.** The customer reads them from
  `GET /rides/:id/otps`, each with `withheld: PAYMENT_REQUIRED | FINISHED | CLOSED | null`.
  PAY_AT_PICKUP: the codes appear once the booking is paid. PAY_AT_DELIVERY: the pickup code
  always, and each drop's once that drop is paid.
- **Removed:** `POST /trips/:id/pickup/confirm` (a pickup without the OTP) and
  `POST /rides/:id/verify-otp` (an OTP check without authentication or the gate).
- **New:** `POST /trips/:id/stop/fail { reason, stopId? }`, `POST /trips/:id/refresh` and
  `GET /rides/:id/otps`.
- **Trip actions** answer with `changed`, `paymentGate` (when the backend answered) and
  `paymentSync` (`DELIVERED`, `PENDING`, `REFUSED`, `NONE`). Repeating a done step is a 2xx with
  `changed: false`. `POST /trips/:id/complete` is 201 when completed, or 202 while the backend
  waits for the payment.
- **Cancellations** need a `reason` (3-200 characters).
- **Ride status** adds `PENDING_REGISTRATION` (retry the same request) and `REGISTRATION_FAILED`
  (`registrationError` gives the backend's code). An expired offer reads as `REJECTED`.
- **Errors** keep Nest's shape and add a stable code: `{ statusCode, error, code, message,
  details? }`. Codes: 401 `AUTH_REQUIRED` / `AUTH_INVALID_TOKEN`, 409 `PAYMENT_REQUIRED`,
  503 `PAYMENT_BACKEND_UNAVAILABLE` (nothing committed), and the backend's own codes for its
  refusals (`QUOTE_EXPIRED`, `DRIVER_NOT_APPROVED`, ...).

## Configuration

See [.env.example](.env.example). Every value is validated at startup. The error names the
variables, never their values.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | required | The engine's own database |
| `AUTH_ISSUER`, `AUTH_AUDIENCE` | required | Same Firebase project as the backend. `AUTH_JWKS_URL` defaults to Firebase's keys. |
| `PAYMENT_BACKEND_URL` | required | https in production, unless `PAYMENT_BACKEND_ALLOW_HTTP=true` on a private network |
| `PAYMENT_BACKEND_INTERNAL_API_KEY` | required | One of the backend's `INTERNAL_API_KEYS`. Server only. |
| `PAYMENT_BACKEND_TIMEOUT_MS` | 5000 | Per call |
| `OUTBOX_POLL_INTERVAL_MS` | 1000 | 0 turns the background sender off (tests) |
| `OUTBOX_LEASE_SECONDS` | 30 | Must exceed the call timeout |
| `OUTBOX_BASE_BACKOFF_MS`, `OUTBOX_MAX_BACKOFF_MS` | 1000, 300000 | – |
| `OUTBOX_ALERT_AFTER_ATTEMPTS` | 8 | – |
| `OFFER_TTL_SECONDS` | 15 | The prototype's effective offer timeout |

## Running and testing

```bash
npm ci
cp .env.example .env        # set the internal key and the Firebase project
npm run db:migrate          # prisma migrate deploy on DATABASE_URL
npm run build && npm run start:prod
```

| Command | What it runs |
|---|---|
| `npm test` | Unit tests (no database) |
| `npm run test:e2e` | Integration tests: the real app on `multipleride_engine_test`, which is created and migrated by the setup (`ENGINE_TEST_DATABASE_URL` overrides the URL; the name must end in `_test`). The payment backend is an in-process fake of its internal API, with injected faults. |
| `npm run test:contract` | Contract E2E: the real engine build and the real `raj_backend` build, a local JWKS, and a fault-injecting proxy between them. It covers three flows (PAY_AT_PICKUP cash, PAY_AT_PICKUP QR, PAY_AT_DELIVERY with 3 drops), outages, lost answers, an engine crash and restart, duplicates and security. It needs both builds and Docker Postgres, plus `raj_backend/.env` with Razorpay **test** keys (Razorpay is never called). It creates and drops `multipleride_contract_e2e` and `multipleride_engine_contract_e2e` (`--keep` keeps them). |
| `npm run lint:check`, `npm run format:check`, `npm run typecheck` | Static checks |

## Operations

- **Alerts** (`"alert"` in the JSON logs, production):
  - `ENGINE_OUTBOX_STUCK`: no answer after N attempts; still retrying.
  - `ENGINE_OUTBOX_REFUSED`: an event, or an unexpected command, was refused. Engine and backend disagree; never ignore it.
  - `PAYMENT_BACKEND_AUTH_FAILED`: the internal key was refused.
  - `PAYMENT_BACKEND_CONTRACT_MISMATCH`, `ENGINE_REGISTRATION_MISMATCH`, `ENGINE_OUTBOX_CONTRACT`: an answer of an unexpected shape or content. Nothing was applied from it.
- **Restarts are safe.** Pending reports are sent by the next instance. A report caught mid-send is
  sent again once its lease expires.
- **Several instances:** the outbox is safe with several instances. Driver presence is in memory,
  so run one instance until presence is shared.

## Known limitations

- The Driver and Customer apps still use the prototype API. They need the changes above
  (Phases 9-10): the Driver app calls the removed `pickup/confirm` and `verify-otp` routes.
- Dispatch is still the prototype's: the customer offers the ride to a chosen driver (D-30).
- The 4-digit OTPs have no attempt limit. Only the assigned driver can try them, and only once the
  payment backend allows the handover.
- The engine learns about an admin's drop resolution or a cancellation made at the backend only
  through `POST /trips/:id/refresh`. A handover is refused meanwhile: 409 `BOOKING_CANCELLED`, or
  the drop stays failed.
- `GET /drivers`, `GET /drivers/:id` and `POST /drivers/:id/rate` keep the prototype's behaviour,
  now for signed-in users only.
- Deployment needs a PostgreSQL database for the engine in each environment (Render's disk is not
  persistent) and the internal key shared with the backend.
