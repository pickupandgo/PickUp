# Architecture Traceability: MultipleRide (Pick Up) V1 Backend

Phase 0 audit, 2 Oct 2026. Sections 1–4 describe the specs and the prototype as audited. The payments + driver wallet slice has since been built on branch `raj_backend`; [section 5](#5-implementation-status-payments--driver-wallet-slice) maps each requirement to its code and tests.

- **Module** means the NestJS module in the new backend (this repository, branch `raj_backend`).
- **Prototype** means `PickUp/` on branch `engine-v2`. Both apps call it today at `pickup-backend-engine-v2.onrender.com`.
- **Prototype legend:** ✓ meets the requirement · ◐ partial (logic only, no persistence or auth) · ✗ missing or contradicts it.
- **D-xx** refers to an entry in [OPEN_DECISIONS.md](./OPEN_DECISIONS.md).

## 1. Source documents

| ID | File | Pages | Read |
|---|---|---|---|
| M0 | Pick_Up_M0_Production_Database_Architecture.pdf | 4 | Complete |
| M1 | Pick_Up_M1_Domain_Entity_Identification_Updated.pdf | 9 | Complete, including relationship addendum |
| M3 | Pick_Up_M3_Driver_KYC_Vehicle_Database (1).pdf | 5 | Complete |
| M4 | Pick_Up_M4_Location_Geospatial_Database (1).pdf | 9 | Complete |
| M5 | Pick_Up_M5_Booking_Database_Architecture (2).pdf | 10 | Complete |
| M6 | Pick_Up_M6_Trip_Multidrop_Database_Architecture (5).pdf | 11 | Complete |
| PW | PickUp_Payment_Wallet_Industry_Grade_DB_Queries.pdf | 17 | Complete |
| MP | MultipleRide_Master_Kiro_Backend_Prompt.md | – | Complete. Implementation directive; the PDFs take precedence. |

Text was extracted from every page; no page came back empty. PW contains unresolved citation markers (`filecite turn12file0`) that point to a "Customer + Driver Payment Architecture V1" document.

Referenced by the PDFs but not supplied:

| Missing source | Referenced by | Would define |
|---|---|---|
| M2 Identity & Customer Database | M1, M4 | `users`, customer profile and `customer_addresses` columns |
| M7 Assignment | M4, M5 | `driver_offers`, `assignment_attempts`, offer and lock flow |
| M8 Location history | M6 | Mostly covered by M4 |
| M9 Pricing | M5 | `pricing_rules`, fare formula |
| M10 Payments / M11 Wallet | M5, M6 | Largely covered by PW |
| M12 Files / Delivery proof | M5, M6 | `delivery_proofs`, S3 layout |
| M14 Cancellation | M6 | `cancellations`, charges, refunds |
| M17 Ratings / history | M6 | `ratings` |
| Pick Up SRS & Development Proposal V1 | M0–M6 | Product requirements |
| Pick Up Driver Find, Assignment & Delivery Architecture | M0–M4 | Dispatch |
| Pick Up Nearby Driver Assignment Engine | M4 | Dispatch |
| Customer + Driver Payment Architecture V1 | PW | Payment business rules |

## 2. Requirement map

### 2.1 Platform (M0)

| ID | Requirement | Entity | Module | Prototype | Planned tests |
|---|---|---|---|---|---|
| M0-1 | PostgreSQL is the permanent business source of truth | all | prisma | ✗ in-memory arrays | Integration suite runs against real PostgreSQL |
| M0-2 | PostGIS handles geo queries and spatial indexes | geography columns | locations | ✗ JS haversine | Nearby-search integration test |
| M0-3 | Redis holds only live state, cache and locks; losing it must not destroy history | – | redis | ✗ | Flush Redis, then bookings and history still intact |
| M0-4 | Files go in S3; PostgreSQL stores metadata and object keys | `*_documents`, `delivery_proofs` | storage | ✗ stores a client-supplied URI | Upload type/size validation tests |
| M0-5 | Commit business state before emitting realtime events | – | realtime | ✗ no realtime | Emit-after-commit test |
| M0-6 | No MongoDB in V1 | – | – | ✓ | – |

### 2.2 Entity inventory (M1 plus later documents)

| Entity | Domain | Column-level spec | Phase |
|---|---|---|---|
| `users` | Identity | Partial (M3: id, phone, role, status); M2 missing | 1–2 |
| `customers` (M5) / `customer_profiles` (M1) | Customer | Partial (M5: id, user_id, status); D-09 | 1–2 |
| `customer_addresses` | Customer | Partial (M4: id, customer_id, label, location, is_default) | 1–2 |
| `drivers` | Driver & Fleet | M3 | 1–2 |
| `driver_documents` | Driver & Fleet | M3 | 1–2 |
| `vehicle_categories` | Driver & Fleet | M3 | 1–2 |
| `vehicles` | Driver & Fleet | M3 | 1–2 |
| `vehicle_documents` | Driver & Fleet | M3 | 1–2 |
| `service_areas` | Driver & Fleet / Location | M4 | 1, 3 |
| `driver_current_locations` | Location | M4 (not in the M1 list) | 1, 3 |
| `driver_locations` | Location | M4 | 1, 3 |
| `driver_offers` | Trip Ops | Name only; M7 missing | 3 |
| `assignment_attempts` | Trip Ops | Name only; M7 missing | 3 |
| `bookings` | Booking | M5 | 1, 4 |
| `booking_stops` | Booking | M5 | 1, 4 |
| `trips` | Trip Ops | M6 | 1, 4 |
| `trip_stops` | Trip Ops | M6 | 1, 4 |
| `delivery_proofs` | Trip Ops | Name and purpose only; M12 missing; D-35 | 4 |
| `payments` | Finance | PW | 1, 5 |
| `payment_events` | Finance | PW (not in M1) | 1, 5 |
| `payment_collections` | Finance | PW (not in M1) | 1, 5 |
| `fee_rules` | Finance | PW (not in M1) | 1, 6 |
| `driver_wallets` (M1: `wallets`) | Finance | PW; D-08 | 1, 6 |
| `driver_wallet_transactions` (M1: `wallet_transactions`) | Finance | PW; D-08 | 1, 6 |
| `trip_earnings` | Finance | Optional and undecided (M1); D-18 | Deferred |
| `insurance_providers`, `insurance_quotes`, `booking_insurance` | Insurance | Name only; D-11 | Deferred |
| `chat_conversations`, `chat_participants`, `chat_messages` | Communication | Name only | Later |
| `call_records` | Communication | Name only; D-37 | Deferred |
| `notifications` | Communication | Name only | Later |
| `cancellations` | Operations | Name only; M14 missing | 4 (minimal) |
| `ratings` | Operations | Name only; M17 missing | Later |
| `subscription_plans`, `driver_subscriptions` | Subscription | Name only; D-12 | Deferred |
| `pricing_rules` | Admin & Config | Name only; M9 missing; D-14 | 4 |
| `admin_actions` | Admin & Config | Name only | 2+ |

### 2.3 Driver, KYC and vehicle (M3)

| ID | Requirement | Entity | Module / API | Prototype | Planned tests |
|---|---|---|---|---|---|
| M3-1 | User identity is separate from the driver profile; users → drivers is 1:1 (UNIQUE user_id) | `users`, `drivers` | users, drivers | ✗ any ID auto-creates a driver | Unique-constraint test |
| M3-2 | `approval_status` and `availability_status` are separate dimensions | `drivers` | drivers | ✗ one `isAvailable` flag | State tests; D-05 |
| M3-3 | Driver documents AADHAAR, PAN, DRIVING_LICENSE, ADDRESS_PROOF. Lifecycle: PENDING → UNDER_REVIEW → APPROVED/REJECTED → EXPIRED | `driver_documents` | driver-documents | ✗ | Lifecycle transition tests |
| M3-4 | Vehicle documents RC, INSURANCE, PUC, PERMIT, each with its own status and expiry | `vehicle_documents` | vehicle-documents | ✗ | Lifecycle tests |
| M3-5 | Vehicle approval is independent of driver approval | `vehicles` | vehicles, admin | ✗ | Approved driver with an unapproved vehicle is ineligible |
| M3-6 | Registration number is unique in canonical form | `vehicles` | vehicles | ✗ | `RJ 19 AB 1234` and `rj19ab1234` collide |
| M3-7 | KYC numbers have restricted, controlled exposure | `driver_documents` | driver-documents | ✗ | Non-admin can't read numbers; responses are masked |
| M3-8 | Files live in private S3; the database holds metadata | `*_documents` | storage | ✗ | Signed URL issued only after authorization |
| M3-9 | Eligibility needs driver APPROVED, vehicle APPROVED and the correct category. Location, wallet and subscription checks come later. | `drivers`, `vehicles` | dispatch | ✗ | Eligibility matrix tests |
| M3-10 | Approval audit (approved_at/by, verified_by/at) | `drivers`, `*_documents`, `admin_actions` | admin | ✗ | Audit row is written |

### 2.4 Location (M4)

| ID | Requirement | Entity | Module / API | Prototype | Planned tests |
|---|---|---|---|---|---|
| M4-1 | Keep current location (Redis + `driver_current_locations`), history (`driver_locations`) and booking snapshot (`booking_stops.location`) separate | 3 tables + Redis | locations | ✗ | – |
| M4-2 | GPS payload: lat, lng, accuracy_m, speed_mps, heading_deg, recorded_at, source. Server checks the authenticated driver, value ranges and timestamp. | location tables | `POST /v1/drivers/me/location` | ◐ range check only, no auth | Malformed, out-of-range, stale and other-driver payloads rejected |
| M4-3 | `GEOGRAPHY(Point, 4326)`, `POINT(lng lat)` order | geo columns | migrations | ✗ | Coordinate-order regression test |
| M4-4 | Indexes: GiST(location) + UNIQUE(driver_id) on current; GiST + (driver_id, recorded_at DESC) on history; GiST(boundary) on service areas | indexes | migrations | ✗ | Migration assertion |
| M4-5 | Service areas are Polygon/MultiPolygon SRID 4326; the point-in-area check runs on the server | `service_areas` | locations | ✗ | Inside/outside Jodhpur test; D-31 |
| M4-6 | Nearby search: PostGIS finds candidates, NestJS applies eligibility, top N go to assignment | – | dispatch | ◐ haversine, no eligibility | Ranking and eligibility tests |
| M4-7 | Geographic distance is not road distance; ETA comes from the routing provider | – | routing adapter | ✗ assumes a fixed 25 km/h | D-33 |
| M4-8 | Not every GPS update becomes history; sampling and retention are configurable | `driver_locations` | locations | n/a | Sampling config test; D-32 |
| M4-9 | Customers see only the assigned driver's location during an active trip. Raw coordinates are never public. Admin access is audited. | – | locations, auth | ✗ `/drivers` and `/drivers/nearby` return coordinates publicly | Authorization tests |
| M4-10 | A Redis restart must not erase persisted history | – | locations | ✗ | Flush test |

### 2.5 Booking (M5)

| ID | Requirement | Entity | Module / API | Prototype | Planned tests |
|---|---|---|---|---|---|
| M5-1 | A booking belongs to one customer and references the requested vehicle category, never a driver or vehicle | `bookings` | bookings | ✗ customer picks a specific driver | – |
| M5-2 | Fields: goods_description, goods_type, weight_kg ≥ 0, declared_value_minor, fare_estimate_minor, final_fare_minor, payment_method, payment_status, insurance_required, insurance_quote_id, pickup_notes, customer_notes, timestamps | `bookings` | `POST /v1/bookings` | ✗ | DTO validation tests |
| M5-3 | Money is integer minor units (paise), never float | `bookings` | all | ✗ float rupees | Type and CHECK tests |
| M5-4 | `booking_stops`: sequence 0 = pickup, 1..N = drops; stop_type; address snapshot; location; receiver_name/phone; delivery_instructions | `booking_stops` | bookings | ◐ in-memory array; pickup stored separately | Ordering tests |
| M5-5 | No hard-coded stop count in the schema | `booking_stops` | – | ✗ max 5 hard-coded | Configurable limit test; D-29 |
| M5-6 | Snapshot vs reference: editing a saved address never changes an existing booking | `booking_stops`, `customer_addresses` | bookings | n/a | Edit-address regression test |
| M5-7 | Booking and its stops are written in one transaction, so no orphan stops | both | bookings | ✗ | Forced-failure rollback test |
| M5-8 | `POST /bookings` is idempotent | `bookings` + idempotency key | bookings | ✗ | Same key twice returns the same booking; same key with a different body returns 409 |
| M5-9 | Optional public booking number, UNIQUE | `bookings` | bookings | ✗ | – |
| M5-10 | UNIQUE(booking_id, sequence); weight and amounts ≥ 0; indexes (customer_id, created_at DESC), (status, created_at), (booking_id, sequence) | – | migrations | ✗ | Constraint tests |
| M5-11 | Booking status is distinct from trip status; the booking isn't the full trip state machine | `bookings` | bookings | ✗ | D-01 |
| M5-12 | The fare estimate snapshot survives pricing-rule changes | `bookings` | pricing | ✗ client can override the fare | Change a rule, old booking unchanged; D-14 |

### 2.6 Trip and multi-drop (M6)

| ID | Requirement | Entity | Module / API | Prototype | Planned tests |
|---|---|---|---|---|---|
| M6-1 | `trips`: booking_id UNIQUE, driver_id and vehicle_id NOT NULL, status, current_stop_id, lifecycle timestamps | `trips` | trips | ◐ | Second trip for the same booking rejected; D-02 |
| M6-2 | `trip_stops`: trip_id, booking_stop_id, sequence, stop_type, status, arrived/started/delivered_at; UNIQUE(trip_id, sequence); UNIQUE(trip_id, booking_stop_id) | `trip_stops` | trips | ◐ | Constraint tests |
| M6-3 | Pickup is trip stop sequence 0 | `trip_stops` | trips | ✗ pickup isn't a stop | D-04 |
| M6-4 | At most one IN_TRANSIT/ARRIVED stop per trip (partial unique index) | `trip_stops` | migrations | ◐ enforced in code only | Concurrent progression test |
| M6-5 | Trip lifecycle: CREATED → SEARCHING_DRIVER → DRIVER_ASSIGNED → DRIVER_ARRIVED → PICKUP_VERIFIED → IN_TRANSIT → DROP_PROGRESS → DELIVERED → PAYMENT_CONFIRMED → COMPLETED | `trips` | trips | ◐ no CREATED, SEARCHING_DRIVER or PAYMENT_CONFIRMED | Full transition matrix; D-01, D-02, D-03 |
| M6-6 | Stop lifecycle: PENDING → IN_TRANSIT → ARRIVED → DELIVERED | `trip_stops` | trips | ✓ logic | Transition matrix |
| M6-7 | Each progression runs in a transaction: lock trip and current stop; check driver, requested stop = current_stop_id, not already delivered, OTP/proof valid; activate the next stop only after success | `trips`, `trip_stops` | `POST /v1/trips/:id/stops/:stopId/...` | ◐ logic correct, no locking | Parallel deliver requests: exactly one wins |
| M6-8 | Completion needs all drops delivered and payment confirmed | `trips`, `payments` | trips | ✗ no payment gate | Completing before payment is rejected |
| M6-9 | Completion sets trip COMPLETED, booking COMPLETED and driver AVAILABLE in one transaction | `trips`, `bookings`, `drivers` | trips | ◐ | Atomic completion test |
| M6-10 | Indexes (trip_id, sequence), (trip_id, status), (driver_id, status), (status) | – | migrations | ✗ | – |
| M6-11 | Customer-confirmed order is preserved; no auto-reordering | `trip_stops` | trips | ✓ | Skipping a stop is rejected (ported from the m19 test) |
| M6-12 | Clients can't jump server-owned states | `trips` | trips | ◐ `driverId` in body, no auth | Wrong driver gets 403 |

### 2.7 Payments and driver wallet (PW)

Test numbers refer to the 10 mandatory financial tests in MP §18.

| ID | Requirement | Entity | Module / API | Prototype | Planned tests |
|---|---|---|---|---|---|
| PW-1 | One wallet per driver; balance_paise BIGINT ≥ 0; status; version | `driver_wallets` | driver-wallet | ✗ | CHECK constraint test |
| PW-2 | Append-only ledger: positive amount plus direction, balance_after, UNIQUE idempotency_key, partial UNIQUE(provider, provider_event_id) | `driver_wallet_transactions` | driver-wallet | ✗ | Test #9 (UPDATE/DELETE rejected) |
| PW-3 | `payments`: purpose BOOKING or DRIVER_WALLET_TOPUP; UNIQUE razorpay_order_id and razorpay_payment_id; INR only | `payments` | payments | ✗ | Test #7 |
| PW-4 | `payment_events`: UNIQUE event_id, JSONB payload, signature_valid, processed_at, processing_error | `payment_events` | payment-events, `POST /v1/webhooks/razorpay` | ✗ | Tests #1, #5 |
| PW-5 | `payment_collections`: stage PICKUP/DELIVERY; method CASH/ONLINE_QR; UNIQUE idempotency_key; partial UNIQUE(provider, provider_payment_id) | `payment_collections` | payment-collections | ✗ | Test #2 |
| PW-6 | `fee_rules`: FIXED or PERCENTAGE, versioned by effective_from/to, never overwritten | `fee_rules` | driver-wallet (fee service) | ✗ | Historical rule lookup test; D-15 |
| PW-7 | Every wallet mutation runs in a transaction with `SELECT … FOR UPDATE` and a conditional UPDATE | – | driver-wallet | ✗ | Tests #3, #4, #10 |
| PW-8 | Lock order: booking → wallet → payment/collection/ledger | – | all finance | ✗ | Deadlock stress test |
| PW-9 | Never hold DB locks while calling Razorpay, FCM or other HTTP APIs | – | payments | ✗ | Test with a slow provider mock |
| PW-10 | Top-up: backend creates order, driver pays by UPI, webhook arrives, backend verifies signature and amount, credits wallet with a TOPUP ledger entry, marks payment PAID | `payments`, `payment_events`, wallet tables | `POST /v1/wallet/topups` | ✗ | Tests #1, #5, #6, #7 |
| PW-11 | Cash collection in one transaction: lock booking, lock wallet, insert collection idempotently, compute fee on the server, debit, write CASH_RIDE_FEE ledger entry, mark booking PAID | `bookings`, `payment_collections`, wallet tables | `POST /v1/trips/:id/collections` | ✗ | Tests #2, #3, #4; D-15, D-16, D-17 |
| PW-12 | QR collection uses a provider-supported, booking-linked payment object plus webhook; no personal UPI | `payment_collections` | payment-collections | ✗ | D-24 |
| PW-13 | Refunds and reversals are compensating entries; the ledger is never edited | `payments`, ledger | payments | ✗ | Double-refund test; D-22 |
| PW-14 | Admin adjustment needs the admin role, a reason and a ledger entry; there is no set-balance endpoint | ledger, `admin_actions` | admin | ✗ | Non-admin gets 403; reason required |
| PW-15 | A DB trigger blocks ledger UPDATE and DELETE | trigger | migrations | ✗ | Test #9 |
| PW-16 | Reconciliation queries: balance vs ledger, unprocessed webhooks, pending payments | queries | admin / jobs | ✗ | Balance-vs-ledger returns 0 rows after the test suite |
| PW-17 | Mandatory race and idempotency matrix (11 cases) | – | – | ✗ | Tests #1–#10 plus blocked-wallet debit |
| PW-18 | Prisma `$transaction`, raw SQL only for `FOR UPDATE`, parameterized queries only | – | prisma | ✗ | Lint rule banning `$queryRawUnsafe` |

### 2.8 Master-prompt baseline (no PDF source; doesn't conflict with the PDFs)

All of these are ✗ in the prototype:

- **Auth and access:** OTP auth with send/verify rate limits; RBAC plus object-level authorization.
- **Request hardening:** strict DTO validation with whitelisting; rate limits; request-size and pagination limits; safe error responses; explicit CORS; security headers.
- **Operations:** structured, redacted logs with correlation IDs; health and readiness checks for DB and Redis; typed config; OpenAPI.
- **Account and files:** account-deletion lifecycle; short-lived S3 signed URLs; audit log.

## 3. Findings

### 3.1 Conflicts between sources

Each resolution needs sign-off; see OPEN_DECISIONS.md.

| # | Conflict | Sources | Decision |
|---|---|---|---|
| 1 | MP lists booking states SEARCHING_DRIVER → DRIVER_OFFERED → DRIVER_ASSIGNED → DRIVER_ARRIVING → DRIVER_ARRIVED → TRIP_STARTED → TRIP_COMPLETED. No PDF defines these, and M5 says the booking must not become the trip state machine. | MP §22, M5, M6 | D-01 |
| 2 | The M6 trip lifecycle starts at CREATED/SEARCHING_DRIVER, but `trips.driver_id` and `vehicle_id` are NOT NULL | M6 p4, p7 | D-02 |
| 3 | Multi-drop needs a repeating drop cycle, but the M6 lifecycle is linear with no back-edge | M6 p7 | D-03 |
| 4 | The pickup stop is shown as COMPLETED, but the stop enum has no COMPLETED value | M6 p5, p7 | D-04 |
| 5 | Driver states: MP has OFFLINE/AVAILABLE/OFFERED/ASSIGNED/ON_TRIP/SUSPENDED. M3 has availability OFFLINE/AVAILABLE/OFFERED/BUSY/etc., with SUSPENDED/BLOCKED under approval. | MP §22, M3 | D-05 |
| 6 | Payment method: M5 has COD/CASH/UPI; PW and MP have PREPAID_UPI/PAY_AT_PICKUP/PAY_AT_DELIVERY | M5, PW, MP | D-06 |
| 7 | PW queries read `bookings.driver_id`, `payment_due_stage` and `fare_paise`. M5 forbids a driver on the booking and names the fares `fare_estimate_minor`/`final_fare_minor`. | PW §5, M5 | D-07 |
| 8 | Wallet table names: `wallets`/`wallet_transactions` vs `driver_wallets`/`driver_wallet_transactions` | M1, PW, MP | D-08 |
| 9 | `customer_profiles` vs `customers` | M1, M5 | D-09 |
| 10 | QR prose says the booking reaches PAID_ONLINE; the SQL sets `payment_status = 'PAID'` | PW §6 | D-10 |
| 11 | Insurance is in M1, M5 and the customer app but absent from MP's scope | M1, M5, MP | D-11 |

### 3.2 Defects in the reference SQL (PW) that the implementation will correct

None of these change a business rule.

1. **Balance updated before ledger write.** §4.3, §5.2 and §7.2 run `UPDATE driver_wallets` before `INSERT … ON CONFLICT (idempotency_key) DO NOTHING`. On a replay, the balance changes but no ledger row is written. The result is a double credit or debit and a reconciliation mismatch. Fix: check the idempotency key and provider IDs first inside the locked transaction, and roll back on any ledger conflict.
2. **Top-up payment row not locked.** §4.3 locks the wallet but marks the payment PAID with a conditional UPDATE at the end. Fix: lock the payment row (`FOR UPDATE`), verify it's PENDING and the amount matches the server-created order, then credit.
3. **Duplicate collection still debits.** In §5.2 the wallet debit runs even when the collection insert hits a conflict. Fix: return the existing collection and skip every financial step.
4. **Missing foreign keys.** `payments.booking_id`/`user_id`, `payment_collections.booking_id`/`collected_by_driver_id` and `driver_wallets.driver_id` have no REFERENCES. They'll be added, plus `CHECK (purpose <> 'BOOKING' OR booking_id IS NOT NULL)`.
5. **Ledger status can't change.** `transaction_status` defaults to POSTED and the immutability trigger forbids UPDATE, so a ledger row can never change status. Only final POSTED rows will be inserted.
6. **Undeclared enum types.** `wallet_status`, `wallet_entry_type`, `ledger_direction`, `transaction_status` and `payment_status` are used but never declared. Values will come from the PDFs plus D-10.

### 3.3 Prototype gaps

The prototype proves the multi-drop UX: stops in strict order, per-stop OTP, photo before delivered, and rejection of skipped stops. That logic will be ported.

It doesn't meet these production requirements:

- **Storage:** no persistence; everything is in memory.
- **Identity:** no auth. Identity comes from `driverId`/`customerId` in the request body, and a driver is auto-created for any ID.
- **OTPs:** `GET /rides/:id` returns the pickup and stop OTPs. They're 4-digit `Math.random()` values with no attempt limit.
- **Money:** fares can be supplied by the client and are stored as float rupees.
- **Exposure:** driver coordinates are public, CORS is open, and request bodies aren't validated.

## 4. App contract observations

Read from the `origin/Customer` and `origin/Driver` branches; not run.

- Both apps call the prototype at `pickup-backend-engine-v2.onrender.com`.
- **Customer app** (`src/api/engine.ts`) uses:
  - `GET /fare/estimate`, `GET /drivers/nearby`, `GET /drivers/:id`
  - `POST /rides`, `GET /rides/:id`, `POST /rides/:id/cancel`, `GET /rides/:id/trip`
  - `GET /trips/:id`, `GET /trips/active/customer/:id`, `POST /trips/:id/cancel`, `GET /trips/history/customer/:id`

  Its `WIRING_MAP.md` says most flows are still mock, with no real payment or OTP verification. The app has no wallet feature.
- **Driver app** uses:
  - the same engine endpoints
  - `PATCH /drivers/:id/availability` and `PATCH /drivers/:id/location`
  - `GET /ride-requests/:driverId`, `POST /rides/:id/accept`, `POST /rides/:id/reject`, `POST /trips/:id/<action>`
  - `GET /trips/active/driver/:id`, `GET /trips/history/driver/:id`

  It also has client code for endpoints that don't exist yet: `/auth/*` (OTP and email/password), `/kyc/documents`, `/wallet/balance`, `/wallet/transactions`, `/earnings/*`, `/chat/:tripId/*`, `/subscription/*`.
- **Auth:** the driver app signs in with Firebase Phone Auth (`@react-native-firebase/auth`). The driver IDs it sends to the prototype are Firebase UIDs. The customer app has no Firebase. See D-27.
- **Compatibility:** the new API (`/v1/bookings`, authenticated, server-owned states) won't be wire-compatible with these endpoints. Both apps need a migration; see D-38.

### 4.1 Security observations in the app branches

- **OTP brute-force scripts:** `origin/Driver` contains `find-otp.js`, `force.js` and `force2.js`, which brute-force 4-digit stop OTPs against the live Render deployment. This confirms the prototype's OTP weakness is exploitable today.
- **Committed Maps key:** `origin/Customer` `.env.example` commits a Google Maps API key (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`). `EXPO_PUBLIC_*` values ship inside the app bundle anyway. The key should be restricted by app signature and API in Google Cloud, and rotated because it's in git history.

## 5. Implementation status: payments + driver wallet slice

Branch `raj_backend`, 3 Oct 2026. Test files are in `test/integration/` unless a `src/…spec.ts` path is given.

### 5.1 PW requirements

| ID | Status | Implementation | Tests |
|---|---|---|---|
| PW-1 | Done | `driver_wallets` (migration); `WalletService.ensureWalletForDriver` | wallet-ledger (negative balance refused); auth (wallet created on first access) |
| PW-2 | Done, plus a gap-free per-wallet `wallet_version` (UNIQUE) | `driver_wallet_transactions`; `WalletLedgerService.postEntry` | wallet-ledger (#9, version clash, idempotent replay) |
| PW-3 | Done for top-ups | `payments`; `TopUpService` | top-ups; webhooks (#7) |
| PW-4 | Done. Only signature-verified events are stored (CHECK), so forgeries can't reserve an event id. | `payment_events`; `RazorpayWebhookService` | webhooks (#1, #5, forged event id) |
| PW-5 | Not built: cash and QR collection need bookings and trips | – | #2 is `it.todo` in webhooks |
| PW-6 | Not built: fee formula undecided (D-15) | – | – |
| PW-7 | Done | `FOR UPDATE` + version-guarded UPDATE in `WalletLedgerService` | wallet-ledger (#3, #4, 20 concurrent debits); webhooks (#10) |
| PW-8 | Done for the tables in this slice | `TopUpFinalizerService` locks the wallet, then the payment | webhooks (#10, concurrent duplicates) |
| PW-9 | Done | Razorpay calls happen outside transactions (`TopUpService`, `PaymentConfirmationService`) | top-ups (provider outage, lost order response) |
| PW-10 | Done | `TopUpService` → `PaymentConfirmationService` → `TopUpFinalizerService`; webhook and admin sync share the same path | top-ups; webhooks; admin (sync) |
| PW-11 | Not built (see PW-5) | – | – |
| PW-12 | Not built (D-24) | – | – |
| PW-13 | Schema only: `REFUND_REVERSAL` entry type and `REFUND_PENDING`/`REFUNDED` statuses. No refund API (D-22). | – | – |
| PW-14 | Done. The database also enforces admin and reason (CHECK). There is no set-balance endpoint. | `WalletAdjustmentService`, `POST /v1/admin/wallets/:id/adjustments` | admin; wallet-ledger (CHECK) |
| PW-15 | Done, and TRUNCATE is blocked too | Triggers in the migration | wallet-ledger (#9) |
| PW-16 | Done, and the version chain is also checked | `ReconciliationService`, `/v1/admin/reconciliation/*` | wallet-ledger (tampered balance); admin |
| PW-17 | Done except cash collection (5.2) | – | – |
| PW-18 | Done | `PrismaService.runInTransaction` (READ COMMITTED, `lock_timeout`); ESLint bans `$queryRawUnsafe`/`$executeRawUnsafe` | all integration suites |

The six reference-SQL defects in §3.2 are corrected:

- **Ledger ordering:** the idempotency check runs after the wallet lock, and the ledger insert has no `ON CONFLICT`, so any duplicate rolls back the whole transaction.
- **Payment checks:** the payment row is locked and its amount checked before crediting.
- **Foreign keys:** they exist wherever the referenced table is part of this slice. `payments.booking_id` gets its FK with the bookings module.
- **Ledger status:** only final POSTED rows are written.
- **Enums:** all are declared in the migration.

### 5.2 Master prompt §18 financial tests

| # | Test | Where | Result |
|---|---|---|---|
| 1 | Same webhook 20 times, one effect | webhooks: sequential and concurrent | Pass |
| 2 | Same cash collection repeated, one effect | webhooks: `it.todo`. The ledger-level replay is covered in wallet-ledger. | Pending: cash collection not built |
| 3 | Simultaneous debits serialize | wallet-ledger: two ₹70 debits from ₹100; 20 concurrent debits | Pass |
| 4 | Insufficient balance rejected | wallet-ledger | Pass |
| 5 | Invalid webhook signature rejected | webhooks: bad, tampered and empty signatures | Pass |
| 6 | Amount mismatch, no credit | top-ups (verify); webhooks (signed webhook) | Pass |
| 7 | Same payment id twice, deduplicated | webhooks: captured + order.paid, verify + webhook; wallet-ledger: database unique index | Pass |
| 8 | Failure mid-transaction, full rollback | wallet-ledger: thrown error; database session killed before commit | Pass |
| 9 | Ledger UPDATE/DELETE rejected | wallet-ledger (trigger); least-privilege (API role has no UPDATE/DELETE) | Pass |
| 10 | Concurrent top-up + fee serialize | webhooks: 5 rounds | Pass |

Last full run: 75 unit tests, plus 108 integration tests and 1 todo, all passing against PostgreSQL 17. Lint, typecheck and build are clean, and `npm audit` reports 0 vulnerabilities.

### 5.3 Security baseline (§2.8) in this slice

- **Done:**
  - Firebase ID token verification (RS256 only; issuer, audience, expiry and issue time checked)
  - roles from our database with a fail-closed guard, plus ownership checks on every query
  - whitelist validation
  - per-user rate limits and a 100 KB body limit
  - safe error bodies with request ids, security headers, an explicit CORS allowlist
  - redacted structured logs, a least-privilege database role, health checks
- **Not in this slice:**
  - account deletion, S3/KYC, Redis
  - an `admin_actions` table: adjustments are audited on the ledger row itself (admin id and reason)

## 6. Implementation status: bookings, collections, earnings and payouts

Branch `raj_backend`, implementing the approved V1 money rules (OPEN_DECISIONS section F). Migration `20261006120000_bookings_collections_earnings_payouts`.

### 6.1 Requirements

| ID | Status | Implementation | Tests |
|---|---|---|---|
| PW-5 | Done. Extensions: `trip_id`, provider product/reference/link, fee and ledger link for cash, one live collection per booking (partial UNIQUE). | `payment_collections`; `CollectionsService` | collections |
| PW-6 | Done. Versioned by trigger (only closing fields change, once); no DELETE/TRUNCATE; rounding mode stored per rule; bookings pin their rule. | `fee_rules`; `createFeeRuleRecord`, `FeeRulesService`; `fee-calculator.ts` | fee-rules; `fee-calculator.spec.ts` |
| PW-8 | Done for every money path: booking → trip → wallet → payment / collection / earning → payout rows | `booking-locks.ts` and each finalizer | collections (#9, #10) |
| PW-11 | Done. One transaction: lock booking and trip, replay check, server-side fee from the pinned rule, CASH_RIDE_FEE debit (key `cash-ride-fee:<booking>`, never negative), collection, booking PAID, trip PAYMENT_CONFIRMED if delivered. | `CollectionsService.recordCash` | collections (#6–#10) |
| PW-12 | Done behind `CollectionLinkGateway`: Razorpay Payment Links or QR Codes, created by the server for the confirmed fare, completed only from Razorpay's own state (webhook hint, then an API read). | `RazorpayCollectionHttpGateway`, `CollectionFinalizerService` | collections; `razorpay-collection-http.gateway.spec.ts` |
| PW-3 (bookings) | Done: purpose BOOKING, FK to bookings, one live payment per booking (partial UNIQUE). | `BookingPaymentService`, `BookingPaymentFinalizerService` | booking-payments |
| M5-3, M5-12 | Done for the payment subset: integer paise, fare fixed at confirmation (CHECK + trigger). | `bookings` | trips-earnings |
| M6-5, M6-8, M6-9 | Done: strict lifecycle (service + trigger), PAYMENT_CONFIRMED owned by this backend, completion needs it and creates the earning atomically. Driver availability stays with the engine. | `BookingsService`, `guard_trip_change()` | trips-earnings |
| M6-12 | Done: the engine can't set PAYMENT_CONFIRMED; drivers only read their own trips. | internal API, `DriverTripsController` | trips-earnings |
| Earnings | Done: one per booking (UNIQUE), ONLINE → PAYABLE, CASH → SETTLED_IN_CASH; amounts immutable; status transitions and payout-item consistency enforced by trigger. | `driver_earnings`; `EarningsService` | trips-earnings (#11) |
| Payouts | Done: batches, per-driver payouts, items, events; provider id = our payout id as X-Payout-Idempotency; forward-only status; failed → earnings PAYABLE; processed → PAID; reversed → ON_HOLD; payout = sum of items (deferred constraint trigger). | `PayoutBatchesService`, `PayoutExecutionService`, `PayoutStatusService`, `RazorpayXHttpGateway` | payouts (#12–#18) |
| Disputes | Done: `payment.dispute.*` recorded; the earning is held; never auto-released. | `DisputesService`, `payment_disputes` | trips-earnings |
| Admin audit (M1 `admin_actions`) | Done for fee rules, earning holds, bank accounts and payout batches. Append-only by trigger. | `recordAdminAction` | trips-earnings, fee-rules |

Deviations, all documented in the schema comments: `bookings` and `trips` are payment-scoped subsets (no goods, stops, vehicle or current stop: the engine owns them, D-51), `customers` is minimal (D-09), and vehicle categories are codes rather than a table.

### 6.2 Required V1 financial tests

| # | Test | Where |
|---|---|---|
| 1 | Online payment success | booking-payments: "#1 online payment success" |
| 2 | Failed payment | booking-payments: "#2 a failed payment…" |
| 3 | Duplicate webhook | booking-payments "#3"; webhooks "#1" (top-ups); payouts "#16" |
| 4 | Same payment id twice | booking-payments "#4"; collections (payment_link.paid + payment.captured) |
| 5 | Amount mismatch | booking-payments "#5"; collections (short QR payment) |
| 6 | Cash collection recorded twice | collections "#6" (same key, concurrent, different keys) |
| 7 | Cash fee wallet debit | collections "#7" |
| 8 | Insufficient wallet | collections "#8" |
| 9 | Concurrent wallet debits | collections "#9"; wallet-ledger "#3" |
| 10 | Concurrent top-up + fee debit | collections "#10"; webhooks "#10" |
| 11 | Earning created exactly once | trips-earnings "#11" (10 concurrent completions, UNIQUE) |
| 12 | Same earning not in two batches | payouts "#12" (concurrent prepares, partial UNIQUE) |
| 13 | Same payout not created twice | payouts "#13" (same key, concurrent execution, lost response) |
| 14 | Failed payout doesn't mark paid | payouts "#14" (provider failure, definitive rejection, disabled bank account) |
| 15 | Successful payout marks paid exactly once | payouts "#15" |
| 16 | Repeated payout webhook, no duplicate | payouts "#16" (repeated, concurrent, stale state) |
| 17 | DB rollback during a payout transaction | payouts "#17" (prepare and status application both fail before COMMIT) |
| 18 | Full reconciliation booking → payment → earning → payout | payouts "#18" (admin booking-chain view and every report) |

Last full run, 2 Oct 2026: 140 unit tests and 191 integration tests passing against PostgreSQL 17, including the least-privilege suite running every new flow with the production grants. Lint and typecheck are clean.

## 7. Implementation status: second set of approved decisions (6 Oct 2026)

OPEN_DECISIONS section G. Migrations `20261007120000_earning_awaiting_settlement` and `20261007120100_settlements_bank_validation_tds`.

### 7.1 Requirements

| Decision | Status | Implementation | Tests |
|---|---|---|---|
| HALF_UP rounding, one utility, no floating point (D-44) | Done. ₹123.45 × 10% = ₹12.35. Other modes refused by DTO, CLI, service and CHECK. | `src/common/money.ts`; `fee-calculator.ts` | `money.spec.ts`, `fee-calculator.spec.ts`; fee-rules ("fees always round HALF_UP") |
| Payable only after merchant settlement (D-45) | Done. `AWAITING_SETTLEMENT` → `PAYABLE` only through a recorded `payment_settlements` row; CHECKs and trigger refuse anything else; releases and payout failures never make unsettled money payable. | `MerchantSettlementsService`, `RazorpaySettlementHttpGateway` (recon combined), `EarningsService.applySettlement`, `SettlementSyncSchedulerService`; `settlement.processed` webhook | trips-earnings (payable only once settled, amount mismatch, webhook pull); payouts ("never pays out an earning whose customer payment is not settled yet"); collections (QR); booking-payments; `razorpay-settlement-http.gateway.spec.ts` |
| Monday 11:00 IST, configurable (D-48) | Done. Defaults in config; pre-batch settlement pull; one batch per ISO week; `Clock` injected for tests. | `PayoutSchedulerService`, `payout-schedule.ts`, `GET /v1/admin/payout-schedule`, `POST /v1/admin/payout-schedule/run` | payouts ("weekly scheduler: every Monday 11:00 IST"); `payout-schedule.spec.ts`; `app-config.spec.ts` |
| Batch excludes unsettled, held, paid or already batched earnings | Done. | `PayoutBatchesService` eligibility query; `payout_items` partial unique index | payouts #12, scheduler test |
| Bank validation + admin approval (D-49) | Done against the documented RazorpayX API (availability: D-58). Approval needs a completed ACTIVE validation; non-MATCH needs a written resolution; enforced by trigger too. | `BankAccountsService`, `name-match.ts`, `bank_account_verifications`, `fund_account.validation.*` webhooks | payouts ("bank accounts" suite); `name-match.spec.ts`; `razorpayx-http.gateway.spec.ts` |
| Account change (assumption B) | Done: the old account is suspended at once; the new one needs validation and approval. Since section 8 behind a step-up. | `BankAccountChangesService.confirm` | payouts ("a new bank account suspends the old one…") |
| Reversed payout (assumption C) | Done: earnings ON_HOLD, account SUSPENDED, reinstatement needs a new validation; no automatic retry. | `PayoutStatusService.reverse` | payouts ("a reversed payout holds its earnings and suspends the account…") |
| TDS-ready, policy DISABLED (D-57) | Done: deduction fields on earnings and payouts with CHECKs; versioned empty `tax_rules`, read-only for the API; `TDS_ENABLED=true` refused; client-sent amounts rejected. | `src/common/deductions.ts`; schema | `deductions.spec.ts`; trips-earnings ("refuses client-sent fees, TDS or net amounts"); least-privilege |
| Separate records | Done: payment, settlement, earning (payable), payout, wallet. | schema | least-privilege, payouts #18 |
| API-level end-to-end proof | Done: ₹500 example, 11 steps and 8 idempotency checks, real Razorpay test order, simulated settlement and RazorpayX. | `test/e2e/run-local-e2e.mjs` (`npm run e2e:local`) | passed 6 Oct 2026 |

Simulated providers (`SETTLEMENT_PROVIDER=simulated`, `PAYOUT_PROVIDER=simulated`, `/v1/dev/simulate/*`) exist only for local end-to-end runs; config validation refuses them in production and with live keys.

Last full run, 6 Oct 2026: 186 unit tests and 211 integration tests passing against PostgreSQL 17, plus the end-to-end run. Lint, typecheck and build are clean.

## 8. Implementation status: third set of approved decisions

OPEN_DECISIONS section H. Migration `20261008120000_bank_account_change_requests`.

| Decision | Status | Implementation | Tests |
|---|---|---|---|
| Step-up OTP before any payout-destination change (D-61) | Done: change request → Firebase phone re-authentication (`auth_time` after the request, registered `phone_number`, `sign_in_provider=phone`) → confirm. Also for the first account. Enforced by triggers, CHECKs and grants. | `BankAccountChangesService`, `src/auth/step-up.ts`, `Principal.session`, `bank_account_change_requests`, `driver_bank_accounts.change_request_id` | `step-up.spec.ts`, `token-verifier.service.spec.ts`; payouts ("bank account changes need a step-up re-authentication": stolen session, same-second sign-in, other phone, non-phone sign-in, expired, cancelled, used, foreign, concurrent confirmations, superseded, database refusals); least-privilege (flow with production grants, 6 new refusals); e2e step 0 |
| Old account suspended on acceptance; new one not payout-eligible until validation and approval | Done: suspension and insert in the confirming transaction; nothing changes on the request alone. | `BankAccountChangesService.confirm` | payouts ("a new bank account suspends the old one…", "refuses the existing session…") |
| RazorpayX capabilities not assumed (D-46, D-58) | Done: `RAZORPAYX_CAPABILITIES_CONFIRMED` gate (production, live keys); provider-abstracted `PayoutGateway`. | `env.schema.ts`, `openReadinessItems` startup log | `app-config.spec.ts` ("production-readiness gates") |
| Settlement recon open item (D-56) | Done: `SETTLEMENT_RECON_VERIFIED` gate. | `env.schema.ts` | `app-config.spec.ts` |
| Non-exact name match always resolved and audited (D-60) | Done: reordered words are PARTIAL; `BANK_NAME_MISMATCH_RESOLVED` audit row with both names, result and resolution. | `name-match.ts`, `BankAccountsService.approve` | `name-match.spec.ts`; payouts ("validates with the bank…") |
| No manual settlement (D-62) | Unchanged. | — | trips-earnings, payouts |
| Return to an earlier bank account | Done: fund-account uniqueness on live accounts only; simulated and fake gateways return the same contact and fund account for identical details, like RazorpayX. | migration, `SimulatedPayoutGateway` | payouts ("lets a driver switch back…") |

Last full run: 203 unit tests and 227 integration tests passing against PostgreSQL 17, plus the end-to-end run (12 steps, 9 idempotency checks). Lint, typecheck and build are clean.

## 9. Implementation status: payment flow Phase 1

[PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md) Phase 1 and OPEN_DECISIONS section I. Migration `20261015120000_booking_quote_snapshot`.

| Requirement | Status | Implementation | Tests |
|---|---|---|---|
| New bookings are frozen copies of a redeemed quote, with one stop per drop | Done | `BookingsService.register` / `createFromQuote`, `FareQuoteRedeemer`; triggers `guard_booking_insert`, `guard_booking_stop_insert`, deferred `check_booking_snapshot` | booking-registration ("freezes the quote…", "rounds a percentage fee half up…", database guards with a positive control); trips-earnings; least-privilege (production grants) |
| The frozen fee is split across the drops and always adds up | Done | `src/bookings/fee-allocation.ts` (largest remainder); deferred database check of each share | `fee-allocation.spec.ts`; booking-registration |
| Registration takes no amount, is idempotent on `externalRef` and safe under races | Done | `RegisterBookingRequest` (v2), `replayRegistration`, unique indexes on the ref and the quote | booking-registration (validation, replay and conflicts, three race tests); e2e step 1a |
| No new PREPAID_UPI booking (API and database) | Done | `422 PAYMENT_METHOD_NOT_OFFERED`; `guard_booking_insert`; CHECK `bookings_quote_bookings_not_prepaid` | booking-registration; e2e step 1a |
| Checkout only for historical PREPAID_UPI bookings, verification unchanged (N4) | Done | `assertLegacyPrepaid` (start, verify); `isHistoricalPrepaid` before capture and in the finalizer; trigger `trg_payments_booking_insert_guard` | legacy-bookings; `src/payments/legacy-prepaid-only.spec.ts`; booking-payments; e2e steps 1–11 |
| Existing bookings keep their model and values (N3) | Done | `payment_model` backfilled to `LEGACY_BOOKING_LEVEL` only; legacy fee from the pinned rule (`feeFor`, cash collection, earnings) | legacy-bookings; `test/migration/check-legacy-migration.mjs` on the test-data, dev and e2e databases |
| Snapshot and stops immutable, even for the table owner | Done | `guard_booking_update`, `guard_booking_stop_update`, no delete or truncate, no UPDATE grant on `booking_stops` | booking-registration; least-privilege (snapshot, stop and trigger-disable refusals) |
| Maximum drops is configuration (N7) | Done | `FARE_MAX_DROPS` (default 5), `422 TOO_MANY_DROPS`, database ceiling 25 | fare ("validates the route itself"); booking-registration (25 drops, a 26th refused) |
| Development pricing refused in production by the admin API too (L-1) | Done | `createPricingVersionRecord` `production` input | fare ("refuses a PROTOTYPE…") |
| Tax refused until a rule is approved (L-2) | Done | `422 TAX_NOT_SUPPORTED`; CHECKs on bookings and stops | booking-registration |
| Delivery collection of new bookings refused until per-drop collection (temporary) | Done | `assertCollectable`, `isCollectionOpen`, trigger `guard_collection_insert` | booking-registration |
| Migration safety and rollback (N1) | Done | `prisma/sql/preflight-payment-flow.sql`, `npm run db:migration-check`, `down.sql` (refuses once a new booking exists) | migration check: rows unchanged, all LEGACY, schema equal to a fresh install, up / down / up |

Last full run: 290 unit tests and 323 integration tests passing against PostgreSQL 17, plus the end-to-end run (steps 0, 1a and 1–11) and the migration check on three databases. Lint, typecheck, build and the schema drift check are clean.

## 10. Implementation status: payment flow Phase 2

[PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md) Phase 2 (the stop and collection parts of C.3, plus C.1, C.7 and C.8) and OPEN_DECISIONS section I. Migration `20261016120000_per_stop_obligation_schema`. Schema only: the stop transitions are Phase 3 and per-drop collection is Phase 4.

| Requirement | Status | Implementation | Tests |
|---|---|---|---|
| Each stop status carries its facts; a PENDING stop carries none | Done (schema) | 9 columns on `booking_stops`; CHECKs `booking_stops_pending_is_untouched`, `_status_facts`, `_facts_follow_arrival`, `_failure_complete`, `_resolution_complete`, `_reasons_not_blank`; FK to the resolving admin | stop-obligation-schema ("start PENDING…", "records every status with its facts", 11 refusals) |
| At most one current stop per booking | Done | partial unique `uq_booking_stops_current` (ARRIVED, PAYMENT_CONFIRMED) | stop-obligation-schema ("allows at most one current stop…") |
| Stops still can't change before Phase 3 | Done (unchanged) | `guard_booking_stop_update`; no UPDATE grant on `booking_stops` | stop-obligation-schema; least-privilege ("record a stop arrival", "resolve a failed stop") |
| A collection names only a drop of its own booking; a pickup collection names none | Done | `booking_stop_id`, composite FK `payment_collections_booking_id_booking_stop_id_fkey`, CHECK `collections_pickup_has_no_stop` | stop-obligation-schema ("keeps the shape even with the insert guard off…") |
| One live collection per booking-level obligation and one per drop | Done | `uq_collection_booking_level_active` (built before `uq_collection_booking_active` is dropped), `uq_collection_stop_active` | stop-obligation-schema ("…exactly as before", "…once per-drop collection exists") |
| A booking's collections are all of one kind; per-drop collection still refused | Done | `guard_collection_insert` | stop-obligation-schema ("only a drop of a pay-at-delivery booking…"); booking-registration |
| The drop a collection is for never changes | Done | `guard_collection_update`; not an API-updatable column | stop-obligation-schema ("never changes the drop…"); least-privilege ("link a collection to a drop") |
| Existing rows unchanged, no stops invented, every existing booking LEGACY (N3) | Done | additive migration; every new constraint validated against the existing rows | migration check on four databases (row fingerprints over every table); legacy-migration ("changes no stored value…") |
| In-flight historical bookings still finish (C.8) | Done | — | legacy-migration: a `TAB-QR-001`-style QR refreshed, paid and completed; cash with the pinned fee; a Checkout order from before the upgrade; a pickup collection; an expired QR in reconciliation; new bookings priced per drop |
| Preflight and rollback (N1, C.1, C.7) | Done | preflight sections for bookings by model, live collections per booking, and stops and per-drop collections (they run at any schema level); `down.sql` refuses once a collection names a drop or a stop has lifecycle data, and restores the Phase 1 guards and the old index exactly | migration check: up / down / down / up, both refusals, schema equal to a fresh install at each level |
| Least-privilege grants unchanged | Done | no grant change | least-privilege (3 new refusals; every flow with the production grants) |

Last full run: 290 unit tests and 352 integration tests passing against PostgreSQL 17, plus the end-to-end run (13 steps, 10 idempotency checks) and the migration check (fresh install, each migration level, and four databases with data). Lint, typecheck, build and the schema drift check are clean.

## 11. Implementation status: payment flow Phase 3

[PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md) Phase 3 (the gate and stop parts of contract D, state machine E, conflict M.1) and OPEN_DECISIONS section I ("Phase 3: payment gate and stop lifecycle"). Migration `20261017120000_payment_gate_stop_lifecycle`: rules and one grant only, no new column, no row touched. Per-drop collection is still Phase 4, so nothing in Phase 3 confirms a drop's payment.

| Requirement | Status | Implementation | Tests |
|---|---|---|---|
| PAY_AT_PICKUP is paid before the pickup handover, for every booking model (N2) | Done. Unpaid at DRIVER_ARRIVED: `409 PAYMENT_REQUIRED { stage: PICKUP, amountPaise }` for PICKUP_VERIFIED or later. A booking priced per drop can't start (IN_TRANSIT) unpaid either. A historical trip already past the pickup unpaid carries on. | `checkTripRequest` (`trip-lifecycle.ts`), `BookingsService.updateTripStatus`; `guard_trip_change` | `trip-lifecycle.spec.ts`; pickup-payment ("while unpaid" with the owner-role SQL, "once paid" with cash and with a QR that expires and is replaced, "historical bookings", "other payment methods"); least-privilege; e2e step 1a |
| paymentGate derived on every read, never stored (review E) | Done. Engine view on every internal booking response; driver view on `/v1/trips`, with which drops are paid; customer view, without ids or the fee, on `/v1/bookings/:id` and `/v1/bookings/:id/payment`. | `payment-gate.ts` (`derivePaymentGate`, `toCustomerPaymentGate`, `customerStopState`), `BookingsService.paymentContext(s)`, `bookings.mapper.ts` | `payment-gate.spec.ts`; pickup-payment; delivery-stops ("views") |
| Stop state machine: drops in order, one current drop | Done. ARRIVED (also the retry of a failed attempt), DELIVERED, or DELIVERY_FAILED with a reason, only while the trip is under way. Repeats are no-ops. Each fact is written only with its own transition, and any other change is refused. | `stop-lifecycle.ts` (`decideEngineStopRequest`, `focusStop`), `BookingStopsService.report`, `POST /v1/internal/trips/:tripId/stops/:sequence/status`, locks booking → trip → stops; `guard_booking_stop_update`, `uq_booking_stops_current` | `stop-lifecycle.spec.ts`; delivery-stops ("order and the current drop"; "concurrency": 8 duplicate arrivals, drop 2 racing drop 1's failure) |
| PAY_AT_DELIVERY: an unpaid drop is never handed over | Done. DELIVERED needs the drop to be PAYMENT_CONFIRMED, which the database allows only with a COMPLETED collection for that drop. Otherwise `409 PAYMENT_REQUIRED { stage: DROP, stopSequence, amountPaise }`. | `decideEngineStopRequest`; `guard_booking_stop_update`; no API grant on `payment_confirmed_at` | delivery-stops ("pay at delivery: paid before the handover": API, owner-role SQL, drop 2's payment offered for drop 1); least-privilege ("confirm a drop payment") |
| Trip DROP_PROGRESS and DELIVERED for bookings priced per drop | Done. The backend sets them when the first drop is reached and when every drop is finished (then PAYMENT_CONFIRMED straight away if the booking is paid). Engine reports get `409 STOP_REQUIRED` and `409 STOPS_PENDING { pendingStops }` (a no-op once reached). | `tripAdvanceAfterStops`, `checkTripRequest`, `BookingStopsService`; `guard_trip_change` | `trip-lifecycle.spec.ts`, `stop-lifecycle.spec.ts`; delivery-stops ("hands over a paid drop, and the last finished drop delivers the trip") |
| Admin stop resolution, audited | Done. RETRY or UNDELIVERED for a failed drop, with a reason of 3–200 characters, recorded in `admin_actions` (BOOKING_STOP_RETRY, BOOKING_STOP_UNDELIVERED) in the same transaction. A repeat changes nothing and writes no second record. | `decideStopResolution`, `BookingStopsService.resolve`, `POST /v1/admin/bookings/:bookingId/stops/:sequence/resolve` (admins only); the stop guard requires an active ADMIN; deferred `trg_booking_stops_resolution_audit` requires the record from the same transaction | `stop-lifecycle.spec.ts`; delivery-stops ("failed attempts": API refusals, both database checks with a positive control; "concurrency": five resolutions at once, one record) |
| Cancellation | Done. Unfinished drops are cancelled with the booking; delivered and undelivered drops keep their outcome; nothing moves afterwards. | `BookingsService.cancel`; stop guard | delivery-stops ("cancellation", cancellation racing an arrival) |
| Authorization | Done. Only the engine key reports trip and drop statuses, and it can't report PAYMENT_CONFIRMED. Only admins resolve a failed drop. Drivers and customers only read their own trip or booking. | internal API key guard, `DriverTripsController`, `CustomerBookingsController`, `AdminOnly` | pickup-payment ("authorization"); delivery-stops (a driver can't resolve) |
| Historical bookings keep their behaviour (N3) | Done. Apart from N2: no stops, the engine-reported trip order and the whole-booking collection after delivery. Historical PREPAID_UPI handovers stay ungated. | legacy branches of `checkTripRequest` and `derivePaymentGate` | pickup-payment, delivery-stops ("historical bookings"); legacy-bookings; legacy-migration; migration check |
| Least privilege | Done. UPDATE on the stop lifecycle columns only. Amounts, fee shares, `booking_id`, references and `payment_confirmed_at` stay ungranted. The guards apply to the API role exactly as to the owner, and it can't disable them. | `prisma/sql/02-app-grants.sql` | least-privilege ("moves drops and trips only through their lifecycle" with 7 refusals; 3 new permission refusals; 2 new trigger-disable refusals; every flow with the production grants) |
| Migration safety and rollback (N1) | Done. Three new preflight sections: trips held by the pickup gate, bookings priced per drop past the pickup, stops by status. `down.sql` drops no data, restores the previous guards exactly and drops the audit check; the operator also revokes the stop grant. | `prisma/sql/preflight-payment-flow.sql`, `down.sql`, `npm run db:migration-check` | migration check: up, then the down.sql of each migration it applied (newest first), then up again; every row unchanged; schema equal to a fresh install at each level; a drop reached with every guard on |

Review acceptance criteria (§34) assigned to Phase 3:

| # | Criterion | Phase 3 result |
|---|---|---|
| 3 | Pay after arrival, before handover and start | Done for PAY_AT_PICKUP |
| 6 | Unpaid drop never delivered | Done. Paying a drop needs per-drop collection (Phase 4). |
| 14 | Gates in backend and DB | Done for the pickup gate and the drop gate: service, API and database |
| 17 | OTP visibility can't bypass | Backend part done: an unpaid handover is refused whatever the OTP, and `handoverAllowed` is served for the engine (Phase 8, BK-2) and the apps (Phases 9–10) to withhold the OTPs |
| 21 | No hard-coded no-show or undelivered policy | Phase 3 part done: nothing is decided automatically. A trip held at the pickup stays there until it is paid or cancelled, and a failed drop until it is retried or an admin resolves it. The financial treatment stays open (N5; Phases 4–6). |

This replaces two earlier rows: section 9's "no UPDATE grant on `booking_stops`" (now the lifecycle columns only) and section 10's "Stops still can't change before Phase 3". Their least-privilege refusals for recording an arrival, resolving a failed stop and moving a stop became guard refusals in the lifecycle test, since those columns are now granted.

Last full run: 369 unit tests and 379 integration tests passing against PostgreSQL 17, plus the end-to-end run (13 steps, 10 idempotency checks) and the migration check (fresh install, each migration level, and four databases with data). Lint, typecheck, build and the schema drift check are clean.

## 12. Implementation status: payment flow Phase 4

[PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md) Phase 4 (cash and QR collections tied to one obligation, per-drop fee shares, one ledger key per collection, the finalizer, `PARTIALLY_PAID`) and OPEN_DECISIONS section I ("Phase 4: collections per obligation"). Migrations `20261018120000_partially_paid_mixed_enums` (two enum values) and `20261018120100_obligation_collections` (rules and the `earning_collections` table; no row touched). Payout of an earning funded by several collections is Phase 5.

| Requirement | Status | Implementation | Tests |
|---|---|---|---|
| One obligation per collection, resolved on the server: the booking at the pickup, the current drop of a booking paid drop by drop, the whole booking for a historical one | Done. Booking, trip, method, stage, current drop, amount, state and ownership are checked; `stopSequence` is never taken on trust. | `collection-obligation.ts` (`resolveObligation`, `isPerDropDelivery`), `obligationOrThrow` in `collections.service.ts` (an early answer, then again under the locks booking → trip → stops); `guard_collection_insert` | `collection-obligation.spec.ts`; stop-collections ("only the drop the driver is at, for exactly its amount"; "the database on its own"); pickup-payment ("collecting the pickup obligation") |
| Amount from the frozen booking; the client amount is only an echo | Done. Wrong amount: `422 COLLECTION_AMOUNT_MISMATCH { expectedPaise }`. Wrong or future drop: `409 COLLECTION_NOT_ALLOWED { reason: NOT_CURRENT \| STOP_ALREADY_PAID }`. Missing drop: `404 STOP_NOT_FOUND`. No `stopSequence` for a drop: `422 STOP_REQUIRED`. | `resolveObligation`, `obligationError`; `guard_collection_insert` ("A drop is collected for its own payable amount") | stop-collections ("refuses another drop, a missing one, the whole booking and any other amount"); pickup-payment ("wallet shortfall, a drop named, or another amount"); e2e steps 12 and 14 |
| Cash: idempotent, wallet debited exactly once, never negative | Done. `Idempotency-Key` required; the fee debit and the collection are one transaction (lock order booking → trip → stops → collection → wallet); no provider call inside it. One ledger key per collection for bookings priced per drop; historical bookings keep one per booking. | `CollectionsService.recordCash`, `WalletLedgerService`; `guard_collection_insert` (the debit is the collecting driver's own CASH_RIDE_FEE of exactly the fee) | stop-collections ("duplicate and concurrent cash for one drop", "an insufficient wallet is refused"); pickup-payment ("duplicate cash", "a historical booking keeps its one fee debit per booking"); e2e steps 12, 14 and 16 |
| QR per obligation: one live QR, notes naming the obligation, provider-authoritative | Done. The collection id is the QR's reference; the notes carry `collection_id`, `booking_id`, `stage`, `booking_stop_id`, `stop_sequence`. Asking again shows the same QR; an expired one is replaced; cash closes it first; a failed attempt closes the drop's QR. | `CollectionsService` (`createOnlineCollection`, `collectCash`, `closeOpenCollections`), `RazorpayCollectionHttpGateway`, `InternalBookingsController.stopStatus` | `razorpay-collection-http.gateway.spec.ts`; stop-collections ("one drop by QR", "a pending QR is shown again; an expired one is replaced", "two QR requests for one drop at once show one QR"); e2e steps 13 and 14 |
| Every confirmation path converges on one finalizer; provider success then a crash completes exactly once | Done. Webhook (`qr_code.credited`, `payment.captured` without an order), driver refresh and admin sync re-read the QR and call `CollectionFinalizerService.apply`, which locks booking → trip → stops → collection and checks the amount owed; a repeat is `ALREADY_APPLIED`. | `CollectionsService` (`handleWebhookHint`, `handlePaymentWithoutOrder`, `refresh`, `sync`), `CollectionFinalizerService`, `RazorpayWebhookService` | stop-collections ("provider confirmation": one finalizer, both orders, invalid signature, crash recovery by webhook retry and admin sync; "the webhook and the driver refresh at once"); e2e step 13 |
| A stale QR never pays a different obligation | Done. Money on a closed QR is not applied (`PAYMENT_NOT_PENDING`, flagged); money for a drop resolved as undelivered meanwhile is recorded for that drop and flagged (`PAID_FOR_CLOSED_DROP`). | finalizer, `ANOMALY_OUTCOMES` | stop-collections ("a stale QR never pays another drop"); e2e step 14 (the closed drop-1 QR can't be paid) |
| UNPAID → PARTIALLY_PAID → PAID, set only by financial finalization | Done. A drop's payment confirms it (ARRIVED → PAYMENT_CONFIRMED) and the booking takes the status its completed collections give. The database requires the same at commit. | `booking-payment-status.ts` (`collectedPaymentStatus`), `booking-payment-state.ts` (`applyCollectionCompleted`); `booking_collected_status`, `guard_booking_update`, deferred `trg_collections_effects` | `booking-payment-status.spec.ts`; stop-collections ("three drops in cash, by QR, in cash", "keeps the payment status and the drop in step with the money"); e2e step 14 |
| Unpaid drop never DELIVERED; payment for one drop never covers another | Done (Phase 3 gate, now reachable). | `decideEngineStopRequest`; `guard_booking_stop_update` | delivery-stops; stop-collections ("cash racing a paid QR", "drop 1 and drop 2 at once"); e2e step 14 |
| Completion with an undelivered drop (N5) | Done. The trip completes PARTIALLY_PAID once every drop is finished; the earning counts only what was collected. Nothing collected: it can't complete. | `BookingStopsService.apply`, `BookingsService.complete`, `earningFunding` | stop-collections ("a drop left undelivered"); delivery-stops (nothing collected) |
| Collection-to-earning linkage for several collections (cash and QR combinations, the source of every amount kept) | Done. `earning_collections` lists every collection funding an earning (method, amount, fee share). One collection: single-source earning plus one link. Several: no direct source, gross and fee add up to the links (checked at commit), settlement CASH, ONLINE or MIXED. | `earning-funding.ts`, `EarningsService.createForCompletedTrip`; `earning_collections` (insert guard, immutable, no delete), deferred `trg_earnings_sources`, `driver_earnings` CHECKs | `earning-funding.spec.ts`; stop-collections ("links an earning only to its own completed collections"); least-privilege ("collects and pays only the obligation owed now"); e2e steps 12–14 and 16 |
| Payout scheduling and bank logic unchanged (Phase 5 owns the rest) | Done. A multi-collection ONLINE or MIXED earning stays `AWAITING_SETTLEMENT`: its QR settlement is recorded, `applySettlement` answers `SEVERAL_COLLECTIONS`. A single QR collection is settled and paid out as before. | `EarningsService.applySettlement`, `PayoutBatchesService.prepare` (unchanged) | stop-collections (MIXED stays unsettled); e2e steps 13–15 |
| Reconciliation and the money trail | Done. `GROSS_NOT_BOOKING_FARE` compares a booking paid drop by drop with what it collected; paid-then-cancelled bookings list one row per collection; the booking chain shows each collection's drop and the earning's sources. | `earnings-reconciliation.service.ts`, `booking-chain.service.ts` | stop-collections ("a stale screen, a failed drop and a closed booking"); e2e step 16 |
| Historical bookings keep their behaviour (N3) | Done. One collection for the whole booking, single-source earnings, `cash-ride-fee:<bookingId>`. No stops invented. | legacy branches of `resolveObligation` and `booking_collected_status` | pickup-payment, legacy-bookings, legacy-migration; migration check; dev database (every row unchanged) |
| Least privilege | Done. UPDATE on `booking_stops.payment_confirmed_at` (allowed by the stop guard only with the drop's COMPLETED collection) and SELECT, INSERT on `earning_collections`. | `prisma/sql/02-app-grants.sql` | least-privilege ("collects and pays only the obligation owed now"; every flow with the production grants) |
| Migration safety and rollback (N1) | Done. Five new preflight sections (Phase 4 enum values, bookings priced per drop by status, pending QRs by model and stage, earning sources, cash fee ledger keys). Both `down.sql` files drop no data and refuse once Phase 4 data exists; the enum one rewrites two tables (maintenance window). | `prisma/sql/preflight-payment-flow.sql`, both `down.sql`, `npm run db:migration-check` | migration check: up, both down.sql files (newest first), up again; every row unchanged; schema equal to a fresh install at each level |
| Local end-to-end QR payments | Done. `COLLECTION_LINK_PROVIDER=simulated` (refused in production and with live keys) and `POST /v1/dev/simulate/qr-codes/:qrCodeId/payments`. | `SimulatedCollectionLinkGateway`, `DevSimulationController` | `simulated-collection-link.gateway.spec.ts`, `app-config.spec.ts`; e2e steps 13–15 |

Review acceptance criteria (§34) assigned to Phase 4:

| # | Criterion | Phase 4 result |
|---|---|---|
| 4 | Cash and driver QR at pickup | Done |
| 5 | Separate payment per active drop | Done |
| 7 | No cross-stop payment | Done: API, finalizer and database |
| 9 | Client can't change money | Done for collections: the amount is an echo of the frozen obligation |
| 11 | Wallet never negative | Kept: a shortfall records nothing |
| 12 | Idempotent everywhere | Done for collections, QR display and every confirmation path |
| 13 | Webhooks verified and deduplicated | Kept, plus the QR events of each obligation |

**Production restriction until Phase 5** (OPEN_DECISIONS section I, Phase 4). All-cash multi-drop PAY_AT_DELIVERY may work through the current backend flow, and single-drop QR works. Multi-drop PAY_AT_DELIVERY containing a QR drop must stay blocked until Phase 5 makes earnings funded by several collections correctly payable and settleable. The restriction is operational: the backend doesn't refuse such a QR.

Review conflicts resolved: 2 and 3 (PAY_AT_DELIVERY is collected per drop, with one live collection per obligation) and 6 (one fee debit per collection). Conflict 7 is half done: earnings now record every source and MIXED exists, while settlement gating per collection and the payout item amount remain Phase 5.

Last full run: 398 unit tests and 414 integration tests passing against PostgreSQL 17, plus the end-to-end run (18 steps including 12–16 for Phase 4, 17 idempotency checks) and the migration check (fresh install, each migration level, and four databases with data before the dev and e2e databases were migrated). Lint, typecheck, build and the schema drift check are clean.

## 13. Implementation status: payment flow Phase 5

[PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md) Phase 5 and C.4 (earnings that span several collections, settlement gating per collection, the payout item amount, a failed payout ON_HOLD with no automatic retry, N10) and OPEN_DECISIONS section I ("Phase 5: earnings funded by several collections"). Migration `20261019120000_mixed_earnings_payout_hold` adds new columns, filled from each earning's own sources (no existing value changes), new rules, a link column and the `settlement_findings` table.

| Requirement | Status | Implementation | Tests |
|---|---|---|---|
| Single-collection flows unchanged (PAY_AT_PICKUP cash and QR, single-drop PAY_AT_DELIVERY QR, all-cash multi-drop, historical and prepaid earnings) | Done | `EarningsService.createForCompletedTrip` (single-source branch), `onlineStatus` | multi-collection-earnings ("single collection (unchanged flows)", "cash + cash"); trips-earnings; pickup-payment; legacy-bookings; e2e steps 1–13 |
| `earning_collections` is the authoritative linkage; a collection is linked once and funds one earning | Done. Each link keeps method, amount, fee share and `net_amount_paise` (CHECK = amount − fee). The primary key is the collection; links are immutable and can't be deleted. | `earning_collections` (PK, insert guard, immutability, CHECK); `EARNING_SOURCES` | multi-collection-earnings ("the split, the payout amount and each link are immutable"); least-privilege (refusals) |
| Split and payout amount (CASH 0, ONLINE net, MIXED online − online fee); no new fee or tax rule | Done. Five new columns, CHECKs (`earnings_split_*`), checked against the links at commit (`check_earning_sources` v2), immutable (`guard_earning_change` v3). A MIXED earning has no other deduction and no TDS. | `earning-funding.ts` (`earningFunding`, `prepaidSplit`), `earnings.mapper.ts` | `earning-funding.spec.ts`; multi-collection-earnings ("cash + QR", "QR + cash + QR: exact gross, fee and split"); e2e steps 14 and 17 |
| Settlement per collection: one QR settling never makes the earning payable while another is unsettled; no T+N assumed | Done. The settlement is matched to its collection; `applyToSeveral` promotes the earning when the last online collection settles (`PARTIALLY_SETTLED` before). The deferred `trg_earnings_settled` refuses PAYABLE, IN_PAYOUT or PAID otherwise, for every role. A multi-collection earning never gets a settlement link of its own (CHECK). The sync also applies settlements recorded but not yet applied. | `EarningsService.applySettlement`, `onlineSettlementProgress`, `MerchantSettlementsService.applyRecordedSettlements` | multi-collection-earnings ("QR + QR", "QR + cash + QR", "settled before the trip completes", "recorded but not applied"); e2e step 17; migration check (fresh install: refused with one QR unsettled) |
| Payout item amount = the earning's payout amount, never gross, unsettled, twice, the first collection only, or stale | Done. Batches take PAYABLE ONLINE and MIXED earnings that pass the settlement rule, for `payout_amount_paise`. `guard_payout_item_change` v2 requires exactly that amount for a PAYABLE earning of the payout's driver. The partial unique index keeps one live item per earning. | `PayoutBatchesService.prepare`, `computePayoutBreakdown` | multi-collection-earnings ("a payout item must carry exactly the payout amount", "one payout per driver carries every earning for its payout amount"); payouts #12; e2e steps 15, 18 and 19 |
| Failed payout → ON_HOLD, explicit admin release, no silent requeue, never two payouts (N10) | Done. Items RELEASED, earnings ON_HOLD (`PAYOUT_FAILED: …`), audited `PAYOUT_FAILED_EARNINGS_HELD`. The database refuses IN_PAYOUT → PAYABLE. The release is idempotent, and only a new payout pays the earning. | `PayoutStatusService.holdFailedEarnings`, `failBeforeSubmit`, `EarningsService.release`; `guard_earning_change` v3 | payouts #14 (three tests); multi-collection-earnings ("cash, QR, cash: … fails, goes ON_HOLD, is released and paid once"); e2e step 18 |
| Admin booking chain shows every collection source and settlement state | Done. `merchantSettlements[]` (`merchantSettlement` kept), each collection's settlement and earning, the earning's split, sources and payout item amounts. | `booking-chain.service.ts` | multi-collection-earnings (money trail in the failed-payout test); e2e steps 14, 15, 17 and 18 |
| Reconciliation: totals, fees, cash and online parts, settlement state, payable before settlement, payout amount, duplicate links, collections in several earnings, unknown settlements, provider vs internal amounts; no silent fixes | Done. Earning codes `EARNING_NOT_SUM_OF_SOURCES`, `FEE_NOT_SUM_OF_SOURCES`, `CASH_NOT_CASH_SOURCES`, `ONLINE_NOT_ONLINE_SOURCES`, `PAYOUT_AMOUNT_NOT_ONLINE_NET`, `SETTLED_BUT_AWAITING`, `PAYABLE_BEFORE_SETTLEMENT`, `COLLECTION_LINKED_TWICE`, `COLLECTION_FUNDS_SEVERAL_EARNINGS`, `COLLECTION_NOT_IN_EARNING`. Payout codes `ITEM_NOT_EARNING_PAYOUT_AMOUNT`, `EARNING_IN_SEVERAL_LIVE_ITEMS`. `settlement_findings` and `GET /v1/admin/reconciliation/settlement-anomalies` (`SETTLEMENT_UNKNOWN_PAYMENT`, `SETTLEMENT_AMOUNT_MISMATCH`). | `earnings-reconciliation.service.ts`, `MerchantSettlementsService.recordFinding`, `reconciliation.controller.ts` | multi-collection-earnings ("settlement findings", "leaves the reconciliation reports clean"); least-privilege (a finding with production grants); e2e step 19 |
| L-11 / D-70 undelivered drop, financially, and N5 driver pay (payout of a partly paid trip) | Technical safe defaults only; both business decisions stay **OPEN**. An earning with an online part on a booking with an UNDELIVERED drop starts ON_HOLD (`UNDELIVERED_STOP_REVIEW`), PAY_AT_PICKUP included. This is configurable with `EARNINGS_UNDELIVERED_DROP_HOLD` (default true). Batches take PARTIALLY_PAID bookings' earnings (after the release, with the default), for collected and settled money only. An unpaid drop adds nothing, and nothing is refunded, compensated or debited on its own. | `EarningsService.undeliveredStopHold`, `PayoutBatchesService.prepare`, `env.schema.ts` | multi-collection-earnings ("undelivered drop (L-11 / D-70 technical safe default)", two tests; "… with the review hold off"); `app-config.spec.ts` |
| Concurrency: collections before earning creation, completion racing a collection, duplicate settlements, partial settlement, mixed becoming payable, batch vs settlement, execution vs admin release, duplicate payout webhooks, lost response then re-query, two payout attempts | Done | row locks (booking, earning `FOR UPDATE`), idempotency keys, unique indexes, deferred triggers | multi-collection-earnings ("concurrency", seven tests, and the settlement tests); payouts; e2e steps 17–18 |
| Least privilege | Done. SELECT and INSERT on `settlement_findings`, UPDATE of `occurrences` and `last_seen_at` only. The new columns are not updatable, and the API role can't disable the new triggers. | `prisma/sql/02-app-grants.sql` | least-privilege (MIXED earning to PAID and a finding with production grants; eight new refusals; three new trigger refusals) |
| Migration safety and rollback (N1) | Done. Six new preflight sections. The backfill is asserted inside the migration. `down.sql` drops no data and refuses once a payable multi-collection earning, a payout of one, or a settlement finding exists. | `preflight-payment-flow.sql`, `down.sql`, `check-legacy-migration.mjs` (backfill check on every source, Phase 5 fresh-install fixture and refusals) | migration check: up / down / up on four databases with data (legacy snapshot, Phase 1 snapshot, dev, e2e), every row unchanged, split = sources, schema equal to a fresh install at each level |

Review acceptance criteria (§34) touched by Phase 5:

| # | Criterion | Phase 5 result |
|---|---|---|
| 12 | Idempotent everywhere | Kept for settlements (repeated and concurrent syncs and webhooks), payout webhooks, releases and batches |
| 23 | Provider/internal mismatch reconciled | Partly, ahead of Phase 7: settled payments that match nothing, or another amount, are recorded and listed |
| 25 | E2E and concurrency pass | Phase 5 paths covered locally with simulated providers |

**Production restriction: still in force.** Multi-drop PAY_AT_DELIVERY with a QR drop stays blocked operationally until the go-live conditions in OPEN_DECISIONS section I, Phase 5 are met. Phase 5 doesn't change the restriction.

Review conflict 7 (one source per earning, payout items ONLINE only, MIXED impossible) is now resolved: settlement gating per collection and the payout item amount are done.

Last full run: 402 unit tests and 449 integration tests passing against PostgreSQL 17, plus the end-to-end run (21 steps including 17–19 for Phase 5, 23 idempotency checks) and the migration check (fresh install, each migration level, and four databases with data before the dev database was migrated). Lint, typecheck, format, build and the schema drift check are clean.

## 14. Implementation status: payment flow Phase 6

[PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md) Phase 6 (refund infrastructure with every policy switch off, C.5, tests I.5) and OPEN_DECISIONS section I ("Phase 6: refund infrastructure"). Migrations `20261020120000_partially_refunded_enum` (one enum value) and `20261020120100_refunds` (the `payment_refunds` table, `payment_collections.refunded_paise`, rules and one grant; no existing row changes). The refund policy stays **OPEN** (L-7 to L-10, L-21): only its technical safe defaults are implemented.

| Requirement | Status | Implementation | Tests |
|---|---|---|---|
| Refund state machine (PENDING, PROCESSING, COMPLETED, FAILED, REFUSED, CANCELLED), forward only | Done. Razorpay `pending` → PROCESSING, `processed` → COMPLETED, `failed` → FAILED; an outright rejection with no record at Razorpay → REFUSED; an admin withdrawal before it reached Razorpay → CANCELLED. A cash return is recorded COMPLETED. Each status carries its facts. | `refund-policy.ts` (`refundStatusForProvider`, `refundMove`), `RefundFinalizerService`; `refunds_status_facts`, `refunds_kind_shape`, `guard_refund_update` | `refund-policy.spec.ts`; refunds ("provider refunds", "keeps the source, amount and decisions immutable and the status forward-only") |
| Immutable source linkage: one source of the booking and drop | Done. Exactly one source (a completed collection or a paid historical prepaid payment); the composite foreign key ties the drop to the booking; source, amount, reason, requester, kind and fee decision never change, for every role. | `RefundsService.loadSource`, `lockSource`; `refunds_one_source`, `payment_refunds_booking_id_booking_stop_id_fkey`, `guard_refund_insert`, `guard_refund_update` | refunds ("ownership", "refuses refunds that break ownership, amounts or the lifecycle when they are written") |
| Provider refunds (Razorpay): provider reference, response verification, idempotency | Done. `POST /v1/payments/:id/refund` with `X-Refund-Idempotency` = receipt = our refund id, notes and speed `normal`, sent after the commit. Every response is parsed (zod) and must match our payment, amount, currency, receipt and notes; a Razorpay refund id is recorded once. The bank reference (ARN, RRN or UTR) is kept. | `RazorpayRefundHttpGateway`, `razorpayRefundSchema`, `refund.gateway.ts` (`toProviderRefund`, `findOurRefund`), `RefundFinalizerService.mismatches`; `uq_refunds_provider_refund` | `razorpay-refund-http.gateway.spec.ts`; refunds ("refunds a cancelled booking QR payment through Razorpay, completed only by what Razorpay reports, once") |
| Webhooks, API + webhook convergence, re-fetch | Done. `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed` on the signed Razorpay webhook; matched by Razorpay id, or by receipt / notes when the reply was lost. Reply, webhook and admin sync all go through one finalizer (booking lock, then refund lock): repeats are `REFUND_ALREADY_APPLIED`, older states `REFUND_STALE_UPDATE`; `REFUND_MISMATCH`, `REFUND_CONFLICTING_STATE` and `REFUND_UNKNOWN` are reported, never applied. | `RazorpayWebhookService.decideRefund`, `RefundFinalizerService.apply` / `applyWebhook`, `RefundsService.sync` | refunds ("a webhook for a refund whose reply was lost is matched by our receipt", "a sync and webhook deliveries racing on the same state converge on one completion", "unknown, mismatched, contradictory and forged refund webhooks are never applied"); e2e step 20 |
| Retries without double refunds: crash after Razorpay accepted, outage, rejection | Done. A 120 s submission lease; a retry looks the refund up at Razorpay before resending with the same key. An outage or an unreadable reply leaves it PENDING; HTTP 400/401/403/404/422 with no record at Razorpay → REFUSED. | `RefundsService.submit`, `handleSubmitError`, `REFUND_SUBMISSION_LEASE_SECONDS` | refunds ("an outage leaves it PENDING …", "Razorpay refunded but the reply was lost …", "Razorpay rejecting the request refuses the refund …", "an unreadable reply never closes a refund Razorpay made") |
| Cash returns: audited CASH_RETURNED, source linkage, exact amount, explicit fee decision, no silent wallet movement | Done. Recorded COMPLETED and audited `CASH_RETURN_RECORDED`. `feeTreatment` required: `KEPT` (no wallet movement) or `CREDITED_TO_WALLET` (one `REFUND_REVERSAL` credit of exactly the fee, to the collecting driver, in the same transaction, only with the return of everything left). The database refuses a REFUND_REVERSAL credit no cash return decided. | `RefundsService.record`, `WalletLedgerService.postEntry`; `refunds_fee_credit_shape`, `wallet_tx_refund_reversal_shape`, deferred `trg_wallet_refund_reversal`, `uq_refunds_wallet_tx` | refunds ("cash returns", three tests; "returns part of the cash, then the rest, never more; the fee only with the last part"); e2e step 21 |
| Ownership and integrity in the service and the database | Done. Active admin only; cancelled or completed bookings only; the source is of the booking and drop and completed or paid; a provider refund refunds its source's own payment; refunds never exceed what the source collected (source row locked); one live refund per source; `refunded_paise` kept by a SECURITY DEFINER trigger; the booking status is `booking_money_status`, checked at commit. | `RefundsService`; `guard_refund_insert`, `uq_refunds_collection_live`, `uq_refunds_payment_live`, `sync_collection_refunded`, `guard_collection_update` v3, `guard_booking_update` v4, `check_collection_effects` v2, deferred `trg_refunds_effects` | refunds ("database guards (even for the table owner)", three tests; "ownership"); least-privilege |
| Policy stays open, with the safe defaults | Technical safe defaults only; the business decisions stay **OPEN**. No automatic refund (`REFUND_AUTO_ON_CANCEL=true` is refused); admin-initiated, reason required, audited; full refund of what is left (`REFUND_PARTIAL_ALLOWED=false`); the case is recorded and decides nothing (`REFUND_ALLOWED_CASES`, default all); no wallet debit or recovery. | `env.schema.ts`, `app-config.ts` (startup log), `refund-policy.ts` (`refundCaseOf`, `resolveRefundAmount`) | `app-config.spec.ts`, `refund-policy.spec.ts`; refunds ("policy stays open, with safe defaults", four tests; "with partial refunds on and cancellations before the handover excluded", three tests) |
| Earnings: no new payout rule; hold or review, never a silent clawback | Done. AWAITING_SETTLEMENT or PAYABLE → ON_HOLD (`REFUND: …`) in the refund's transaction; IN_PAYOUT refuses the refund (`REFUND_EARNING_IN_PAYOUT`); PAID and SETTLED_IN_CASH unchanged and reported; a failed refund releases nothing. | `EarningsService.holdForRefund`, `HOLD_REFUND`; `findRefundAnomalies` | refunds ("earnings", three tests); e2e steps 21 and 22 |
| Concurrency | Done: duplicate and concurrent requests, API + webhook race, refund vs late payment completion, refund vs payout preparation, refund after payout, provider success + backend crash, provider failure + retry, stale states and stale requests. | booking → trip → stops → wallet → source → earning locks, idempotency keys, partial unique indexes, the submission lease, deferred triggers | refunds ("concurrency", three tests; "a refund and a payout batch racing for one earning never both win"; the retry and convergence tests above; "reports a stale pending refund; a sync recovers it") |
| Security: no client-chosen amount, no other booking or drop, no client completion, admin only | Done. Admin only, throttled; the body can't carry a status, provider id, case or fee credit (unknown fields are a 400); no route sets a status; forged webhooks are rejected before anything is read. | `AdminRefundsController`, `refunds.dto.ts`, `createValidationPipe`; the database guards | refunds ("authorization": "only admins reach the refund API, and nobody completes a refund by hand"; "ownership") |
| Legacy: PREPAID and LEGACY_BOOKING_LEVEL safe, no historical row altered | Done. A historical prepaid payment is refunded from its own row, which stays PAID; a historical whole-booking collection is refunded like any other. The migration changes no row. | `RefundsService.loadSource` (payment branch) | refunds ("historical bookings", two tests); migration check on four databases with data |
| Reconciliation and the money trail | Done. `refund-anomalies` (`STALE_PENDING_REFUND`, `STALE_PROCESSING_REFUND`, `REFUND_AFTER_PAYOUT`, `REFUND_ON_CASH_EARNING`, `REFUNDED_TOTAL_MISMATCH`, `REFUNDS_EXCEED_SOURCE`, `BOOKING_REFUND_STATUS_MISMATCH`, `FEE_CREDIT_MISMATCH`); `paid-cancelled-bookings` is refund-aware; the booking chain lists refunds and `refundedPaise`. | `earnings-reconciliation.service.ts` (`findRefundAnomalies`, `findPaidCancelledBookings`), `booking-chain.service.ts`, `reconciliation.controller.ts` | refunds ("reconciliation"); e2e steps 20 and 23 |
| Least privilege | Done. SELECT and INSERT on `payment_refunds` and UPDATE of its lifecycle columns only; nothing on `refunded_paise`; no DELETE or TRUNCATE; the API role can't disable a refund trigger. | `prisma/sql/02-app-grants.sql` | least-privilege ("serves provider refunds and cash returns with production grants"; new column and trigger refusals) |
| Migration safety and rollback (N1) | Done. Phase 6 preflight sections. Both `down.sql` files drop no data and refuse once a refund is recorded, a booking is in a refund status, or (enum) a booking is PARTIALLY_REFUNDED. | `preflight-payment-flow.sql`, both `down.sql`, `check-legacy-migration.mjs` (Phase 6 fresh-install fixture, refusals and `checkRefunds`) | migration check: up / down / up on four databases with data, every row unchanged, schema equal to a fresh install at each level |
| Local end-to-end provider refunds | Done. `REFUND_PROVIDER=simulated` (refused in production and with live keys) and `POST /v1/dev/simulate/refunds/:providerRefundId`. | `SimulatedRefundGateway`, `DevSimulationController` | `simulated-refund.gateway.spec.ts`, `app-config.spec.ts`; e2e steps 20–23 |

Review acceptance criteria (§34) touched by Phase 6:

| # | Criterion | Phase 6 result |
|---|---|---|
| 9 | Client can't change money | Kept for refunds: the server computes every refund amount |
| 12 | Idempotent everywhere | Done for refund requests, submissions, webhooks and syncs |
| 13 | Webhooks verified and deduplicated | Kept, plus the `refund.*` events |
| 18 | Historical PREPAID safe | Kept: a prepaid payment is refunded without rewriting it |
| 20 | Refund infrastructure without invented policy | Done: every policy switch off, admin-initiated only |
| 21 | No hard-coded no-show / undelivered policy | Kept: an undelivered drop's refund case is recorded and decides nothing |
| 25 | E2E and concurrency pass | Phase 6 paths covered locally with a simulated provider |

**Production restriction: still in force.** Multi-drop PAY_AT_DELIVERY with a QR drop stays blocked operationally until the go-live conditions in OPEN_DECISIONS section I, Phase 5 are met; Phase 6 doesn't change it. Live provider refunds are not production-ready until D-72 is verified (`REFUND_PROVIDER=disabled` until then).

Review conflict 9 (no refund records, no provider refund call, no refund webhooks) is resolved. Money that reached a closed QR (`PAYMENT_NOT_PENDING`) still has no recorded source to refund through the API (OPEN_DECISIONS section I, Phase 6, remaining gaps).

Last full run: 421 unit tests and 503 integration tests passing against PostgreSQL 17, plus the end-to-end run (25 steps including 20–23 for Phase 6, 29 idempotency checks) and the migration check (fresh install, each migration level, and the databases with data: the legacy and Phase 1 snapshots and dev in the last run, before dev was migrated; the e2e database in an earlier run). Lint, typecheck, format, build and the schema drift check are clean. The dev database is migrated, with every existing row unchanged.
