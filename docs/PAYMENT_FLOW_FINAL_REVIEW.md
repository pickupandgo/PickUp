# Payment flow: final architecture review

**PAY AT PICKUP + per-drop PAY AT DELIVERY.** This is a review against the master implementation prompt, dated 14 Oct 2026.

**Status:** review only. No application code has been changed for this flow. One read-only script was added: `prisma/sql/preflight-payment-flow.sql`. Where this document and `PAY_AT_PICKUP_IMPACT_PLAN.md` disagree, this document wins.

Every item carries one of these tags:

| Tag | Meaning |
|---|---|
| **ARCH** | APPROVED ARCHITECTURE: stated in the master prompt or approved earlier. |
| **IMPL** | IMPLEMENTATION DETAIL: my design choice inside the approved architecture. You can override it. |
| **OPEN** | OPEN BUSINESS DECISION: not decided. Where code needs a value, it uses a labelled *technical safe default*. That default is configurable and is never presented as policy. |
| **BLOCKER** | Must be resolved before the step named in the item. |

---

## 0. Verified facts (Phase 0 audit)

| Fact | Evidence |
|---|---|
| Only local databases are visible to me: `multipleride` (dev), `multipleride_test`, `multipleride_e2e` and `multipleride_scratch`, all on 127.0.0.1:5433. `.env` targets the local dev DB with `NODE_ENV=development`, Razorpay **test** keys, QR via payment links, and payouts disabled. | Listed the databases with `pg_database`. Read `.env` without printing any secret. |
| `docker-compose.yml` says "Production uses a managed PostgreSQL instance". I have no access to such an instance and no information about it. | See N1 and BK-1. |
| The dev DB holds 2 bookings, both PAY_AT_DELIVERY, made through the internal API for the tablet demo. `TAB-CASH-001` is completed and was paid in cash. **`TAB-QR-001` is in flight: trip DELIVERED, booking UNPAID, with a PENDING payment-link collection from 6 Oct.** There are no PREPAID rows. The fare migration is not applied in dev. | Preflight run on `multipleride` |
| The E2E DB holds 2 completed PREPAID_UPI bookings (one paid out) and 1 PAY_AT_DELIVERY booking at PAYMENT_CONFIRMED. It is disposable. | Preflight run on `multipleride_e2e` |
| A "one stop per old booking" backfill would strand `TAB-QR-001`. Its only stop would be DELIVERED but unpaid, and the per-stop rules can never collect for a delivered stop. | See K, and the change to D-69 in section 1 |
| The wallet cannot go negative at the DB level (`wallet_balance_nonnegative`, `wallet_tx_balance_nonnegative`). | Migration `20261002120000` |
| No refund infrastructure exists. Nothing writes `REFUND_PENDING` or `REFUNDED`. Paid-but-cancelled bookings are only logged and listed in a report. | Search of `src/` |
| A FAILED payout releases its items and sets the earnings back to PAYABLE, so they are paid again in a later payout without anyone acting. | `payout-status.service.ts:66`; test `#14` |
| Quote TTL defaults to 600 s (allowed 60–3600). QR link TTL defaults to 30 min (allowed 16–120). | `env.schema.ts` |
| M3 (the Fare module) is built. Typecheck and lint are clean. 264 unit tests and 22 fare integration tests pass. The full integration suite has not been re-run since those changes. The fare migration is not applied to dev. I found and fixed one trigger bug in that migration, which had not been applied anywhere persistent. | This session |

## 1. What this prompt settles from the impact plan

| Plan item | Now | Tag |
|---|---|---|
| D-63: handover is the pickup OTP | Confirmed by §2.A.21–22. | ARCH |
| D-64: no in-app payment at pickup | Confirmed by §2.A.17. | ARCH |
| D-65: PREPAID_UPI | New bookings are refused in the API and the DB. **Change from the plan:** historical PREPAID rows keep a working code path, and nothing is deleted. | ARCH |
| D-66: wallet shortfall | The collection is rejected with `requiredFeePaise`. No new dispatch rule. | ARCH |
| D-67: cancelled after payment | Not decided. Technical default only: cancellation is allowed and flagged, and no money moves. | OPEN |
| D-68: no-show | Not decided. No timers, fees or compensation. | OPEN |
| D-69: backfill one stop per booking | **Replaced** by the legacy booking model (see K). Existing rows keep their current rules, and no stops are invented for them. | IMPL |
| D-70: undelivered drop on PAY_AT_PICKUP | Not decided. Technical default: record the facts and hold the online earning for review. | OPEN |
| D-71: backend-first engine | Confirmed by §14. | ARCH |

---

## A. Final implementation plan

| Phase | Scope | Exit criteria | Tag |
|---|---|---|---|
| 0 | Audit, this review, preflight script. | You approve this document. | ARCH |
| 1 | Fare/quote contract (M3, already built) and the booking snapshot. Registration v2 takes `{externalRef, customerSubject, quoteId, paymentMethod}`. The quote is redeemed once and the snapshot frozen. PREPAID is refused in the API and DB. Add the `payment_model` marker. | Registration tests (I.3) and the full suite pass. | ARCH |
| 2 | `booking_stops`, the legacy model, and migration safety: preflight, a migration test on representative data, and down scripts. | Migration test passes; drift check is empty. | ARCH |
| 3 | `paymentGate`. Pickup handover gate in the service, API and DB. Stop state machine. Trip DELIVERED rule. Admin stop resolution. | Gate unit tests, pickup integration tests and stop integration tests. | ARCH |
| 4 | Cash and QR collections tied to a specific obligation. Per-stop fee shares, one ledger key per collection, finalizer, `PARTIALLY_PAID`. | Collection and mixed-stop tests. | ARCH |
| 5 | Earnings that span several collections (MIXED), settlement gating per collection, payout item amount. A failed payout goes ON_HOLD with no automatic retry. | Earnings and payout tests. | ARCH |
| 6 | Refund infrastructure, with every policy switch off. | Refund tests. | ARCH |
| 7 | Financial event log, audit endpoint, new reconciliation reports, and a recovery job for stuck collections. | Audit and reconciliation tests. | ARCH |
| 8 | Engine contract (F): final backend endpoints, contract tests through the internal API, and the spec for the engine developer. | Contract tests pass. | ARCH |
| 9 | Driver App (G). | Jest tests and a manual run on the tablet. | ARCH |
| 10 | Customer App (H). | Jest tests and a manual run. | ARCH |
| 11 | E2E for the 3 flows, plus a concurrency and security sweep. | All pass. | ARCH |
| 12 | Docs, OpenAPI, `spec.html`, `architecture.html` and the PDFs. | Docs match the behaviour. | ARCH |

Phases 8–10 need the engine developer before they can be used in production (BK-2). The backend phases do not.

## B. Exact files to change

**raj_backend: new files**

| File | Purpose | Phase |
|---|---|---|
| `prisma/sql/preflight-payment-flow.sql` | Read-only inventory (added during this review). | 0 |
| `prisma/migrations/<ts>_payment_flow_enums/{migration,down}.sql` | Enum values (C.2). | 2 |
| `prisma/migrations/<ts>_booking_snapshot_and_stops/{migration,down}.sql` | Snapshot, stops, gates, PREPAID refusal (C.3). | 1–3 |
| `prisma/migrations/<ts>_mixed_earnings_payout_hold/…` | C.4 | 5 |
| `prisma/migrations/<ts>_refunds/…` | C.5 | 6 |
| `prisma/migrations/<ts>_financial_events/…` | C.6 | 7 |
| `src/bookings/fee-allocation.ts` + spec | Largest-remainder fee split. | 1 |
| `src/bookings/booking-registration.ts` | Registration v2 inside one transaction. | 1 |
| `src/bookings/stop-lifecycle.ts` + spec | Stop transition table. | 3 |
| `src/bookings/booking-stops.service.ts` | Stop transitions, plus the trip DROP_PROGRESS and DELIVERED side effects. | 3 |
| `src/bookings/payment-gate.ts` + spec | Derived gate: driver/engine view and customer view. | 3 |
| `src/bookings/admin-bookings.controller.ts` | Stop resolution (admin, reason, audit). | 3 |
| `src/collections/collection-obligation.ts` + spec | Works out which obligation is due: the booking, or the current stop. | 4 |
| `src/refunds/` (module, service, gateway port, Razorpay HTTP gateway, finalizer, admin controller, DTOs, `refund-policy.ts`) | Refund infrastructure. | 6 |
| `src/audit/financial-context.ts`, `src/audit/admin-audit.controller.ts` | Actor/request context for each transaction, and the audit endpoint. | 7 |
| `src/reconciliation/collection-recovery.service.ts` (+ scheduler) | Re-fetches stuck PENDING collections. | 7 |
| `test/integration/{booking-registration,pickup-payment,delivery-stops,legacy-bookings,refunds,audit,concurrency,migration-legacy-data}.int-spec.ts` | See I. | 1–11 |
| `test/helpers/legacy-fixtures.ts` | Legacy rows, created by the owner role. Test only. | 2 |

**raj_backend: modified files**
- Schema and SQL: `prisma/schema.prisma`, `prisma/sql/02-app-grants.sql`.
- `src/bookings/`: `bookings.dto.ts`, `bookings.service.ts`, `bookings.mapper.ts`, `booking-payment-state.ts`, `trip-lifecycle.ts`, `customer-bookings.controller.ts`, `driver-trips.controller.ts`.
- `src/engine/internal-bookings.controller.ts`.
- `src/collections/`: `collections.service.ts`, `collection-finalizer.service.ts`, `collections.dto.ts`, `collections.mapper.ts`, `driver-collections.controller.ts`, `collection-link.gateway.ts` (notes and description).
- `src/earnings/`: `earnings.service.ts`, `earnings.dto.ts`, `earnings.mapper.ts`.
- `src/payouts/`: `payout-status.service.ts` (FAILED → ON_HOLD) and `payout-batches.service.ts` (payout amount).
- `src/payments/razorpay-webhook.service.ts` (refund events). The legacy prepaid files are kept unchanged.
- `src/reconciliation/*`, `src/common/errors/error-codes.ts`, `src/config/{env.schema,app-config}.ts` (refund and recovery settings).
- `src/fare/admin-pricing-versions.controller.ts` (refuse `PROTOTYPE*` codes in production, matching the CLI).
- Tests: `test/helpers/{flows,fixtures}.ts`, the existing specs (rewritten to the new semantics; see I) and `test/e2e/run-local-e2e.mjs`.
- Docs: `OPEN_DECISIONS.md`, `RAZORPAY_INTEGRATION.md`, `ARCHITECTURE_TRACEABILITY.md`, `DATABASE_SETUP.md`, `README.md`.

**Driver App (`PickUp`)**
- Engine and trip services: `src/services/engine/dispatch.ts` (split the chained calls), `src/services/trip/{TripService,TripController}.ts`.
- Trip screens: `src/screens/trip/{ArrivedAtPickupScreen,PickupOTPScreen,DropOTPScreen,DeliveryProofPreviewScreen,CollectPaymentScreen}.tsx`.
- Payment services: `src/services/payments/{collectionFlow,collectionsDto,paymentsApi}.ts`.
- `src/hooks/useCollectableTrips.ts`, new `src/hooks/usePaymentGate.ts`, `src/components/molecules/CollectPaymentBanner.tsx`, `src/i18n/index.tsx`.
- Tests: `__tests__/collections.test.ts` and new gate and flow tests.

**Customer App (`raj_customer`)**
- `src/screens/payment/PaymentMethodScreen.tsx` (exactly two options).
- Booking screens: `src/screens/booking/{ReviewBookingScreen,FareEstimateScreen,SelectVehicleScreen}.tsx`.
- Tracking screens: `src/screens/tracking/{FindingDriverScreen,DriverAssignedScreen,CustomerLiveTrackingScreen}.tsx`, `src/screens/logistics/PickupOtpVerificationScreen.tsx`.
- State and API: `src/state/BookingContext.tsx`, `src/api/{types,engine,http}.ts`, new `src/api/payments.ts`, `src/config/env.ts`.
- `App.tsx` (removes the prepaid chain from the booking stack), `src/data/mockData.ts` (removes the payment mocks).
- Tooling and docs: `scripts/check-wiring.js` (GALLERY_ONLY), `package.json` + `jest.config.js` (new test setup), `__tests__/*`, `AGENTS.md`, `WIRING_MAP.md`, `README.md`.

**Engine (`origin/engine-v2`, engine developer)**
- `src/rides/{rides.types,rides.service,rides.controller}.ts`.
- `src/trips/{trips.service,trip-state.service,trips.controller}.ts`.
- New: auth guard, a persistent store, the payment-backend client and the outbox (see F and BK-2).

**Engine developer's docs:** `engine-payment-integration/spec.html`, `architecture.html` and their PDFs.

## C. Database migration plan

| # | Step | Tag |
|---|---|---|
| C.1 | **Preflight.** Run `prisma/sql/preflight-payment-flow.sql` (read-only transaction) in every environment that holds data, and review the output before migrating. Stop if there are unexpected in-flight rows. | IMPL; **BLOCKER** for any non-local environment (BK-1) |
| C.2 | **`…_payment_flow_enums`.** `booking_payment_status` gets `PARTIALLY_PAID`. `earning_settlement` gets `MIXED`. New `booking_stop_status` (PENDING, ARRIVED, PAYMENT_CONFIRMED, DELIVERED, DELIVERY_FAILED, UNDELIVERED, CANCELLED). New `booking_payment_model` (LEGACY_BOOKING_LEVEL, QUOTE_PER_STOP). This is its own migration because enum values must be committed before use. | IMPL |
| C.3 | **`…_booking_snapshot_and_stops`**, one transaction. See the detail below. | ARCH rules, IMPL shape |
| C.4 | **`…_mixed_earnings_payout_hold`** (Phase 5). See the detail below. | IMPL |
| C.5 | **`…_refunds`** (Phase 6): `payment_refunds`, booking `PARTIALLY_REFUNDED`, and a collection `refunded_paise` total kept by a trigger, plus guards. | IMPL |
| C.6 | **`…_financial_events`** (Phase 7): an append-only table, fed by AFTER triggers on bookings, trips, booking_stops, payment_collections, driver_earnings, payment_refunds, payouts, payout items and wallet transactions. The actor and request come from transaction-local settings set by the service layer. | IMPL |
| C.7 | **Down scripts.** A `down.sql` sits next to each migration. It drops what the migration added and restores the old collection index. Prisma ignores the file. PostgreSQL enum values cannot be removed, but they are inert if unused. The migration test runs up, down, up. | IMPL |
| C.8 | **Representative-data test.** See the detail below. | IMPL |
| C.9 | **Apply order.** Dev DB after your approval. Any other environment only after BK-1. | BLOCKER (non-local) |

**C.3 in detail**
- **bookings: model marker.** Add `payment_model`. The migration sets every existing row to `LEGACY_BOOKING_LEVEL`; this is the only backfill. An insert trigger requires every new row to be `QUOTE_PER_STOP`.
- **bookings: snapshot columns.** Add `fare_quote_id` (UNIQUE, FK), `pricing_version_id` (FK), `tax_paise` and `platform_fee_paise`. They are required for `QUOTE_PER_STOP` and NULL for legacy rows (CHECK).
- **bookings: insert trigger.** It refuses `PREPAID_UPI` and the legacy model. It also checks that the snapshot equals the quote (customer, category, payable, tax) and that the quote was redeemed in the same transaction.
- **bookings: update guard.** The new columns are immutable. Payment status may move `UNPAID → PARTIALLY_PAID → PAID`.
- **booking_stops** (only for `QUOTE_PER_STOP` bookings):
  - Columns: sequence 1–5, `fare_paise`, `tax_paise`, `payable_paise`, `platform_fee_share_paise`, status, the arrived / payment-confirmed / delivered / failed timestamps, and resolution fields.
  - Indexes: UNIQUE(`booking_id`, `sequence`); UNIQUE(`booking_id`, `id`) for the composite FK; a partial UNIQUE(`booking_id`) on ARRIVED or PAYMENT_CONFIRMED, so only one stop is current.
  - A deferred totals trigger checks Σ payable = booking payable, Σ fee share = booking fee, and that sequences run 1..n.
  - A transition guard, plus no delete or truncate.
- **payment_collections:**
  - Add `booking_stop_id` with a composite FK (`booking_id`, `booking_stop_id`) → `booking_stops(booking_id, id)`.
  - CHECK that a `PICKUP` collection has no stop.
  - Replace `uq_collection_booking_active` with two indexes: `uq_collection_booking_level_active` (stop NULL, live) and `uq_collection_stop_active` (one live collection per stop).
  - An insert guard checks stage, method, model, amount and fee. Pickup collections must charge the booking payable and the booking fee. Delivery collections must target the current ARRIVED stop and charge its payable and its fee share. Legacy bookings keep today's rules. PREPAID bookings get no collections.
- **trips:** `guard_trip_change` gains the pickup gate (C.3 rule 1 in J) and, for per-stop bookings, the stop rules.
- **Grants:** least privilege for the new tables.

**C.4 in detail**
- New earning columns: cash collected, online collected, cash fee, online fee, payout amount.
- The migration backfills these from the existing single-source rows and asserts inside the migration that every row adds up.
- New `earning_collections` link table.
- The single-source rule is relaxed for earnings with several collections.
- A payout item's amount must equal the earning's payout amount, and MIXED settlement is allowed.

**C.8 in detail**
1. Build the DB from the migration files up to `20261014120100`.
2. Seed a legacy matrix: every method × trip status × payment status; open, failed and completed QRs (`TAB-QR-001` included); cash with a fee debit; earnings in every status; a processed payout.
3. Apply the new migrations.
4. Assert that no existing value changed (per-row hash before and after), that every old row is marked LEGACY, that the legacy flows still finish, and that reconciliation lists the in-flight legacy rows.

## D. API contract changes

**Internal (engine)** (ARCH shape, IMPL field names)

```
POST /v1/internal/bookings                         X-Internal-Api-Key
  { externalRef, customerSubject, quoteId, paymentMethod: "PAY_AT_PICKUP" | "PAY_AT_DELIVERY" }
  201 created | 200 replay (same ref + same quote + same method + same customer)
  400 VALIDATION_FAILED (any unknown field, e.g. confirmedFarePaise, farePaise, vehicleCategory)
  422 PAYMENT_METHOD_NOT_OFFERED (PREPAID_UPI) | 422 QUOTE_NOT_FOUND | 422 CUSTOMER_NOT_FOUND
  409 QUOTE_EXPIRED | 409 QUOTE_ALREADY_USED | 409 BOOKING_REF_CONFLICT | 409 FEE_RULE_NOT_CONFIGURED
  -> { bookingId, externalRef, status, paymentMethod, paymentStatus, quoteId, pricingVersionCode,
       farePaise, taxPaise, payablePaise, platformFeePaise,
       stops: [{ sequence, payablePaise, status }], paymentGate, trip }

POST /v1/internal/trips/:tripId/status    { status }   DRIVER_ARRIVED | PICKUP_VERIFIED | IN_TRANSIT | DELIVERED | COMPLETED
  409 PAYMENT_REQUIRED { stage: "PICKUP", amountPaise }       PAY_AT_PICKUP, unpaid, PICKUP_VERIFIED
  409 STOPS_PENDING { pendingStops }                          per-stop booking, DELIVERED before every stop is final
  409 STOP_REQUIRED                                           per-stop booking, DROP_PROGRESS sent instead of a stop arrival
  repeats / older statuses: 200, no change (unchanged behaviour)

POST /v1/internal/trips/:tripId/stops/:sequence/status   (new)
  { status: "ARRIVED" | "DELIVERED" | "DELIVERY_FAILED", reason? (3-200, required for DELIVERY_FAILED) }
  404 STOP_NOT_FOUND | 409 INVALID_STOP_TRANSITION { from, to, currentStop }
  409 PAYMENT_REQUIRED { stage: "DROP", stopSequence, amountPaise } | 409 BOOKING_CLOSED
  -> booking view with stops and paymentGate

GET /v1/internal/bookings/:id | /by-ref/:externalRef    + stops[], paymentGate
GET /v1/internal/fare-quotes/:quoteId                    priced route (built in M3)
POST /v1/internal/bookings/:id/searching | /assign | /cancel   unchanged
```

**paymentGate** (IMPL)

```
Driver / engine view:
{ stage: "PICKUP" | "DROP" | null, stopSequence: number | null,
  paymentState: "NOT_REQUIRED" | "NOT_YET" | "PAYMENT_REQUIRED" | "PAYMENT_PROCESSING"
              | "PAYMENT_FAILED" | "PAYMENT_CONFIRMED",
  amountPaise: number | null, cashFeePaise: number | null,
  handoverAllowed: boolean, collectionId: string | null, lastFailure: string | null }

Customer view: { stage, stopSequence, paymentState, amountPaise, handoverAllowed }
  (no database or provider ids, no fee)
```

**Driver**

```
GET  /v1/trips, /v1/trips/:tripId            payment: + paymentGate, stops[{ sequence, payablePaise, status, paid }]
POST /v1/trips/:tripId/collections           Idempotency-Key required
  { method: "CASH" | "ONLINE_QR", stopSequence? (required for PAY_AT_DELIVERY, forbidden otherwise), amountPaise }
  amountPaise is a confirmation echo: the server computes the amount; a different echo -> 422 COLLECTION_AMOUNT_MISMATCH
  422 STOP_REQUIRED | 409 COLLECTION_NOT_ALLOWED { stage, currentStop } | 409 BOOKING_ALREADY_PAID
  409 BOOKING_CLOSED | 409 INSUFFICIENT_BALANCE { requiredFeePaise } | 409 COLLECTION_IN_PROGRESS
GET  /v1/trips/:tripId/collections/:id       unchanged (re-checks a pending QR with Razorpay)
```

**Customer**

```
POST /v1/customers/me | GET /v1/customers/me      built (M2)
POST /v1/fare/quotes  | GET /v1/fare/quotes/:id   built (M3)
GET  /v1/bookings/:id | /v1/bookings/by-ref/:externalRef (new)   own bookings only
  -> { bookingId, externalRef, status, paymentMethod, paymentStatus, payablePaise, currency,
       stops: [{ sequence, payablePaise, state: "UPCOMING"|"ARRIVED"|"PAID"|"DELIVERED"|"NOT_DELIVERED"|"CANCELLED" }],
       paymentGate (customer view), tripStatus }
POST /v1/bookings/:id/payment (+ /verify)          legacy PREPAID rows only; not used by any app
```

**Admin** (ARCH requirement, IMPL routes)

```
GET  /v1/admin/bookings/:id                         full money trail (snapshot, stops, collections, fee, wallet debit,
                                                    earning, settlement, payout, refunds, audit events)
POST /v1/admin/bookings/:id/stops/:sequence/resolve { resolution: "RETRY" | "UNDELIVERED", reason }
POST /v1/admin/refunds   Idempotency-Key            { sourceCollectionId | sourcePaymentId, kind: "PROVIDER" | "CASH_RETURNED",
                                                      amountPaise?, reason, creditFeeToWallet? (CASH_RETURNED: must be stated) }
GET  /v1/admin/refunds/:id | POST /v1/admin/refunds/:id/sync
GET  /v1/admin/audit-logs?bookingId&type&from&to&cursor
GET  /v1/admin/reconciliation/...                   existing + new reports (S below)
```

## E. State-machine changes

There are **no new booking or trip statuses** (ARCH). PAYMENT_REQUIRED, PROCESSING, FAILED and HANDOVER_ALLOWED are derived and exposed through `paymentGate`.

**Booking payment status** (IMPL)

| From | To | Who |
|---|---|---|
| UNPAID | PAID | Pickup collection completed. Single-stop delivery. Legacy rows. |
| UNPAID | PARTIALLY_PAID | First stop collection on a multi-stop delivery booking. |
| PARTIALLY_PAID | PAID | Last unpaid stop collected. |
| PAID / PARTIALLY_PAID | REFUND_PENDING → REFUNDED / PARTIALLY_REFUNDED | Phase 6 refund rows only. |

**Trip** (rule changes only)

| Transition | Rule | Tag |
|---|---|---|
| DRIVER_ARRIVED → PICKUP_VERIFIED | PAY_AT_PICKUP needs booking PAID. Applies in the service, API and DB, for every model. | ARCH |
| PICKUP_VERIFIED → IN_TRANSIT | Unchanged strict order. | ARCH |
| IN_TRANSIT → DROP_PROGRESS | Per-stop: set by the backend when the first stop arrives. Legacy: reported by the engine, as today. | IMPL |
| DROP_PROGRESS → DELIVERED | Per-stop: every stop must be DELIVERED, UNDELIVERED or CANCELLED. The backend sets it when the last stop becomes final, and an engine report then changes nothing. | IMPL |
| DELIVERED → PAYMENT_CONFIRMED | Set automatically when the booking is PAID or PARTIALLY_PAID and every stop is final. | ARCH |
| PAYMENT_CONFIRMED → COMPLETED | Unchanged. Creates the earning. | ARCH |

**Stop** (per-stop bookings; IMPL table, ARCH rules)

| From | To | Who | Condition |
|---|---|---|---|
| PENDING | ARRIVED | engine | Trip moving, every earlier stop final, no other current stop. |
| ARRIVED | PAYMENT_CONFIRMED | backend only | PAY_AT_DELIVERY, with a COMPLETED collection for this stop. |
| PAYMENT_CONFIRMED | DELIVERED | engine | PAY_AT_DELIVERY. |
| ARRIVED | DELIVERED | engine | PAY_AT_PICKUP, booking PAID. |
| ARRIVED / PAYMENT_CONFIRMED | DELIVERY_FAILED | engine | Reason required. |
| DELIVERY_FAILED | ARRIVED (unpaid) or PAYMENT_CONFIRMED (paid) | engine or admin RETRY | — |
| DELIVERY_FAILED | UNDELIVERED | admin only | Reason required. A deferred DB check requires the audit row in the same transaction. |
| any non-final | CANCELLED | booking cancel | — |

**Gate derivation** (IMPL)

| Situation | paymentState | handoverAllowed |
|---|---|---|
| PAY_AT_PICKUP, trip DRIVER_ASSIGNED | NOT_YET | false |
| PAY_AT_PICKUP, DRIVER_ARRIVED, unpaid, no live QR | PAYMENT_REQUIRED (latest QR FAILED → PAYMENT_FAILED) | false |
| … with a PENDING QR | PAYMENT_PROCESSING | false |
| … PAID, still DRIVER_ARRIVED | PAYMENT_CONFIRMED | **true** |
| PAY_AT_PICKUP after PICKUP_VERIFIED; its stops | NOT_REQUIRED | true when the current stop is ARRIVED |
| PAY_AT_DELIVERY before pickup and in transit | NOT_REQUIRED (pickup), NOT_YET (stops) | true at pickup when DRIVER_ARRIVED |
| PAY_AT_DELIVERY, current stop ARRIVED, unpaid / pending QR / failed QR | PAYMENT_REQUIRED / PROCESSING / FAILED | false |
| … stop PAYMENT_CONFIRMED | PAYMENT_CONFIRMED | **true** |
| Cancelled or completed booking | NOT_REQUIRED | false |

**Collections:** PENDING → COMPLETED | FAILED, as today. Refunds live on refund rows plus `refunded_paise` (Phase 6). **Earnings:** as today, plus MIXED settlement and the ON_HOLD reasons `PAYOUT_FAILED`, `REFUND`, `UNDELIVERED_STOP_REVIEW` and `DISPUTE`.

## F. Engine integration contract

| Event | Engine does | Backend call | On response | Tag |
|---|---|---|---|---|
| Customer confirms | Takes `{quoteId, paymentMethod}` from the app. `customerSubject` comes from the **verified Firebase token**. Never sends a fare. | `POST /internal/bookings` (synchronous). Retries reuse the same `externalRef`. | 201/200: store `paymentBookingId`, then dispatch immediately. 4xx: show the error and do not dispatch. | ARCH |
| Route | Builds the trip from the priced route. | `GET /internal/fare-quotes/:id` | The trip's stops must equal the quote's drops. | ARCH |
| Dispatch / accept | — | `/searching`, `/assign` | Store `paymentTripId` and expose both ids to the apps. | ARCH |
| Arrive at pickup | Its own step, no longer chained. | `DRIVER_ARRIVED` via the outbox | — | ARCH |
| Pickup OTP | Checks the OTP, then calls the backend **before** committing. | `PICKUP_VERIFIED` (synchronous; the outbox retries an unknown outcome) | 200: commit. 409 `PAYMENT_REQUIRED`: refuse the OTP ("payment required before handover") and commit nothing. | ARCH |
| Start | — | `IN_TRANSIT` (synchronous) | 409: refuse. | ARCH |
| Stop arrive | — | stop `ARRIVED` via the outbox | — | ARCH |
| Drop OTP | Reads `paymentGate.handoverAllowed` first. | `GET /internal/bookings/:id` | false: refuse the OTP. | ARCH |
| Drop delivered | Calls the backend before committing. | stop `DELIVERED` (synchronous) | 409 `PAYMENT_REQUIRED`: refuse and keep the stop open. | ARCH |
| Drop failed | Reason required. | stop `DELIVERY_FAILED` via the outbox | — | ARCH |
| Complete | Retry loop, as before. | `COMPLETED` | 409 `PAYMENT_REQUIRED`: retry with backoff. | ARCH |
| Cancel | Reason required. | `/cancel` via the outbox | — | ARCH |

**Engine contract items**

| Item | Tag |
|---|---|
| Outbox rules: durable, FIFO per trip, idempotent (the backend treats repeats as no-ops), exponential backoff with jitter, alert after N failures. 409 `INVALID_*` is a bug alert, never a silent drop. | IMPL |
| OTPs are served only to the authenticated owner. The PAY_AT_PICKUP pickup OTP is withheld until `handoverAllowed`. The PAY_AT_DELIVERY drop OTP is withheld until that stop's `handoverAllowed`. Remove OTPs from the unauthenticated `POST /rides` and `GET /rides/:id`. | IMPL |
| Delete the pickup path that skips the OTP (`POST /trips/:id/pickup/confirm`). | ARCH |
| The engine never sends `PAYMENT_CONFIRMED`, an amount, a fee or a payment status. | ARCH |
| Socket.IO, if added, is transport only. Redis, if added, is never a money source. | ARCH |
| The engine needs **persistent storage** for bookings with UUID refs and for the outbox. Today it keeps everything in memory, and its sequential ids (`R1`, `T1`) collide with stored `externalRef`s after a restart. | **BLOCKER** (BK-2) for production |
| The engine needs **Firebase token verification**. Today `driverId` and the customer id come from the request body. | **BLOCKER** (BK-2) for production |

## G. Driver App contract

| Screen state (engine trip + backend gate) | Shown | Enabled actions | Tag |
|---|---|---|---|
| En route to pickup | Trip, pickup address | ARRIVED | ARCH |
| Arrived, PAY_AT_PICKUP, PAYMENT_REQUIRED / FAILED | "Payment required ₹X" + reason for the last failure | COLLECT CASH, SHOW QR | ARCH |
| … PAYMENT_PROCESSING | QR, waiting status, expiry | Cash instead (the QR is closed first), share link | ARCH |
| … PAYMENT_CONFIRMED (`handoverAllowed`) | "Paid: cash / online" | ENTER SENDER OTP | ARCH |
| PICKUP_VERIFIED | — | START TRIP | ARCH |
| Arrived, PAY_AT_DELIVERY pickup | — | ENTER SENDER OTP (no payment) | ARCH |
| Stop n ARRIVED, PAY_AT_DELIVERY, unpaid | "Collect ₹X for drop n" | CASH, QR (sends `stopSequence`) | ARCH |
| Stop n PAYMENT_CONFIRMED | "Drop n paid" | ENTER DROP OTP, then proof, then DELIVERED | ARCH |
| Stop n ARRIVED, PAY_AT_PICKUP | — | ENTER DROP OTP | ARCH |
| Backend refuses (409 / 422) | The server's message | Refresh. Never move forward on a failure. | ARCH |

| Rule | Tag |
|---|---|
| Never chain arrive, OTP and start. Never auto-complete. A failed `DeliveryProofPreview` stays on the drop and re-reads backend state. | ARCH |
| Availability comes from `paymentGate` only. Fix the bug that treats PREPAID-while-UNPAID as paid. | ARCH |
| Idempotency-Key per attempt, reused only when the outcome is unknown (existing). Poll the gate every 3 s on the pickup and drop screens. Back off on errors (existing client). | IMPL |
| Engine trip → backend trip: the engine's `paymentTripId`, falling back to `externalRef`. | IMPL (depends on BK-2) |
| Wallet shortfall: show the cash fee due before the driver takes cash (`cashFeePaise` vs wallet balance). On `INSUFFICIENT_BALANCE`, offer RECHARGE or QR. | ARCH |
| Old app builds: a per-stop collection without `stopSequence` gets 422 `STOP_REQUIRED`. An optional minimum-version header (`426 UPGRADE_REQUIRED`) can be added. | IMPL |
| EN/HI strings for every new message. | ARCH |

## H. Customer App contract

| Item | Tag |
|---|---|
| Payment options are exactly **PAY AT PICKUP**, "Pay when the driver arrives at your pickup location.", and **PAY AT DELIVERY**, "Receiver pays when the driver arrives at the delivery location." | ARCH |
| Booking flow: locations → goods → vehicle → `POST /v1/fare/quotes` → option → confirm with the engine `{quoteId, paymentMethod}`. Book is disabled without an unexpired quote. Any change to route, vehicle or weight discards the quote and asks for a new one. | ARCH |
| Remove every local fare calculation and `CreateRideInput.fare`. Remove the prepaid chain (static UPI QR, "Pay ₹X", Processing, Pending, Successful, Failed, CashPaymentStatus, PaymentSelection, PaymentConfirmation) from the real flow. Keep them as Gallery-only screens or delete them. | ARCH |
| After the driver arrives (PAY_AT_PICKUP): "Driver has arrived. Payment is required to start the trip.", the amount, "Pay cash to the driver", "Ask the driver for the QR", and live status. No payment button. | ARCH |
| **The pickup OTP is hidden until `paymentGate.handoverAllowed`.** The engine withholds it too (F). | ARCH |
| PAY_AT_DELIVERY tracking: drop sequence, each drop's amount, and paid/unpaid and delivered/not-delivered per drop. | ARCH |
| Receipts and history use backend amounts and states only. | ARCH |
| Payments-backend client: base URL config, Firebase Bearer token, `POST /v1/customers/me` after sign-in. Email, Google and Apple users must add a verified phone. | ARCH |
| Add a Jest setup (pinned devDependencies). Rewrite `AGENTS.md`, `WIRING_MAP.md` and `README.md`, which still say Expo, mock-only, no API calls. | IMPL (N9) |

## I. Test plan

Everything below is required by §28 (ARCH). File names are IMPL. Integration tests run against real Postgres with the real migrations and fake Razorpay/RazorpayX gateways.

**I.1 PAY_AT_PICKUP** (`pickup-payment.int-spec.ts`). Cases:
- cash happy path; QR happy path
- unpaid pickup OTP refused; unpaid start refused
- DB bypass attempts as the owner role (direct UPDATE of `trips.status`)
- duplicate cash; concurrent cash
- QR pending; QR expiry, then retry; cash while a QR is open; QR after cash
- the wrong booking's QR
- provider success followed by a finalizer crash, with recovery through webhook 503 retry, driver refresh, admin sync and the recovery job
- webhook before the API response, API before webhook, duplicate webhook, invalid signature
- wallet shortfall
- cancellation racing payment (both orders)
- authorization: another driver, a customer, the engine key, an admin

**I.2 PAY_AT_DELIVERY** (`delivery-stops.int-spec.ts`). Cases:
- one drop; three drops paid cash, QR, cash
- current stop only; wrong stop refused; wrong amount refused
- unpaid delivery refused (API and DB)
- drop 2's payment cannot satisfy drop 1 (application rules plus a composite-FK attempt in SQL)
- receiver refuses drop 2: DELIVERY_FAILED, then retry, then admin UNDELIVERED with reason and audit
- PARTIALLY_PAID; the completion rules; MIXED earning with the right split and payout amount

**I.3 Registration** (`booking-registration.int-spec.ts`). Cases:
- quote required; quote expired; quote reused; another customer's quote
- PREPAID_UPI refused in the API and DB
- client amount fields refused
- duplicate `externalRef` replay and conflict
- concurrent registrations with the same ref and with the same quote

**I.4 Financial**:
- wallet never negative, under concurrent debits
- no duplicate fee debit
- no duplicate earning
- settlement mismatch
- payout concurrency and payout timeout
- bank account change during a payout
- failed payout → ON_HOLD, then admin release

**I.5 Refunds** (`refunds.int-spec.ts`). Cases:
- duplicate and concurrent requests
- webhook and API arriving in either order converge on one state
- cash-return audit path with an explicit fee choice
- policy switches respected: nothing happens automatically while they are off

**I.6 Legacy** (`legacy-bookings.int-spec.ts`, `migration-legacy-data.int-spec.ts`). Cases:
- a `TAB-QR-001`-style row still refreshes, collects and completes
- historical PREPAID rows still complete
- no historical value changes across the migration
- up, down, up

**I.7 Unit tests:** paymentGate, stop transitions, trip transitions, fee allocation (sums, ties, extremes), obligation resolution, authorization and least privilege (new grants, plus denied SQL for every new table).

**I.8 Existing specs** (`collections`, `trips-earnings`, `fee-rules`, `least-privilege`, `payouts`, `booking-payments`) move to quote-based registration, or to legacy fixtures where they test legacy behaviour. Assertions are kept or made stronger, never weakened.

**I.9 E2E** (`run-local-e2e.mjs`):
1. PAY AT PICKUP cash.
2. PAY AT PICKUP QR → settlement → payout.
3. PAY AT DELIVERY with 3 drops paid cash, QR, cash.

**I.10 Driver App (Jest):**
- gate-driven UI
- pickup OTP disabled until `handoverAllowed`
- start disabled until PICKUP_VERIFIED
- `stopSequence` handling
- failure navigation
- DTO parsing

**I.11 Customer App (Jest):**
- exactly two options with the exact copy
- quote validity and re-quote on any change
- gate display
- pickup OTP visibility

## J. Security and concurrency checklist

**Threat checklist**

| Threat (§27 / §13 / §19) | Service / API | Database | Test |
|---|---|---|---|
| Change fare, tax, fee or stop payable | No such input; unknown fields → 400 | Snapshot and stop amounts immutable; insert trigger matches the quote | I.3, least-privilege |
| Mark payment, collection or handover confirmed | No write path. Gate is derived. Collections complete only on provider state or a cash transaction. | Stop PAYMENT_CONFIRMED requires a COMPLETED collection for that stop | I.1, I.2 |
| Start an unpaid trip or hand over goods | 409 `PAYMENT_REQUIRED` | `guard_trip_change` | I.1 (with owner-role SQL) |
| Deliver an unpaid drop | 409 `PAYMENT_REQUIRED` | `guard_booking_stop_change` | I.2 |
| Move payment between bookings or stops | Obligation resolved server-side; finalizer checks reference, amount and context | Composite FK; one live collection per obligation; unique provider payment and reference | I.1 #18, I.2 |
| Negative wallet / duplicate fee debit | Ledger refuses | CHECKs; unique ledger key per collection | I.4 |
| Duplicate earning or payout | Uniques | `uq_earnings_*`; payout item guards | I.4 |
| Ownership and engine-auth bypass | Customer/driver scoping in queries; internal key | API role grants | auth, least-privilege |
| Deleting or truncating financial rows | — | `prevent_financial_record_delete` on every new table | least-privilege |
| Stale mobile client | Server-side checks; 422 `STOP_REQUIRED`; optional minimum version | — | I.1, I.2 |
| Retry storms | Per-identity throttles (existing); idempotent replays; backoff in clients and the engine outbox | Uniques | I.1, I.4 |
| Backend crash | One transaction per write; webhook 503 and retry; recovery job | Deferred checks | I.1 |

**Concurrency rules**

| Rule | Tag |
|---|---|
| Lock order everywhere: **booking → trip → stop → collection/payment → wallet**. External calls never run inside a transaction (existing rule). | ARCH |
| Exactly one outcome wins each race. Losers replay, or get a fixed 409 or 422. Covered: two collections, cash and QR at once, duplicate cash, duplicate webhook, two drivers assigning, duplicate arrive or stop transition, cancel vs payment, refund vs refund, payout vs payout, debit vs debit (`concurrency.int-spec.ts`). | ARCH |

## K. Migration and backward compatibility

| Item | Tag |
|---|---|
| **Legacy booking model.** Every booking that exists before the migration is marked `LEGACY_BOOKING_LEVEL` and keeps today's rules unchanged: booking-level collection windows, a single collection, single-source earnings, prepaid Checkout. No stops are created for it and no stored value is rewritten. All new bookings are `QUOTE_PER_STOP`. This is what keeps `TAB-QR-001` collectable. | IMPL (N3) |
| The pickup gate also applies to legacy PAY_AT_PICKUP rows when they next move from DRIVER_ARRIVED. It is a safety gain, and the driver can collect at that point. There are no such rows in dev. | IMPL (N2) |
| The `PREPAID_UPI` enum value stays. Historical PREPAID rows keep a working Checkout and earnings path. New PREPAID rows are refused in the API and by a DB insert trigger. No app calls the prepaid routes. | ARCH |
| Legacy fixtures in tests are inserted by the owner role, with the insert guard disabled inside the fixture transaction. The API role cannot do this. | IMPL |
| The internal registration contract changes in place under `/v1`. No engine has ever called it (engine-v2 has no backend calls). spec.html and the PDFs change in Phase 12. | IMPL |
| Driver App DTO changes are additive. Customer App calls are new. | IMPL |
| Removing the legacy code later (once no environment has unfinished legacy rows) is a separate, explicit cleanup. | OPEN (L-22) |
| Rollback uses `down.sql` per migration, tested up, down, up. Enum values stay. | IMPL |

## L. Open business decisions

Each technical default below is a temporary safe value, configurable, and not a final rule.

| ID | Decision | Technical safe default | Where |
|---|---|---|---|
| L-1 | Final pricing: base, per km, vehicle, weight, minimum, surcharges, extra drops, road vs straight-line distance | No production pricing version until approved. `PROTOTYPE*` versions are dev only and refused in production (CLI today; admin API in Phase 1). | pricing versions |
| L-2 | Tax / GST and the fee basis when tax exists | The pricing model refuses taxes. Bookings with tax > 0 are refused. | pricing config |
| L-3 | Vehicle categories offered and their codes (D-28) | Codes `^[A-Z][A-Z0-9_]*$`; the prototype list is dev only. | N6 |
| L-4 | Maximum drops (D-29) | 5 | quote DTO, DB CHECK |
| L-5 | Quote validity | 600 s | `FARE_QUOTE_TTL_SECONDS` |
| L-6 | How long a pickup QR stays valid | 30 min | `COLLECTION_LINK_TTL_MINUTES` |
| L-7 | Refund eligibility: cancel before or after handover, driver failure, undelivered drop | No refund is automatic. Admin-initiated only, with a reason and audit. | `refund-policy.ts` |
| L-8 | Automatic vs manual refunds | Manual (`REFUND_AUTO_ON_CANCEL=off`) | config |
| L-9 | Partial refunds | Disabled (`REFUND_PARTIAL_ALLOWED=false`) | config |
| L-10 | Platform fee when cash is returned or a refund is made | No automatic wallet credit. On a cash return the admin must state the choice each time, and it is recorded. | refund API |
| L-11 | Undelivered stop, financially. PAY_AT_PICKUP: the stop was paid. PAY_AT_DELIVERY: the stop is unpaid. | Facts recorded. The earning reflects only what was collected. The online part goes ON_HOLD (`UNDELIVERED_STOP_REVIEW`) until an admin releases it. | earnings |
| L-12 | Booking cancelled after pickup payment or after handover | Allowed with a reason. QR closed. Listed in paid-cancelled. No money moves. | bookings |
| L-13 | No-show (sender absent, or never pays) | No timer. Manual cancel with a reason. | engine/ops |
| L-14 | Cancellation fee (D-23) | Zero | — |
| L-15 | Driver compensation (no-show, failed delivery, cancellation) | None automatically. An audited admin wallet adjustment if decided. | wallet adjustments |
| L-16 | Reassignment after payment, or the driver becoming unavailable | Not supported (one trip per booking). Ops cancels, then refund review. | — |
| L-17 | Customer penalties or restrictions | None | — |
| L-18 | Receiver confirmation of cash (D-21) | The driver records it. No receiver confirmation. | — |
| L-19 | How receivers get the drop OTP (SMS provider, D-36) | Shown in the sender's app, once that drop is paid. | engine |
| L-20 | QR and cash paid at the same moment (D-53) | Flagged for review | reconciliation |
| L-21 | Recovering money already paid out to a driver when a refund comes later | No automatic debit. Listed in a report. | reconciliation |
| L-22 | When to remove the legacy model code | After every environment has no unfinished legacy rows | — |
| L-23 | TDS and minimum payout (D-54/55/57) | Existing: TDS disabled; minimum ₹1 | existing |

## M. Conflicts between this prompt and the current code

| # | Conflict | Where | Resolved in |
|---|---|---|---|
| 1 | An unpaid PAY_AT_PICKUP trip can be pickup-verified, started and delivered. Only COMPLETED is gated. | `bookings.service.ts` `updateTripStatus`, `guard_trip_change` | Phase 3 |
| 2 | PAY_AT_DELIVERY is one collection for the whole booking, only after the last drop. | `trip-lifecycle.ts` `DELIVERY_COLLECTION_WINDOW`; `collections.service.ts` `assertCollectable` | 2–4 |
| 3 | No stops. A collection has no stop. There is one live collection per booking. | schema, `uq_collection_booking_active` | 2, 4 |
| 4 | Registration takes `confirmedFarePaise` and `vehicleCategory` from the engine. | `bookings.dto.ts` `RegisterBookingRequest` | 1 |
| 5 | PREPAID_UPI is accepted at registration, and the customer Checkout routes are open for it. | `bookings.dto.ts`, `booking-payments.controller.ts` | 1 (refuse new; legacy kept) |
| 6 | One fee debit per booking for ever (`cash-ride-fee:<bookingId>`). | `collections.service.ts` `recordCash` | 4 (per collection) |
| 7 | Earnings have exactly one source, and payout items require ONLINE with amount = net. MIXED is impossible. | `earnings_single_source`, `guard_payout_item_change` | 5 |
| 8 | A failed payout re-queues the earnings as PAYABLE automatically. | `payout-status.service.ts:66`, test `#14` | 5 (ON_HOLD) |
| 9 | No refund records, no provider refund call, no refund webhooks. | — | 6 |
| 10 | No uniform record of financial transitions (only `admin_actions` and `payment_events`). | — | 7 |
| 11 | Engine: no payment integration. Client fare accepted. No auth. OTPs exposed without auth. A pickup path that skips the OTP. In-memory sequential ids. No outbox. | engine-v2 | 8 (BK-2) |
| 12 | Driver App: arrive, OTP and start chained. Auto-completes. Ignores delivery-proof failures. Treats PREPAID-while-UNPAID as paid. No stop concept. | `dispatch.ts`, `TripController.ts`, `DeliveryProofPreviewScreen`, `collectionFlow.ts` | 9 |
| 13 | Customer App: local fares, client fare sent, three options (UPI / COD / Cash at Pickup), mock prepaid chain, no payment-backend client, OTP shown regardless of payment. `AGENTS.md` forbids API calls. | see H | 10 |
| 14 | spec.html, architecture.html and the PDFs describe Pay Now before dispatch, a pickup window "from arrival until delivery", delivery "after the last drop", and the engine sending a fare. | `engine-payment-integration/` | 12 |
| 15 | OPEN_DECISIONS D-06/D-19/D-50 describe the old windows. The original master prompt (line 255) says "PREPAID_UPI / online before booking". | docs | 12 |
| 16 | My impact plan chose policy in D-67, D-68 and D-70, and assumed an empty production in D-69. | `PAY_AT_PICKUP_IMPACT_PLAN.md` | This review (L, K) |

## N. Assumptions that need your confirmation

| # | Assumption | If wrong | Tag |
|---|---|---|---|
| N1 | No deployed staging or production database holds data yet. Only the local databases exist. | Run the preflight there and send me the output before any migration is applied there. | **BLOCKER** for that environment |
| N2 | The pickup gate also applies to existing (legacy) PAY_AT_PICKUP rows. | I exempt legacy rows from the gate. | IMPL |
| N3 | Legacy model (K) instead of backfilling stops. | Backfill strands `TAB-QR-001`-style rows, so I would not recommend it. | IMPL |
| N4 | The legacy prepaid Checkout path stays working, for historical PREPAID rows only. | I remove the routes and services (historical unpaid PREPAID rows would need an admin cancel). | IMPL |
| N5 | A PAY_AT_DELIVERY trip can complete with UNDELIVERED stops (booking PARTIALLY_PAID). A trip where nothing was collected cannot complete; an admin cancels it. | — | IMPL |
| N6 | One canonical list of vehicle category codes, shared by the apps, the engine and pricing (D-28). | Needed before Phase 10. Dev uses the prototype list. | OPEN |
| N7 | At most 5 drops per booking. | Change the DTO and CHECK. | OPEN |
| N8 | Your friend implements contract F, including persistence and auth. Until then the backend tests stand in for the engine through the internal API. | Production E2E waits. | **BLOCKER** (BK-2) |
| N9 | OK to rewrite the customer app's `AGENTS.md` (mock-only rules) and to add pinned Jest devDependencies. | Customer App tests can't run. | IMPL |
| N10 | Failed payouts go ON_HOLD for a human instead of re-queuing automatically. This means ops work for every failed payout. | — | ARCH (§20); please note the ops impact |
| N11 | M2 and M3 are still uncommitted (HEAD `dc54485`). OK to commit them on `raj_backend` before Phase 1 continues? Nothing is ever pushed. | They stay uncommitted. | IMPL |

**Blockers outside the code**

| ID | Blocker | Blocks |
|---|---|---|
| BK-1 | Data state of any non-local environment (N1). | Migrating that environment. |
| BK-2 | Engine persistence, Firebase auth, UUID refs, outbox and backend-first gates (engine developer). | Production integration and real-engine E2E. |
| BK-3 | Razorpay QR Codes activation (D-47). | Live QR. Test mode uses payment links. |
| BK-4 | RazorpayX activation (D-46/D-58). | Live payouts. |
| BK-5 | Settlement reconciliation verified on the live account (D-56). | Online earnings becoming payable in production. |
| BK-6 | Vehicle category codes (N6). | Customer App ↔ pricing integration. |
| BK-7 | Approved pricing (L-1). | Taking real bookings in production. |

## Acceptance criteria (§34) traceability

| # | Criterion | Phase | Verified by |
|---|---|---|---|
| 1 | Only the two methods are customer-facing | 1, 10 | I.3, I.11 |
| 2 | No payment before assignment | 1 | I.1 |
| 3 | Pay after arrival, before handover/start | 3 | I.1 |
| 4 | Cash and driver QR at pickup | 4 | I.1 |
| 5 | Separate payment per active drop | 2–4 | I.2 |
| 6 | Unpaid drop never delivered | 3 | I.2 |
| 7 | No cross-stop payment | 4 | I.2 |
| 8 | Fare from the server quote | 1 | fare + I.3 |
| 9 | Client can't change money | 1, 4 | I.3, J |
| 10 | Fee deterministic and pinned | 1 | unit + I.2 |
| 11 | Wallet never negative | existing | I.4 |
| 12 | Idempotent everywhere | all | J |
| 13 | Webhooks verified and deduplicated | existing | webhooks + I.1 |
| 14 | Gates in backend and DB | 3 | I.1, I.2 |
| 15 | Backend-first engine | 8 | contract tests |
| 16 | Driver UI can't bypass | 9 | I.10 + backend gates |
| 17 | OTP visibility can't bypass | 3, 8, 10 | I.1, I.11 |
| 18 | Historical PREPAID safe | 2 | I.6 |
| 19 | New PREPAID refused | 1 | I.3 |
| 20 | Refund infrastructure without invented policy | 6 | I.5 |
| 21 | No hard-coded no-show / undelivered policy | 3, 6 | L, I.2 |
| 22 | Migration safety verified | 2 | C.8, I.6, preflight |
| 23 | Provider/internal mismatch reconciled | 7 | recon tests |
| 24 | Financial/admin actions auditable | 7 | audit tests |
| 25 | E2E and concurrency pass | 11 | I.9, J |
| 26 | Docs match behaviour | 12 | review |
