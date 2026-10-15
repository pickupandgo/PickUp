# Open Decisions: MultipleRide (Pick Up) V1 Backend

Phase 0 audit, 2 Oct 2026. This file tracks only items the supplied sources leave unresolved or contradict. Source references point to [ARCHITECTURE_TRACEABILITY.md](./ARCHITECTURE_TRACEABILITY.md). [Section E](#e-payments--driver-wallet-slice-raj_backend) records how the payments + wallet slice applied these decisions, and the new ones it raised. [Section F](#f-approved-v1-payment-earnings-and-payout-rules-2-oct-2026) records the approved V1 money rules, what they settle, and what is still open. [Section G](#g-approved-decisions-second-set-6-oct-2026) records the second set of approved decisions (rounding, settlement-gated payouts, Monday payouts, bank validation, TDS readiness) and the items they leave open. [Section H](#h-approved-decisions-third-set-after-commit-f07ff5c) covers the bank-account step-up, and [section I](#i-payment-flow-phase-1-pay-at-pickup--per-drop-pay-at-delivery) the PAY AT PICKUP / per-drop PAY AT DELIVERY flow phase by phase (Phases 1–4), including the technical defaults each phase introduced.

How to read each entry:

- **Recommendation:** my proposal for a spec conflict. It still needs sign-off.
- **Safe default:** what the code does until the decision is made. For financial and legal items I don't choose the rule; the default only keeps the system safe.
- **Status:** **Blocks P1** means it must be settled before the first migration is written. **Blocks P*n*** means it blocks that phase.

---

## A. Spec conflicts and scope

These shape the schema.

### D-01 Booking status values
- **Conflict:** MP §22 gives SEARCHING_DRIVER → DRIVER_OFFERED → DRIVER_ASSIGNED → DRIVER_ARRIVING → DRIVER_ARRIVED → TRIP_STARTED → TRIP_COMPLETED / CANCELLED. No PDF defines these. M5 says the booking must not become the trip state machine. M5 and M6 only name CREATED, SEARCHING_DRIVER, assignment, COMPLETED and cancellation for the booking.
- **Why it matters:** two overlapping state machines will drift. The enum also gets baked into the migration.
- **Options:**
  - **A.** Use MP's list on bookings and M6's list on trips.
  - **B.** Bookings carry intent-level states only: CREATED, SEARCHING_DRIVER, DRIVER_ASSIGNED, COMPLETED, CANCELLED, plus a no-driver outcome (D-30). Execution detail is read from `trips.status`.
- **Recommendation:** B.
- **Affects:** bookings, trips, dispatch, app contract.
- **Owner:** Product + tech lead. **Status:** Open, blocks P1.

### D-02 When the trip row is created
- **Conflict:** M6's trip lifecycle starts at CREATED/SEARCHING_DRIVER, but `trips.driver_id` and `vehicle_id` are NOT NULL. M6 also says they "become populated after successful assignment".
- **Options:**
  - **A.** Create the trip at assignment. The trip enum starts at DRIVER_ASSIGNED; CREATED/SEARCHING_DRIVER live on the booking.
  - **B.** Create the trip at booking time with nullable driver and vehicle.
- **Recommendation:** A. It keeps NOT NULL and matches M5's booking → assignment → trip handoff.
- **Also:** CANCELLED is missing from the M6 diagram, but `trips.cancelled_at` exists and M6 §9 says a trip "may resolve through cancellation". I propose adding CANCELLED to the trip enum.
- **Affects:** trips, dispatch. **Owner:** Tech lead. **Status:** Open, blocks P1.

### D-03 Trip status across multiple drops
- **Conflict:** M6 is linear (IN_TRANSIT → DROP_PROGRESS → DELIVERED) with no back-edge. The prototype goes DROP_PROGRESS → IN_TRANSIT between drops, bypassing its own validator. The apps and the m19 test expect IN_TRANSIT between stops.
- **Options:**
  - **A.** IN_TRANSIT from trip start until arrival at drop 1. DROP_PROGRESS from then until the last drop is delivered. Then DELIVERED. Per-leg detail comes from stop status.
  - **B.** Add a DROP_PROGRESS → IN_TRANSIT back-edge.
- **Recommendation:** A, since it uses only documented transitions. The apps need a small change to read stop status.
- **Affects:** trips, both apps. **Owner:** Product + tech lead. **Status:** Open, blocks P1.

### D-04 Pickup stop terminal status
- **Conflict:** the M6 diagram shows the pickup stop as COMPLETED, but the stop enum is PENDING/IN_TRANSIT/ARRIVED/DELIVERED.
- **Options:**
  - **A.** Add COMPLETED, allowed only when `stop_type = PICKUP` (CHECK constraint). Mapping:
    - pickup stop IN_TRANSIT ↔ trip DRIVER_ASSIGNED
    - pickup stop ARRIVED ↔ trip DRIVER_ARRIVED
    - pickup stop COMPLETED ↔ trip PICKUP_VERIFIED
  - **B.** The pickup stop ends as DELIVERED.
- **Recommendation:** A.
- **Affects:** trips. **Owner:** Tech lead. **Status:** Open, blocks P1.

### D-05 Driver availability and approval values
- **Conflict:** MP has OFFLINE, AVAILABLE, OFFERED, ASSIGNED, ON_TRIP, SUSPENDED. M3 has availability OFFLINE, AVAILABLE, OFFERED, BUSY, "etc." and approval PENDING, UNDER_REVIEW, APPROVED, REJECTED, "SUSPENDED/BLOCKED". M3 says the two are separate dimensions.
- **Recommendation:**
  - Availability: OFFLINE, AVAILABLE, OFFERED, ASSIGNED, ON_TRIP. MP's list fills in M3's "etc." and splits BUSY.
  - Approval: PENDING, UNDER_REVIEW, APPROVED, REJECTED, SUSPENDED. SUSPENDED moves to approval per M3.
- **Question:** is BLOCKED a separate approval state from SUSPENDED, or is it covered by `blocked_until`?
- **Affects:** drivers, dispatch, admin. **Owner:** Product. **Status:** Open, blocks P1.

### D-06 Booking payment method values
- **Conflict:** M5 has COD / CASH / UPI. PW and MP have PREPAID_UPI, PAY_AT_PICKUP, PAY_AT_DELIVERY, with the collection method (CASH / ONLINE_QR) recorded on `payment_collections`.
- **Recommendation:** use the PW/MP values on `bookings.payment_method`, and keep CASH/ONLINE_QR on collections.
- **Affects:** bookings, payments, collections, customer app. **Owner:** Product. **Status:** Open, blocks P1.

### D-07 Booking columns PW assumes but M5 doesn't define
- **Conflict:** PW reads `bookings.driver_id`, `bookings.payment_due_stage` and `bookings.fare_paise`. M5 says the booking stores the requested category, not the driver, and names the fares `fare_estimate_minor` / `final_fare_minor`.
- **Recommendation:**
  - No `driver_id` on bookings. Get the driver from `trips.driver_id`, using lock order booking → trip → wallet → payment rows.
  - Derive the due stage from `payment_method`: PAY_AT_PICKUP → PICKUP, PAY_AT_DELIVERY → DELIVERY.
  - Keep M5's column names.
  - The amount collected depends on D-20.
- **Affects:** bookings, collections, wallet. **Owner:** Tech lead. **Status:** Open, blocks P1.

### D-08 Wallet table names
- **Conflict:** M1 uses `wallets` / `wallet_transactions`. PW and MP use `driver_wallets` / `driver_wallet_transactions`.
- **Recommendation:** the PW names. M1 says its names aren't the final SQL. PW is the detailed spec, and V1 has no customer wallet.
- **Owner:** Tech lead. **Status:** Proposed; confirm.

### D-09 Customer table name and identity columns
- **Conflict:** M1 has `customer_profiles`; M5's ER diagram has `customers (id, user_id, status)`. M2, which would define `users`, customers and `customer_addresses`, wasn't supplied.
- **Recommendation:** use `customers` (M5). It's the table `bookings.customer_id` references. I'll build minimal identity columns from M3/M4/M5 and replace them with M2 if it exists.
- **Question:** can one user be both a customer and a driver? M3 shows a single `users.role`.
- **Owner:** Product + tech lead. **Status:** Open, blocks P1.

### D-10 Payment and wallet enum values
- **Values that appear in PW:**
  - `payments.status`: PENDING, PAID, REFUND_PENDING
  - `wallet_status`: ACTIVE, LOW_BALANCE, BLOCKED
  - `wallet_entry_type`: TOPUP, CASH_RIDE_FEE, REFUND_REVERSAL, ADJUSTMENT
  - `ledger_direction`: CREDIT, DEBIT
  - `transaction_status`: POSTED
  - collection status: PENDING, COMPLETED, FAILED, REVERSED
- **Conflict:** `bookings.payment_status` values are never defined. PW §6 prose says PAID_ONLINE, but its SQL sets PAID.
- **Proposal:**
  - Add FAILED and REFUNDED to `payments.status`.
  - `bookings.payment_status`: UNPAID, PAID, REFUND_PENDING, REFUNDED. Cash vs online comes from the method and the collection, so there's no separate PAID_ONLINE.
- **Affects:** payments, bookings, reconciliation. **Owner:** Finance + tech lead. **Status:** Open, blocks P1.

### D-11 Insurance in V1
- **Context:** M1 and M5 include it (`insurance_required`, `insurance_quote_id`, and the provider/quote tables). The customer app has a GoodsInsuranceScreen. MP's scope and module list leave it out, and no provider is specified.
- **Safe default:** keep the booking columns (`insurance_required` default false, nullable quote ID). Don't build the insurance module.
- **Owner:** Product. **Status:** Open.

### D-12 Driver subscriptions in V1
- **Context:** M1 lists `subscription_plans` / `driver_subscriptions`. M3 says subscription checks come "later". The driver app calls `/subscription/*`. No plan, price or rule is specified.
- **Safe default:** no tables or eligibility checks until it's defined.
- **Owner:** Product. **Status:** Open.

### D-13 Scheduled bookings
- **Context:** the customer app's TripHistoryScreen has a "Scheduled" tab. No PDF defines scheduled or future bookings.
- **Safe default:** V1 bookings are immediate only.
- **Owner:** Product. **Status:** Open.

---

## B. Business, financial and legal decisions

I won't choose these rules. Owner for all: Nikhil Enterprises (business/finance/legal).

### D-14 Fare and pricing model
- **Context:** M5 requires `fare_estimate_minor` on every booking. M1 lists `pricing_rules`. M9 (Pricing) wasn't supplied.
- **The prototype hard-codes:**
  - base ₹30
  - ₹12 per km
  - ₹10 per extra drop
  - vehicle multipliers 0.8–2.0
  - weight multipliers 1.0–3.0
- **Questions:** are these approved rates or placeholders? Is distance geographic or road distance (D-33)?
- **Safe default:** fares come only from admin-configured `pricing_rules`. With no active rule, booking creation fails with `PRICING_NOT_CONFIGURED`. No prices are seeded.
- **Since the Fare module (M3) and payment flow Phase 1:** pricing is versioned (`pricing_versions`), every fare is a server quote (`POST /v1/fare/quotes`), and a booking can only be registered from a quote. With no version in effect, quoting fails with `503 PRICING_NOT_CONFIGURED`, so no booking can be made. The final rates are L-1 in [PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md#l-open-business-decisions). `PROTOTYPE*` versions hold the prototype's rates for development only; the ops CLI and the admin API both refuse them in production.
- **Status:** Open, blocks taking real bookings in production (BK-7).

### D-15 Driver platform fee formula
- **Context:** `fee_rules` supports FIXED or PERCENTAGE per category, but values, units and rounding aren't defined. For FIXED, is the value in paise or rupees? For PERCENTAGE, how is it rounded?
- **Safe default:** no fee rule means the cash collection is rejected with `FEE_RULE_NOT_CONFIGURED`. Nothing is hard-coded.
- **Status:** Open, blocks P6.

### D-16 Minimum wallet balance and LOW_BALANCE
- **Context:** PW uses LOW_BALANCE status but defines no threshold.
- **Question:** does a low balance stop a driver going online or receiving cash bookings?
- **Safe default:** no threshold; LOW_BALANCE isn't set automatically.
- **Status:** Open.

### D-17 Insufficient wallet balance at cash collection
- **Context:** PW defaults to no negative balance and says the rule must be confirmed by the client.
- **Operational trap:** the driver already holds the cash when recording it. If the debit is rejected, the collection isn't recorded, the booking stays unpaid, and the trip can't complete (M6 payment gate).
- **Options:**
  - Reject the collection.
  - Record the collection and leave the fee as a receivable. This needs an approved overdraft policy.
  - Stop drivers whose balance is below the expected fee from receiving cash bookings at all.
- **Safe default:** PW's no-negative rule (reject), with this risk documented.
- **Status:** Open, blocks P6.

### D-18 Driver settlement for prepaid bookings
- **Context:** for PREPAID_UPI, the customer's money lands in the platform's Razorpay account. No source defines how the driver gets paid. Wallet withdrawal is out of V1 (MP §34), and `trip_earnings` is undecided (M1). The driver app has an earnings screen.
- **Safe default:** record payments only. The earnings view is a read-only summary of trips; no wallet credits.
- **Status:** Open.

### D-19 PAY_AT_DELIVERY with multiple drops
- **Question:** is payment collected at the final drop, or after all drops? Who pays: the customer, or the receiver at that drop? M6 says the final stop can't complete the trip until the payment gate passes.
- **Safe default:** the collection is allowed only once all drops are DELIVERED, before PAYMENT_CONFIRMED.
- **Superseded** by the approved per-drop PAY AT DELIVERY: the receiver at each drop pays that drop's amount before handover ([PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md)). Historical (LEGACY_BOOKING_LEVEL) bookings keep the safe default above. New bookings can't be collected at delivery until per-drop collection is enabled (section I). How an undelivered drop is treated financially is still open (N5).
- **Status:** Superseded; the undelivered-drop treatment is open.

### D-20 Final fare and fare-change policy
- **Question:** when is `final_fare_minor` set, and can it differ from the estimate (waiting time, extra distance, edited stops)? Which amount does a cash or QR collection use?
- **Safe default:** final fare equals the estimate, and nothing changes it.
- **Status:** Open.

### D-21 Cash collection confirmation
- **Question:** must the customer confirm cash payment, for example with an OTP?
- **Safe default:** the driver records the collection; no customer confirmation step.
- **Status:** Open.

### D-22 Refund policy
- **Context:** PW leaves this open: refund to the original method, wallet reversal, or a mix.
- **Safe default:** the refund-ready schema (REFUND_PENDING, compensating entries) exists, but there's no automatic refund. Refunds are admin-initiated only.
- **Status:** Open.

### D-23 Cancellation charge policy
- **Context:** the customer app has CancellationChargeConfirmationScreen. M14 wasn't supplied.
- **Safe default:** cancellation is free and the charge is zero. The reason and the actor are recorded.
- **Status:** Open.

### D-24 QR collection flow
- **Question:** which provider-supported, booking-linked payment object should be used (Razorpay QR Codes, Payment Links, or another product), and is it enabled on the account? PW rules out personal UPI transfers.
- **Safe default:** ONLINE_QR stays disabled until this is decided.
- **Status:** Open, blocks QR in P5.

### D-25 Razorpay account and products
- **Questions:** who owns the merchant account? Are test keys and a webhook secret available for development? Which products are enabled?
- **Safe default:** build against test mode and mocked provider responses.
- **Status:** Open, blocks live P5 testing.

### D-26 Data retention and deletion
- **Context:** this covers location history retention (M4 leaves it open), KYC document retention, financial record retention, and account-deletion anonymization rules.
- **Safe default:** nothing is auto-deleted. Account deletion revokes access and anonymizes profile fields while keeping financial and audit records.
- **Owner:** Legal. **Status:** Open.

---

## C. Operational and technical configuration

### D-27 Authentication approach
- **Context:** the driver app already uses Firebase Phone Auth (`@react-native-firebase/auth`), and driver IDs are Firebase UIDs. The customer app has no auth library. The driver app also has an email/password login that no source specifies.
- **Options:**
  - **A.** Firebase Phone Auth in both apps. The backend verifies Firebase ID tokens and owns roles and sessions. Firebase handles SMS.
  - **B.** Backend-owned OTP through an Indian SMS provider with DLT-registered templates. The backend issues JWT access and refresh tokens.
- **Also:** should email/password login be dropped?
- **Owner:** Product + tech lead. **Status:** Open, blocks P2.

### D-28 Vehicle categories and capacities
- **Context:** the category lists don't agree:
  - M3 examples: BIKE, THREE_WHEELER, MINI_TRUCK, PICKUP, JCB, CRANE
  - prototype: 2 Wheeler, 3 Wheeler, 4 Wheeler, Mini Truck, Pickup Truck
  - MP: auto, tempo

  JCB and crane are equipment, not goods transport. `capacity_kg` values aren't given anywhere.
- **Safe default:** categories are admin-managed and none are seeded until an approved list arrives.
- **Payment flow Phase 1 (N6):** still open. Codes are checked only for their format (`^[A-Z][A-Z0-9_]*$`). The categories in `pricing/prototype-leg-distance-v1.json` are a development list, not a decision. Raj supplies the canonical list before Phase 10 (BK-6).
- **Owner:** Product. **Status:** Open, blocks P2 seeding.

### D-29 Maximum drops per booking
- **Context:** the prototype and the customer app cap it at 5. M5 says the schema must not hard-code it.
- **Safe default:** a config value, initially 5 to match the current app behaviour.
- **Payment flow Phase 1 (N7):** `FARE_MAX_DROPS`, technical default 5, allowed range 1–25. A quote with more drops gets `422 TOO_MANY_DROPS` with `details.maxDrops`. The database only holds a technical ceiling of 25 drops (quotes and booking stops), so changing the limit needs no migration. 5 is not a business rule.
- **Owner:** Product. **Status:** Open (N7).

### D-30 Dispatch parameters and no-driver outcome
- **Context:** M7 wasn't supplied. M4 implies offers go to the top N candidates and the first valid acceptance wins.
- **Values needed:**
  - search radius
  - N
  - offer TTL (the prototype uses 15 s and 30 s inconsistently)
  - sequential or parallel offers
  - maximum attempts
  - the booking outcome when no driver accepts (the customer app has NoDriversAvailable and AssignmentFailed screens)
- **Safe default:** all values are configurable. On exhausting attempts, the booking is cancelled with reason `NO_DRIVER_FOUND`, pending D-01.
- **Owner:** Product + tech lead. **Status:** Open, blocks P3.

### D-31 Service area boundary
- **Context:** a Jodhpur polygon is needed. Who supplies it?
- **Safe default:** with no active service area, bookings are rejected with `OUTSIDE_SERVICE_AREA`.
- **Owner:** Product. **Status:** Open, blocks P3.

### D-32 Location sampling, freshness and retention
- **Context:** M4 leaves these open: how often history is persisted, maximum GPS age, acceptable accuracy, and retention days.
- **Safe default:** all configurable. Starting values get picked after load testing; nothing is presented as final.
- **Owner:** Tech lead. **Status:** Open.

### D-33 Routing and maps provider
- **Context:** M4 says road distance and ETA come from "the approved routing provider". Both apps already call Google Directions and Geocoding from the client.
- **Question:** should the backend call Google server-side for fares and ETAs?
- **Owner:** Product + tech lead. **Status:** Open; affects D-14.

### D-34 Pickup and drop OTP rules
- **Questions:**
  - Length (the prototype uses 4 digits).
  - Expiry.
  - Attempt limit.
  - How each drop's receiver gets their OTP: relayed by the customer, or sent by SMS to `receiver_phone`.
  - Whether delivery needs OTP and photo, or either one. M6 says "OTP / required delivery proof"; the prototype requires both.
- **Safe default:** hashed OTPs, attempt limit with lockout, OTP plus photo required.
- **Owner:** Product. **Status:** Open.

### D-35 Delivery proof requirements
- **Context:** M12 wasn't supplied.
- **Safe default:**
  - A photo is required per drop, in a private S3 bucket.
  - A `delivery_proofs` row holds trip_stop_id, object key, content type, size, captured_at, location and uploaded_by.
  - Type and size limits are configurable.
- **Owner:** Product + tech lead. **Status:** Open.

### D-36 SMS and push providers
- **Context:** which SMS provider, and is DLT registration done (only needed if D-27 is B)? FCM project and credentials for push.
- **Owner:** Tech lead. **Status:** Open.

### D-37 Masked calling and chat provider
- **Context:** M1 lists `call_records` (masked calls, recordings). The customer app has CallDriverScreen and RecordingConsentScreen. No provider is specified.
- **Safe default:** not built in V1 until a provider is chosen.
- **Owner:** Product. **Status:** Open.

### D-38 Backend location and app cutover
- **Context:** the GitHub repo uses one branch per app (Customer, Driver, Engine, engine-v2). The new API isn't compatible with the prototype's endpoints.
- **Proposal:**
  - Create `backend/` as a new branch, `backend-v1`, in the same repo, with versioned `/v1` routes.
  - Keep the prototype running until both apps migrate.
- **Owner:** Tech lead. **Status:** Confirm.

### D-39 Production hosting
- **Context:** the prototype runs on Render. The spec requires S3 (AWS), PostgreSQL with PostGIS and Redis.
- **Question:** where does production run?
- **Owner:** Tech lead. **Status:** Open; not blocking until deploy.

---

## D. Missing source documents

If any of these exist, adding them to `specs/` would settle several decisions above:

| Missing document | Would settle |
|---|---|
| M2 Identity & Customer | D-09 |
| M7 Assignment | D-30 |
| M9 Pricing | D-14 |
| M12 Files / Delivery proof | D-35 |
| M14 Cancellation | D-23 |
| M17 Ratings | – |
| Pick Up SRS & Development Proposal V1 | D-11, D-12, D-13, D-29, D-34 |
| Pick Up Driver Find, Assignment & Delivery Architecture | D-30 |
| Pick Up Nearby Driver Assignment Engine | D-30 |
| Customer + Driver Payment Architecture V1 | D-15 to D-25 |

---

## E. Payments + driver wallet slice (`raj_backend`)

### How earlier decisions were applied

| Decision | In this slice |
|---|---|
| D-05 | Approval statuses as recommended: PENDING, UNDER_REVIEW, APPROVED, REJECTED, SUSPENDED. Only APPROVED drivers can top up. Availability is not part of this slice. |
| D-08 | PW names: `driver_wallets`, `driver_wallet_transactions`. |
| D-09 | Still open. This slice has a minimal `users` table (phone, role, status) plus `auth_identities` (Firebase UID). There is one role per user, so a person can't be both customer and driver yet. |
| D-10 | `payments.status` is PENDING, PAID, FAILED, REFUND_PENDING or REFUNDED. Booking payment status is not built yet. |
| D-25 | Partly resolved: a Razorpay test-mode account is available. Live account ownership and products are still open. |
| D-27 | Firebase ID tokens, agreed before implementation. The backend issues no tokens of its own; email/password login is not supported. |
| D-38 | Done: a new `raj_backend` branch with `/v1` routes. The prototype and team branches are untouched. |
| D-39 | Still open. A Dockerfile keeps every hosting option available. |

### D-40 Wallet top-up limits
- **What's needed:** the minimum and maximum amount per top-up (`WALLET_TOPUP_MIN_PAISE`, `WALLET_TOPUP_MAX_PAISE`), and whether to cap the total wallet balance.
- **Why it matters:** this limits the damage from a stolen account and sets what drivers can load.
- **Safe default:** the minimum defaults to ₹1, Razorpay's own minimum. There is no default maximum: the server refuses to start until one is set. The local `.env` uses ₹10,000 for testing only.
- **Owner:** Business/finance. **Status:** Open, blocks production.

### D-41 Admin accounts
- **What's needed:** who gets admin access, how admin accounts are created and removed, and whether admins need a second factor.
- **Why it matters:** admin endpoints can credit and debit wallets.
- **Safe default:** admins exist only if created with the provisioning CLI using the migrator role. Keep the list to named people.
- **Owner:** Tech lead + business. **Status:** Open, before production.

### D-42 Admin adjustment cap
- **What's needed:** the largest single manual adjustment (`ADMIN_ADJUSTMENT_MAX_PAISE`), and whether large ones need a second approver.
- **Safe default:** required at startup, with no default.
- **Owner:** Finance. **Status:** Open.

### D-43 Payments that can't be applied automatically
- **Context:** some payments are recorded with an anomaly outcome instead of a wallet credit, and logged with `"alert":"PAYMENT_ANOMALY"`:
  - an order the backend didn't create
  - a second payment on an already-paid order
  - an amount mismatch
  - a payment arriving after its top-up failed

  In these cases the money may sit in the Razorpay account with no matching credit.
- **What's needed:** an owner and an ops process. Proposed: review `/v1/admin/reconciliation/webhook-anomalies` daily, and refund or credit by hand (ties to D-22).
- **Owner:** Finance/ops. **Status:** Open, before production.

---

## F. Approved V1 payment, earnings and payout rules (2 Oct 2026)

Nikhil Enterprises approved the V1 money model. It is implemented as given; nothing below reinterprets it.

| Rule | Where it lives |
|---|---|
| 1. Online customer payments go to Nikhil Enterprises through Razorpay, never to a driver's UPI or bank. The backend is the source of truth. | `payments` (purpose BOOKING), `payment_collections` (ONLINE_QR) |
| 2. Driver wallet and driver earnings are separate. The wallet only funds cash-trip fees. Online earnings are paid out weekly to a verified bank account. | `driver_wallets` / ledger vs `driver_earnings`, `driver_payouts` |
| 3. Platform fee = 10% of the confirmed fare, configurable, calculated by the backend, same for cash; the cash fee is debited atomically and the wallet never goes negative. | `fee_rules`, cash collection transaction |
| 4. The customer pays the confirmed fare. `final_fare_minor` = `fare_estimate_minor`. | CHECK + trigger on `bookings` |
| 5. Customer app online payment; or pay at pickup / delivery by booking-linked QR or cash. | booking payments API; collections API |
| 6. Customer payment, driver earning, driver wallet and driver payout are separate records. | four separate tables, no shared balance |
| 7. Existing tables preserved; earnings / payouts / payout items / payout events added; integer paise only. | migration `20261006120000_…` |
| 8. Payouts are idempotent; an earning is never paid twice; a failed payout never marks an earning paid. | `payout_items` partial unique index, triggers, `PayoutStatusService` |
| 9. Official Razorpay APIs, provider logic behind a port, no assumption that payout products are enabled. | `CollectionLinkGateway`, `PayoutGateway`, both disabled by default |
| 10. Earnings → weekly payout → verified bank supersedes MP §34 for earnings. Still no wallet withdrawal or transfer. | no withdrawal endpoint exists |
| 11. Admins can inspect everything; adjustments are authorized, reasoned, audited and ledger-based. | `/v1/admin/*`, `admin_actions` |
| 12. Not added: personal UPI destinations, dynamic fares, customer wallet, wallet withdrawal, driver transfers, undocumented splits/commissions/refund or cancellation fees, taxes/TDS, automatic payout of disputed transactions. | – (TDS fields exist since 6 Oct 2026, always 0: D-57) |

### Earlier decisions this settles

| Decision | Now |
|---|---|
| D-01 | Option B: bookings carry CREATED, SEARCHING_DRIVER, DRIVER_ASSIGNED, COMPLETED, CANCELLED. Execution detail is `trips.status`. |
| D-02 | Option A: the trip is created at assignment, plus CANCELLED. |
| D-03 | Option A: strictly linear statuses (DROP_PROGRESS until the last drop, then DELIVERED). |
| D-06 | Resolved: PREPAID_UPI / PAY_AT_PICKUP / PAY_AT_DELIVERY on bookings; CASH / ONLINE_QR on collections. PREPAID_UPI covers every Razorpay Checkout method. |
| D-07 | Applied: no `driver_id` on bookings (from `trips`), due stage derived from the payment method, M5 column names. |
| D-10 | Applied: booking payment status UNPAID, PAID, REFUND_PENDING, REFUNDED. |
| D-15 | Resolved: 10% PERCENTAGE of the confirmed fare, created as a fee rule (not seeded, not hard-coded). Rounding stays open (D-44). |
| D-17 | Resolved: reject the cash record when the wallet can't cover the fee. The driver recharges and records again. |
| D-18 | Resolved: online trips create a PAYABLE earning; weekly payouts pay it to the driver's verified bank account. |
| D-20 | Resolved: the final fare is the confirmed fare; nothing changes it. |
| D-24 | Partly: booking-linked Razorpay payment link or QR code. The product is D-47. |
| MP §34 | "No withdrawal in V1" is superseded for driver earnings only. Wallet withdrawal still doesn't exist. |

### Behaviour chosen where the rules are silent (please confirm)

- **Fee rule version:** a booking pins the rule in effect when it is confirmed. A later rule change affects only bookings confirmed after it.
- **Category rules:** a rule for the booking's vehicle category beats the default (category-less) rule. V1 needs only the default 10% rule.
- **Earning timing:** superseded by D-45 (6 Oct 2026): an online earning is PAYABLE only once its customer payment's merchant settlement is recorded. A disputed payment's earning is ON_HOLD and is never released automatically, even if the dispute is won.
- **Bank account changes:** superseded by D-49 and assumption B (6 Oct 2026): see section G.
- **Payout failure:** the earnings return to PAYABLE and ride the next batch with a new payout id. A reversal after processing puts them ON_HOLD for an admin and suspends the destination account (assumption C).

### New open decisions

#### D-44 Fee rounding
- **Question:** 10% of an odd fare (₹123.45 = 12345 paise) is 1234.5 paise. Round half up, down or up?
- **Decision (6 Oct 2026):** HALF_UP to the nearest paisa: ₹123.45 × 10% = ₹12.345 → ₹12.35. See [section G](#g-approved-decisions-second-set-6-oct-2026).
- **Owner:** Finance. **Status:** Resolved.

#### D-45 When an earning is "settled" for payout
- **Question:** pay out right after the trip, or only after Razorpay has settled the money to Nikhil Enterprises (usually T+2), or after a fixed holding period?
- **Decision (6 Oct 2026):** only after Razorpay confirms the merchant settlement of the customer payment. No timing (T+2 or other) is assumed. See [section G](#g-approved-decisions-second-set-6-oct-2026).
- **Owner:** Finance. **Status:** Resolved. Automatic execution stays off (`PAYOUT_AUTO_EXECUTE=false`): the scheduler prepares, an admin executes.

#### D-46 Payout account and product
- **Needed:** RazorpayX activation, the business account number, payout IP allowlisting, whether Fund Account Validation (penny drop) is available, and who funds the payout balance.
- **Now:** `PAYOUT_PROVIDER=disabled`; payout and bank-account endpoints answer `503 PAYOUT_PROVIDER_NOT_CONFIGURED`. The payout code is provider-abstracted (`PayoutGateway`); nothing assumes RazorpayX capabilities on the real account. **Production-readiness gate:** `PAYOUT_PROVIDER=razorpayx` is refused in production and with live keys until `RAZORPAYX_CAPABILITIES_CONFIRMED=true`, which may only be set once the Nikhil Enterprises RazorpayX account is activated and Payouts, Fund Account Validation and the webhooks are confirmed on it (with D-58).
- **Owner:** Nikhil Enterprises. **Status:** Open, production-readiness item, blocks payouts.

#### D-47 QR product
- **Options:** Razorpay Payment Links (the driver app shows a QR of the link; works in test mode) or Razorpay QR Codes (UPI QR; must be enabled by Razorpay and can only be paid in live mode).
- **Decision (Raj):** live collection uses Razorpay QR Codes: a single-use, fixed-amount UPI QR that GPay, PhonePe, Paytm or any UPI app scans and pays, confirmed by Razorpay. The payment-link QR is for test mode only; the server refuses `COLLECTION_LINK_PROVIDER=razorpay_payment_link` in production and with live keys. A self-made UPI QR (`upi://pay` to a bank VPA) is ruled out: no booking-level confirmation, refunds or settlement data.
- **Now:** QR Codes is not enabled on the account (probe: `POST /v1/payments/qr_codes` answers "The requested URL was not found on the server"). Development keeps payment links.
- **Owner:** Nikhil Enterprises: request QR Codes activation in the Razorpay Dashboard (test and live). **Status:** Decided; activation pending, production-readiness item.

#### D-48 Payout weekday and time
- **Decision (6 Oct 2026):** every Monday at 11:00 IST. These are now the defaults of `PAYOUT_SCHEDULE_WEEKDAY` (1) and `PAYOUT_SCHEDULE_TIME` (11:00), still configurable per deployment.
- **Owner:** Business. **Status:** Resolved.

#### D-49 Bank account verification
- **Question:** how does an admin confirm the account belongs to the driver (penny drop, cancelled cheque, passbook)? Who may verify?
- **Decision (6 Oct 2026):** RazorpayX bank-account validation (penny drop) records whether the account is active and the bank's registered holder name; an admin approves only on that evidence, with a written resolution when the name is not an exact KYC match. States PENDING_VERIFICATION, VERIFIED, REJECTED, SUSPENDED. See [section G](#g-approved-decisions-second-set-6-oct-2026).
- **Owner:** Finance + ops. **Status:** Resolved. Product availability on the account is D-58.

#### D-50 Collection windows
- **Now:** PAY_AT_PICKUP can be collected from the driver's arrival until delivery; PAY_AT_DELIVERY only after the last drop (D-19). Only completion is blocked without payment.
- **Since payment flow Phases 3–4 (section I):** a PAY_AT_PICKUP booking is collected at the pickup and must be paid before the handover (N2). A PAY_AT_DELIVERY booking priced per drop is collected at each drop, while the driver is there, before that drop's handover. Historical PAY_AT_DELIVERY bookings are still collected after the last drop.
- **Owner:** Product. **Status:** Confirm.

#### D-51 Trip engine integration
- **Needed:** the engine (engine-v2) must call `/v1/internal/*`: register the booking when the customer confirms it, assign, report each status. Who changes the engine, and how the key is shared.
- **Owner:** Tech lead. **Status:** Open, blocks end-to-end use.

#### D-52 Paid bookings that get cancelled
- **Now:** cancellation is allowed and the booking is listed in `/v1/admin/reconciliation/paid-cancelled-bookings`. Nothing is refunded automatically (D-22), and a cash trip's fee debit stays.
- **Owner:** Finance. **Status:** Open.

#### D-53 QR and cash paid together
- **Risk:** the customer pays the QR at the same moment the driver records cash. The server closes the QR before accepting cash and refuses cash if the QR was paid, but a UPI payment already in flight can still land. It is flagged as an anomaly for a manual refund.
- **Owner:** Ops. **Status:** Accept or add a rule.

#### D-54 Minimum payout
- **Now:** a driver whose total payable is under ₹1 (RazorpayX's minimum) waits for the next week.
- **Owner:** Finance. **Status:** Confirm.

#### D-55 Taxes on driver payouts
- **Superseded by D-57** (TDS-ready architecture, policy DISABLED until the CA confirms the rule).

---

## G. Approved decisions, second set (6 Oct 2026)

Raj confirmed these for Nikhil Enterprises. They are implemented as given (migrations `20261007120000_earning_awaiting_settlement` and `20261007120100_settlements_bank_validation_tds`).

| Decision | Implementation |
|---|---|
| **Rounding (D-44):** HALF_UP to the nearest paisa, no floating point, one shared utility. ₹123.45 × 10% = ₹12.345 → ₹12.35. | `src/common/money.ts` (`divideHalfUp`, `percentOfPaise`), used by the fee calculator and reserved for TDS. `fee_rules.rounding_mode` CHECK = `HALF_UP`; the API and CLI refuse any other mode. |
| **Payable only after merchant settlement (D-45):** not at app success, capture, callback or trip completion. | ONLINE earnings start `AWAITING_SETTLEMENT`; a `payment_settlements` row (Razorpay settlement reconciliation: `settled = true`, settlement id, amount equal to ours) makes them `PAYABLE`. CHECK: an ONLINE earning can't be PAYABLE, IN_PAYOUT or PAID without a settlement. No settlement timing is assumed. |
| **Payout schedule (D-48):** every Monday 11:00 IST, configurable. | `PAYOUT_SCHEDULE_WEEKDAY=1`, `PAYOUT_SCHEDULE_TIME=11:00`, `PAYOUT_SCHEDULE_TIMEZONE=Asia/Kolkata` (defaults). The scheduler pulls settlements first, then prepares one batch per ISO week (`schedule:<week>`). `GET /v1/admin/payout-schedule` shows the last and next run. |
| **Batch contents:** only eligible earnings; never unsettled, disputed/held, already paid, or in another live batch; atomic; no earning in two batches; asynchronous reconciliation; PAID only after provider confirmation. | Eligibility = `PAYABLE` + settlement link + payable at or before the cutoff + driver's account `VERIFIED`. One transaction; partial unique index on live payout items; `PROCESSED` from the provider is the only path to `PAID`. |
| **Bank account verification (D-49):** holder name, account number, IFSC; RazorpayX validation; admin approval on an active account whose name sufficiently matches KYC, with no unresolved mismatch. States PENDING_VERIFICATION, VERIFIED, REJECTED, SUSPENDED. | `bank_account_verifications` stores provider, validation id (fav_), status, account status, registered name, provider score, our name-match result (MATCH / PARTIAL / MISMATCH / UNAVAILABLE) and the KYC name compared, UTR, timestamps. Approval needs a completed ACTIVE validation; a non-MATCH needs `mismatchResolution` (stored and audited). The database enforces it too (trigger). The full account number is never stored. |
| **Account changes (assumption B):** the old account must not silently stay the destination; the new one is validated and approved again. | A new submission suspends the VERIFIED account at once (`REPLACED_BY_NEW_ACCOUNT`, audited); nothing is paid until the new account is approved. A replaced account can never be reinstated. A second submission while one is pending is refused (`BANK_ACCOUNT_CHANGE_PENDING`). Since section H a submission needs a step-up OTP. |
| **Fee rule snapshot (assumption A).** | Bookings pin `fee_rule_id` at confirmation; earnings copy it. Unchanged. |
| **Reversed payout (assumption C):** hold for review, no duplicate payout, reversal reconciled, admin review before payable again, no silent retry. | Items `REVERSED`, earnings `ON_HOLD`, destination account `SUSPENDED` (`PAYOUT_REVERSED`). Releasing the earning makes it payable, but no batch pays a suspended account; reinstating it needs a new bank validation started after the suspension. |
| **TDS architecture:** `TDS_ENABLED=false`, TDS amount 0, versioned rule, backend-only, snapshotted, immutable, never client-supplied. | Earnings and payouts carry `other_deductions_paise`, `tds_amount_paise`, `tds_policy` (`DISABLED`) and `tax_rule_id` (NULL); CHECKs tie net = gross − fee − other − TDS. `tax_rules` is versioned, empty, and read-only for the API role. `TDS_ENABLED=true` is refused at startup. Unknown request fields (`tdsRate`, `tdsAmount`, `netPayable`) are rejected with 400. |
| **Separate records:** customer payment, merchant settlement, driver earning, driver payable, driver payout, driver wallet. | `payments` / `payment_collections`, `payment_settlements`, `driver_earnings` (status `PAYABLE` is the payable), `driver_payouts` + `payout_items`, `driver_wallets` + ledger. No shared balance. |
| **Weekly payout is not a wallet withdrawal.** | The wallet still only funds cash-trip fees. No withdrawal endpoint. |
| **Prove the backend with API calls before UI work.** | `npm run e2e:local` (see `docs/RAZORPAY_INTEGRATION.md` §16): the ₹500 example end to end, 11 steps plus idempotency checks. |

### New open decisions

#### D-56 Settlement reconciliation on the live account
- **Context:** Razorpay test mode does not settle payments. The probe on 6 Oct 2026 (test keys) got HTTP 200 with empty lists from `/v1/settlements` and `/v1/settlements/recon/combined`, so the field values have only been checked against the documentation.
- **To verify on the live account:** that `type=payment` entries report `settled`, `settled_at`, `settlement_id` and `amount` as documented; which time zone the `year/month/day` filter uses (the sync scans a look-back window of India dates, default 7 days, so either answer is covered); and how instant or on-demand settlements appear, if Nikhil Enterprises uses them.
- **Until then:** an ONLINE earning stays `AWAITING_SETTLEMENT` (safe: nothing is paid). `GET /v1/admin/settlements/overdue-earnings` lists earnings still waiting after `SETTLEMENT_OVERDUE_DAYS` (5).
- **Production-readiness gate:** `SETTLEMENT_PROVIDER=razorpay` is refused in production and with live keys until `SETTLEMENT_RECON_VERIFIED=true`, set only after the checks above pass on the live account. Until then production runs with `SETTLEMENT_PROVIDER=disabled`.
- **Owner:** Tech lead + finance. **Status:** Open, production-readiness item, verify before go-live.

#### D-57 TDS on driver payouts
- **Question:** Confirm with CA whether driver payouts require TDS/tax deduction and, if applicable, the exact rule.
- **Now:** the policy is DISABLED: TDS is 0 on every earning and payout, no tax rule exists, and `TDS_ENABLED=true` is refused at startup. When the CA confirms a rule, it becomes a versioned `tax_rules` row (CA approval reference required) and the calculation goes into `src/common/deductions.ts` with the shared HALF_UP utility.
- **Owner:** Nikhil Enterprises (CA). **Status:** Open, before go-live.

#### D-58 RazorpayX bank validation availability
- **Needed:** whether Fund Account Validation is enabled on the RazorpayX account (it is not available in test mode), its per-validation fee, the payout IP allowlist, and whether the `fund_account.validation.*` webhooks are configured. Whether RazorpayX Lite / current account supports it is unconfirmed.
- **Now:** implemented against the documented API (`POST /v1/fund_accounts/validations` on the existing fund account, penny drop of ₹1); results arrive by webhook or `POST /v1/admin/bank-accounts/:id/validations/:validationId/refresh`. Not assumed available: covered by the `RAZORPAYX_CAPABILITIES_CONFIRMED` gate (D-46).
- **Owner:** Nikhil Enterprises. **Status:** Open, production-readiness item, blocks real bank validation (part of D-46).

#### D-59 Source of the KYC legal name
- **Context:** the bank's registered name is compared with `drivers.legal_name`. M3 (driver KYC) is not part of this slice.
- **Now:** ops sets it from the approved KYC documents with `provision.js set-legal-name` (or `create-driver --name`); every change is audited. An account can't be approved while it is missing (`DRIVER_KYC_NAME_MISSING`).
- **Owner:** Product + ops. **Status:** Open until M3 owns it.

#### D-60 Name matching strictness
- **Decision (section H):** keep the partial-match handling, but any non-exact match always needs an explicit admin resolution with an audit record.
- **Now:** MATCH = exactly the same words in the same order, ignoring only case, punctuation, accents and honorifics. Reordered words, initials and a missing middle name are PARTIAL; anything else MISMATCH; a missing name UNAVAILABLE. Every non-MATCH needs an admin's written resolution (API and database) and writes a `BANK_NAME_MISMATCH_RESOLVED` audit row with the bank's name, the KYC name, the result, the validation and the resolution. The provider's own score is stored but not used to decide.
- **Owner:** Ops. **Status:** Resolved.

#### D-61 Who may change a bank account
- **Decision (section H):** the driver may start a change in the app, but changing the payout destination needs a step-up OTP on top of the session: request → step-up OTP → new account validation → admin approval → payout eligible. A compromised session alone must never redirect payouts.
- **Now:** implemented as a change request bound to a Firebase phone re-authentication (details in section H). Also required for the first bank account, since that sets the payout destination too.
- **Owner:** Ops. **Status:** Resolved.

#### D-62 Settlement that never arrives
- **Decision (section H):** kept as designed. No manual "mark as settled" operation exists; an earning with no valid settlement stays `AWAITING_SETTLEMENT` (unpaid) and is listed by `GET /v1/admin/settlements/overdue-earnings` after `SETTLEMENT_OVERDUE_DAYS` for admin review.
- **Owner:** Finance. **Status:** Resolved.

---

## H. Approved decisions, third set (after commit `f07ff5c`)

Raj accepted the payment, settlement, earnings, wallet and payout architecture for V1 and asked for the items below before the Driver App collection and earnings screens. Migration `20261008120000_bank_account_change_requests`.

| Decision | Implementation |
|---|---|
| **Step-up for a bank-account change (D-61):** request → step-up OTP → new account validation → admin approval → payout eligible. The old verified account may be suspended when the change is accepted; the new one is not payout-eligible until validated and approved. A compromised session alone must never redirect payouts. | `bank_account_change_requests`. (1) The session creates a request (no details; 10-minute window from the database clock). (2) The app re-authenticates the Firebase user with a phone OTP. (3) The fresh ID token confirms the request with the details: `auth_time` must be after the request, `phone_number` must be the registered phone, `sign_in_provider` must be `phone` (`403 STEP_UP_REQUIRED` otherwise, audited). In one transaction the request is verified, the old VERIFIED account suspended (`REPLACED_BY_NEW_ACCOUNT`), the new account added as `PENDING_VERIFICATION` and the request completed. Then bank validation and admin approval as before (D-49). |
| Why `auth_time` works | A stolen session (ID token or refresh token) can only mint refreshed tokens, and Firebase keeps `auth_time` on refresh; only a real sign-in or re-authentication moves it. So the OTP must happen after the request, which a hijacked session cannot do without the driver's phone. Firebase's own guidance uses `auth_time` the same way against token theft. |
| Database enforcement | A bank account is only inserted for a `STEP_UP_VERIFIED` request of the same driver (trigger). The trigger accepts the verification only inside the window, with `step_up_auth_time > created_at` (CHECK) on the driver's registered phone; a verified request can't be committed without its account (deferred check). The window can't be backdated or extended; requests and their binding to the account are immutable; the API role has no grant on `created_at`, `expires_at`, `driver_id` or `change_request_id`. Accounts submitted before this migration that were never approved are suspended (`STEP_UP_REQUIRED`) and can never be approved. |
| Stricter than asked | The first bank account also needs the step-up (it sets the payout destination too). Requesting a change alone changes nothing; the old account is suspended only at confirmation. |
| Residual risk | Someone holding the unlocked phone itself can pass an SMS OTP. The admin approval of every new account on a bank validation, with a written resolution for any name that is not an exact KYC match, is the control for that case. |
| **RazorpayX (D-46, D-58):** provider-abstracted; capabilities not assumed until the account is activated and confirmed. | `PayoutGateway` port unchanged. `RAZORPAYX_CAPABILITIES_CONFIRMED` (default false) gates `PAYOUT_PROVIDER=razorpayx` in production and with live keys. |
| **Settlement recon (D-56)** stays an explicit open item. | `SETTLEMENT_RECON_VERIFIED` (default false) gates `SETTLEMENT_PROVIDER=razorpay` in production and with live keys. The startup log lists every open readiness item. |
| **Name matching (D-60):** partial matches kept; every non-exact match needs an explicit admin resolution with an audit record. | Reordered words are now PARTIAL, not MATCH. `BANK_NAME_MISMATCH_RESOLVED` audit row per non-exact approval (both names, result, validation, resolution); `BANK_ACCOUNT_APPROVED` carries the same evidence. |
| **Missing settlement (D-62):** no manual "mark as settled". | Unchanged: unpaid, `AWAITING_SETTLEMENT`, listed as overdue for admin review. |
| Switching back to an earlier account | RazorpayX returns the existing contact and fund account for identical details, so the fund-account uniqueness now applies to live (pending or verified) accounts only. The new row is validated and approved from scratch. |

---

## I. Payment flow Phase 1 (PAY AT PICKUP + per-drop PAY AT DELIVERY)

Raj approved the architecture in [PAYMENT_FLOW_FINAL_REVIEW.md](./PAYMENT_FLOW_FINAL_REVIEW.md) and confirmed N1–N11. Phase 1 is migration `20261015120000_booking_quote_snapshot`; a database that doesn't have them yet also gets `20261014120000_customer_self_registration` and `20261014120100_fare_quotes` first. Upgrade steps: [DATABASE_SETUP.md](./DATABASE_SETUP.md#customer-self-registration-fare-module-and-booking-snapshot-payment-flow-phase-1).

| Decision | Implementation |
|---|---|
| **Existing bookings keep their model (N3).** No stops are backfilled; stored values and collection behaviour don't change. | Every existing booking is `LEGACY_BOOKING_LEVEL`; that marker is the only backfill (a column default during the migration, dropped right after). Legacy bookings have no stops and keep their engine-sent fare, their pinned fee rule (fee computed from it, as before) and the whole-booking collection. `npm run db:migration-check` proves on copies of the dev, e2e and test-data databases that no pre-existing row changes and every booking is LEGACY. |
| **New bookings are priced from a quote.** | `QUOTE_PER_STOP`. Registration redeems the quote once (unexpired, same customer) and freezes its fare, tax, payable amount, pricing version and the fee of the rule in effect, plus one `booking_stops` row per quoted drop with that drop's payable amount and its share of the fee. The database checks that the booking copies the quote and was redeemed for it at confirmation, that the fee is the pinned rule's fee, and (at commit) that the stops add up to the booking. None of it can change afterwards, even for the table owner. |
| **PREPAID_UPI is not offered to new bookings (N4).** | Registration answers `422 PAYMENT_METHOD_NOT_OFFERED`; the database refuses the row (insert guard and a CHECK). |
| **Historical PREPAID_UPI bookings keep Checkout, and only they do (N4).** | Start, verify, the webhook and the admin sync apply a booking payment only to a `LEGACY_BOOKING_LEVEL` + `PREPAID_UPI` booking. The code checks it at start and verify, before capturing an authorized payment, and in the finalizer (`BOOKING_NOT_PAYABLE` otherwise, logged as a payment anomaly). The database refuses a booking payment row for any other booking. Ownership and signature checks are unchanged. |
| **Pickup gate also for legacy PAY_AT_PICKUP bookings (N2).** | Done in Phase 3 (below). |
| **Completion with undelivered drops (N5).** | Phase 4 (below): the trip completes PARTIALLY_PAID and earns what was collected. The driver-pay treatment of such a trip is Phase 5. |
| **Failed payout → ON_HOLD, explicit release (N10).** | Phase 7, not built yet. |
| **Removing the legacy code (L-22).** | Open. Only after no environment has unfinished legacy bookings. |
| **Non-local databases (N1).** | Blocked until `prisma/sql/preflight-payment-flow.sql` has been run there and its output reviewed. Phase 1 is applied to the local dev database only. |

**Temporary restriction until Phase 4 (technical, not policy; replaced in Phase 4 by a narrower production restriction, below).** Per-drop collection isn't built yet, so a new (`QUOTE_PER_STOP`) PAY_AT_DELIVERY booking can't be collected: the API answers `409 COLLECTION_NOT_ALLOWED` (`details: { stage: "DELIVERY", perStop: true }`), the database refuses the collection row, and the driver view shows `collectionOpen: false`. Such a booking registers and dispatches but can't complete (payment gate). Don't take real PAY_AT_DELIVERY bookings before Phase 4. New PAY_AT_PICKUP bookings work end to end.

**Technical defaults introduced in Phase 1.** Each is configurable or replaceable later; none is a business decision.

| Default | Where | Decision it waits for |
|---|---|---|
| At most 5 drops per quote (`FARE_MAX_DROPS`, range 1–25) | config, `422 TOO_MANY_DROPS` | D-29 / N7 |
| Database ceiling of 25 drops | CHECKs on `fare_quote_stops`, `booking_stops` | technical only |
| Tax must be 0: a quote with tax can't be booked (`422 TAX_NOT_SUPPORTED`) | registration, CHECKs | L-2 |
| The frozen fee is attributed to the drops by largest remainder of each drop's fare (ties to the lower sequence); the shares always add up to the fee, and the fee charged doesn't change | `src/bookings/fee-allocation.ts`, deferred database check | implementation detail |
| `PROTOTYPE*` pricing versions refused in production by the admin API as well as the CLI | `createPricingVersionRecord` | L-1 |
| No canonical vehicle category list; format check only | quotes, fee rules | D-28 / N6 |

### Phase 2: per-stop obligation schema

Raj approved and locked Phase 1, then asked for Phase 2 only. Migration `20261016120000_per_stop_obligation_schema` prepares the schema for collecting a PAY_AT_DELIVERY booking drop by drop. It enables nothing and changes no existing row. Upgrade steps: [DATABASE_SETUP.md](./DATABASE_SETUP.md#per-stop-obligation-schema-payment-flow-phase-2).

| Requirement | Implementation |
|---|---|
| **Existing rows stay exactly as they are; historical bookings get no stops (N3).** | The migration adds nullable columns, constraints, indexes and guard rules. PostgreSQL validates each new constraint against the existing rows, and no row is updated. `npm run db:migration-check` proves it on copies of four databases with data: row fingerprints over every table, through up / down / down / up. |
| **All new bookings are `QUOTE_PER_STOP`.** | Unchanged from Phase 1 (insert guard). The upgrade test checks it again on an upgraded database. |
| **In-flight historical bookings still finish (`TAB-QR-001` style).** | `legacy-migration.int-spec.ts` builds a database at the level before Phase 1 and seeds bookings in flight: a pending QR, an expired QR, an unpaid cash delivery, an open Checkout order and a pickup booking at the pickup. It applies Phases 1 and 2, then finishes each booking through the API. On the dev database, `TAB-QR-001` and every other row are identical before and after the migration. |
| **Stop lifecycle facts.** | `booking_stops` gets `arrived_at`, `payment_confirmed_at`, `delivered_at`, `failed_at` with `failure_reason`, `cancelled_at`, and an admin's resolution (`resolved_at`, `resolved_by_user_id`, `resolution_reason`). CHECKs tie each status to its facts, following the approved stop state machine (review E): a PENDING stop has none, UNDELIVERED needs a failed attempt and a complete resolution, and a stop can be CANCELLED without being reached. At most one stop per booking is current (ARRIVED or PAYMENT_CONFIRMED). Stops still can't change: `guard_booking_stop_update` stays as it is until Phase 3. |
| **A collection is tied to its obligation.** | `payment_collections.booking_stop_id`, with a composite FK that allows only a stop of the same booking. A pickup collection never names a stop, and the stop of a collection never changes. Live collections: one per booking-level obligation (pickup and historical bookings, exactly the old rule) and one per drop. The insert guard keeps all of a booking's collections of one kind and still refuses per-drop collections. |
| **Financial constraints and grants are not weakened.** | No CHECK, trigger rule or grant is removed or relaxed. The old live-collection index is dropped only after its replacement exists, and the replacement applies the old rule to every collection that can exist. The API role gets no new privilege; three new least-privilege refusals cover the new columns. |
| **Non-local databases (N1).** | Still blocked until the preflight has been run there and its output reviewed. Phase 2 is applied to the local dev database only, after its preflight was reviewed. |

**Not in Phase 2.** These are Phase 3: the stop transition guard, the pickup gate, `paymentGate`, the trip DELIVERED rule and admin stop resolution. Per-drop amounts and fee shares on collections, one ledger key per collection and `PARTIALLY_PAID` are Phase 4. MIXED earnings are Phase 5. The temporary restriction above still applies: a new PAY_AT_DELIVERY booking can't be collected until Phase 4.

**Technical defaults introduced in Phase 2.** None is a business decision.

| Default | Where | Decision it waits for |
|---|---|---|
| Failure and resolution reasons are 3–200 characters after trimming, the same rule as a booking cancellation reason and the approved stop API (review D) | CHECK `booking_stops_reasons_not_blank`, `VARCHAR(200)` | none; Phase 3 validates it in the API too |
| No ordering between the stop timestamps in the database | — | Phase 3: a retry after a failed attempt records a later arrival. Whether a retry keeps the earlier failure facts is also Phase 3's choice; the CHECKs allow both. |
| A booking's collections are all for the whole booking or all per drop | `guard_collection_insert` | implementation detail; keeps the old one-live-collection rule for every existing obligation |

### Phase 3: payment gate and stop lifecycle

Raj approved and locked Phase 2, then asked for Phase 3 only. Phase 3 adds migration `20261017120000_payment_gate_stop_lifecycle` (it changes rules only: no new column, no row touched) and the code that enforces the same rules. Upgrade steps: [DATABASE_SETUP.md](./DATABASE_SETUP.md#payment-gate-and-stop-lifecycle-payment-flow-phase-3).

| Requirement | Implementation |
|---|---|
| **PAY_AT_PICKUP is paid before the pickup handover, for every booking model (N2).** | An unpaid trip at DRIVER_ARRIVED gets `409 PAYMENT_REQUIRED { stage: PICKUP, amountPaise }` for PICKUP_VERIFIED or anything later. A booking priced per drop can't start (IN_TRANSIT) unpaid either. `guard_trip_change` refuses the same moves for every role, the table owner included. A historical trip that passed the pickup unpaid before this phase carries on, and its collection window is unchanged. |
| **paymentGate.** | Derived on every read, never stored, following the approved derivation table (review E). The engine view is on every internal booking response and the driver view on `/v1/trips`. The customer view, without ids or the fee, is on `/v1/bookings/:id`. |
| **Stop state machine, current drop.** | `POST /v1/internal/trips/:tripId/stops/:sequence/status` takes ARRIVED (also the retry of a failed attempt), DELIVERED, or DELIVERY_FAILED with a reason. Drops are reached in order, only while the trip is under way, with at most one current drop. Repeats are no-ops. `guard_booking_stop_update` enforces the same rules, writes each fact only with its transition, and refuses any change that isn't a transition. `uq_booking_stops_current` backs the one-current-drop rule. |
| **PAY_AT_DELIVERY: a drop is handed over only once it is paid.** | DELIVERED needs the drop to be PAYMENT_CONFIRMED, and the database allows that only with a COMPLETED collection for that drop. Otherwise the answer is `409 PAYMENT_REQUIRED { stage: DROP, stopSequence, amountPaise }`. Nothing in Phase 3 confirms a drop's payment: the API role has no grant on `payment_confirmed_at`, and per-drop collection is Phase 4. |
| **Trip DROP_PROGRESS and DELIVERED for bookings priced per drop.** | The backend sets DROP_PROGRESS when the first drop is reached, and DELIVERED when every drop is delivered, undelivered or cancelled (then PAYMENT_CONFIRMED straight away if the booking is paid). An engine report of DROP_PROGRESS gets `409 STOP_REQUIRED`, and DELIVERED gets `409 STOPS_PENDING { pendingStops }` (a no-op once reached). The database enforces both. |
| **Admin stop resolution.** | `POST /v1/admin/bookings/:id/stops/:sequence/resolve { resolution: RETRY \| UNDELIVERED, reason }` writes BOOKING_STOP_RETRY or BOOKING_STOP_UNDELIVERED to `admin_actions` in the same transaction. The database requires an active ADMIN as the resolver and, at commit, the UNDELIVERED audit record from that same transaction. |
| **Cancellation.** | Cancelling a booking cancels its unfinished drops. Delivered and undelivered drops keep their outcome, and nothing moves afterwards. |
| **Historical bookings keep their behaviour.** | Apart from N2: no stops, the engine-reported trip order, and the whole-booking collection after delivery. The migration check shows every row unchanged on four databases with data. On dev, every row is identical, `TAB-QR-001` included. |
| **Least privilege.** | The API role gets UPDATE on the stop lifecycle columns only: status, arrival, delivery, failure, cancellation, resolution and `updated_at`. Amounts, references and `payment_confirmed_at` stay ungranted. The database's guards apply to the API role exactly as to the owner. |
| **Non-local databases (N1).** | Still blocked until their preflight has been run and reviewed. Phase 3 is applied to the local dev database only, after its preflight was reviewed. |

**Consequences of the approved rules (technical, not policy).**
- A failed drop holds back the next one until it is retried or an admin resolves it: a drop is reached only once every earlier drop is finished.
- A PAY_AT_DELIVERY booking priced per drop can't be paid until Phase 4, so its drops can't be delivered yet. The restriction above still applies: don't take real PAY_AT_DELIVERY bookings before Phase 4.
- A trip whose drops all ended undelivered is DELIVERED but can't complete, because nothing was collected. An admin cancels it (N5).

**Not in Phase 3.**
- Phase 4: cash and QR collection per drop, the finalizer confirming a drop's payment, `PARTIALLY_PAID`, and fee debits per collection.
- Phase 5: MIXED earnings and payout changes.
- Phase 6: refunds.

**Technical defaults introduced in Phase 3.** None is a business decision.

| Default | Where | Decision it waits for |
|---|---|---|
| A retry records a new arrival time and keeps the last failure (time and reason); a second failure replaces it | stop guard, `BookingStopsService` | none (settles the Phase 2 open point) |
| A repeated admin RETRY or UNDELIVERED changes nothing and writes no second audit record | admin API | none |
| An admin's resolution reason is 3–200 characters, like a failure reason | DTO, CHECK `booking_stops_reasons_not_blank` | none |
| The engine sends a reason only with DELIVERY_FAILED; anything else with a reason is `400` | internal API | none |
| Gate for a failed drop: handover not allowed; NOT_YET while unpaid, PAYMENT_CONFIRMED if paid | `payment-gate.ts` | none |
| Customers see a failed attempt that may still be retried as ARRIVED (or PAID), and NOT_DELIVERED only once an admin resolved it | `payment-gate.ts` | none |
| Gate for historical PREPAID_UPI bookings: reports the in-app payment; their handovers stay ungated, as before | `payment-gate.ts` | L-22 |
| The IN_TRANSIT payment check applies to bookings priced per drop only, so historical trips already past the pickup unpaid can carry on | `guard_trip_change` | N2 covers leaving DRIVER_ARRIVED only |

### Phase 4: collections per obligation

Raj approved and locked Phase 3, then asked for Phase 4 only. Phase 4 adds two migrations: `20261018120000_partially_paid_mixed_enums` (two enum values, nothing else) and `20261018120100_obligation_collections` (rules and one new table; no row touched). It also adds the code that enforces the same rules and one grant change. Upgrade steps: [DATABASE_SETUP.md](./DATABASE_SETUP.md#collections-per-obligation-payment-flow-phase-4).

| Requirement | Implementation |
|---|---|
| **One obligation per collection, resolved on the server.** | PAY_AT_PICKUP: the booking, at the pickup. PAY_AT_DELIVERY priced per drop: the drop the driver is at (ARRIVED, not paid yet). `stopSequence` is required (`422 STOP_REQUIRED`) and checked against the current drop, never taken on trust. Historical bookings: the whole booking, as before. `resolveObligation` checks the booking, trip, method, stage, current drop, amount, state and ownership. |
| **The amount comes from the frozen booking; the app's amount is only an echo.** | The pickup is owed the frozen payable, a drop its own frozen payable. Another amount is `422 COLLECTION_AMOUNT_MISMATCH { expectedPaise }`. Another drop or a future one is `409 COLLECTION_NOT_ALLOWED { reason: NOT_CURRENT \| STOP_ALREADY_PAID, stopSequence, currentStop, … }`, and a missing drop `404 STOP_NOT_FOUND`. A paid booking is `409 BOOKING_ALREADY_PAID`, a closed one `409 BOOKING_CLOSED`. `guard_collection_insert` refuses the same rows for every role, the table owner included. |
| **Cash: idempotent, the wallet debited exactly once, never negative.** | `Idempotency-Key` is required; a retry returns the same collection (`replayed: true`). The obligation's frozen fee (the booking's fee at the pickup, the drop's fee share at a drop) is debited in the collection's own transaction. Locks follow the approved order: booking → trip → stops → collection → wallet. A shortfall is `409 INSUFFICIENT_BALANCE` and records nothing. Bookings priced per drop have one ledger key per collection; historical bookings keep one per booking. The database requires the debit to be the collecting driver's own CASH_RIDE_FEE of exactly that fee. No provider call is made inside the transaction. |
| **QR: one live QR per obligation, confirmed by the provider.** | A QR is made for one obligation. Its reference is the collection id, and its notes carry `collection_id`, `booking_id`, `stage` and, for a drop, `booking_stop_id` and `stop_sequence`. Asking again shows the same open QR, and an expired one is replaced. Cash closes an open QR first, and a drop's open QR is closed when that delivery attempt fails. The webhook (`qr_code.credited`, `payment.captured`), the driver's refresh and the admin sync all re-read the QR from the provider and go through one finalizer, which locks booking → trip → stops → collection and checks what the obligation is owed. A repeat is `ALREADY_APPLIED`. A stale QR never pays another obligation: money on a closed QR is not applied and is flagged (`PAYMENT_NOT_PENDING`). |
| **UNPAID → PARTIALLY_PAID → PAID, set only by financial finalization.** | `applyCollectionCompleted` confirms the drop's payment (ARRIVED → PAYMENT_CONFIRMED), and the booking takes the status its completed collections give it. The database enforces the same with `guard_booking_update` and the deferred `trg_collections_effects`, both using `booking_collected_status`. A booking priced per drop is PAID or PARTIALLY_PAID only when its collections say so, only such a booking can be PARTIALLY_PAID, and a completed drop collection confirms its drop in the same transaction. |
| **An unpaid drop is never DELIVERED; one drop's payment never covers another.** | The Phase 3 gate, now reachable: DELIVERED needs a COMPLETED collection for that drop itself. |
| **Earnings know their collections (any mix of cash and QR).** | New table `earning_collections` has one row per collection that funds an earning (method, amount, fee share). Rows are written with the earning in its transaction, never change and are never deleted. With one collection, the earning keeps its single source (`collection_id`) and gets one link row. With several, `collection_id` and `payment_id` are null. Gross is the sum collected and the fee the sum of the fee shares, checked at commit (`trg_earnings_sources`). The settlement is CASH (`SETTLED_IN_CASH`) when every drop was paid in cash, ONLINE when every drop was paid online, and MIXED otherwise. ONLINE and MIXED earnings start `AWAITING_SETTLEMENT`. |
| **Payout scheduling and bank logic unchanged (Phase 5).** | An earning funded by several collections is never made payable in Phase 4. The settlement sync records each QR's settlement, but `applySettlement` answers `SEVERAL_COLLECTIONS`, and payout batches take only earnings their settlement made payable. |
| **Historical bookings keep their behaviour (N3).** | They keep one collection for the whole booking, single-source earnings and the per-booking ledger key. No stops are invented. The migration check and the dev database show every row unchanged, `TAB-QR-001` included. |
| **Least privilege.** | The API role gets UPDATE on `booking_stops.payment_confirmed_at`, which the stop guard allows only with that drop's COMPLETED collection. It also gets SELECT and INSERT on `earning_collections`. |
| **Non-local databases (N1).** | Still blocked until their preflight has been run and reviewed. Phase 4 is applied to the local dev database only, after its preflight was reviewed. |

**Production restriction until Phase 5 (technical, not policy).** It replaces the Phase 1 restriction above. New PAY_AT_DELIVERY bookings are collected drop by drop, in cash or by QR, and they complete, but they aren't all paid out yet:
- All-cash multi-drop PAY_AT_DELIVERY bookings may work through the current backend flow. Each drop is collected in cash at the drop, and the earning is settled in cash.
- Single-drop PAY_AT_DELIVERY bookings paid by QR work. They have one collection, so the ONLINE earning becomes payable once Razorpay settles the payment, as before. PAY_AT_PICKUP bookings (cash or QR) are also one collection and work.
- Multi-drop PAY_AT_DELIVERY bookings containing a QR drop must stay blocked in production until Phase 5 makes earnings funded by several collections correctly payable and settleable. Today their earning (ONLINE or MIXED) is recorded with every source but never becomes payable. The backend doesn't refuse such a QR yet, so the restriction is operational: don't take these bookings for real.

**Consequences of the approved rules (technical, not policy).**
- A drop left undelivered and unpaid keeps the booking PARTIALLY_PAID. The trip still completes once every drop is finished (N5), and the earning counts only what was collected. A trip where nothing was collected still can't complete; an admin cancels it.
- For an earning funded by several collections, the driver's summary shows the whole net as awaiting settlement, including the cash drops' share the driver already holds. Phase 5 splits it.
- The admin booking chain's `merchantSettlement` shows the booking's first settlement only. Each collection's settlement is Phase 5.

**Not in Phase 4.**
- Phase 5: per-collection settlement gating, the payout amount of an earning funded by several collections, the split summary, and the driver's pay for a partly delivered trip.
- Phase 6: refunds (paid then cancelled bookings, paid drops resolved as undelivered, money on closed QRs).
- The apps, engine-v2 and the admin UI.

**Technical defaults introduced in Phase 4.** None is a business decision.

| Default | Where | Decision it waits for |
|---|---|---|
| Fee ledger key per collection for bookings priced per drop, `cash-ride-fee:collection:<collectionId>`; historical bookings keep `cash-ride-fee:<bookingId>`. `reference_type` stays BOOKING, and the metadata carries `collectionId` and `stopSequence` | `CollectionsService` | none |
| A drop's open QR is closed (`DROP_DELIVERY_FAILED`) when its attempt fails. A payment that raced the close is recorded for that drop, and the paid retry confirms it | internal stop API, `BookingStopsService` | none |
| Money for a drop resolved as undelivered meanwhile is recorded for that drop and flagged `PAID_FOR_CLOSED_DROP` | finalizer | Phase 6 (refunds) |
| ONLINE and MIXED earnings funded by several collections stay `AWAITING_SETTLEMENT` | `EarningsService.applySettlement` | Phase 5 |
| Gross is what was collected (an undelivered unpaid drop adds nothing), and the fee is the collected fee shares | `earningFunding`, `trg_earnings_sources`, `GROSS_NOT_BOOKING_FARE` | N5 driver-pay treatment (Phase 5) |
| `stopSequence` missing for a booking paid drop by drop: `422 STOP_REQUIRED`. Sent for a whole-booking obligation: `400 VALIDATION_FAILED` | collections API | none |
| Simulated QR codes for local end-to-end runs (`COLLECTION_LINK_PROVIDER=simulated`, `POST /v1/dev/simulate/qr-codes/:qrCodeId/payments`), refused in production and with live keys | config, `SimulatedCollectionLinkGateway` | none |
