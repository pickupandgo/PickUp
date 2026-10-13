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
