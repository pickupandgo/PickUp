# Database Setup (Cloud PostgreSQL)

For whoever creates and owns the cloud database. The steps use AWS RDS. Any managed PostgreSQL 17 works the same way; only the console screens and the TLS certificate differ.

The database holds real money records. Three rules matter most:

- the API never connects as an admin
- nobody edits ledger rows
- every schema change goes through a migration

## 1. Create the instances

Create two separate instances: **staging** (Razorpay test keys) and **production** (live keys). Never share one between them.

| Setting | Value |
|---|---|
| Engine | PostgreSQL 17 (latest 17.x minor version) |
| Region | Asia Pacific (Mumbai) `ap-south-1`, closest to Jodhpur |
| Availability | Production: Multi-AZ. Staging: single-AZ is fine. |
| Storage | gp3, **encryption on**, storage autoscaling on |
| Public access | **No.** Allow port 5432 only from the backend's security group. |
| Initial database name | `multipleride` |
| Master credentials | "Manage master credentials in AWS Secrets Manager" |
| Backups | Automated backups on. Retention is per OPEN_DECISIONS D-26; RDS allows up to 35 days. |
| Deletion protection | On |
| Parameter group | Keep `rds.force_ssl = 1` so every connection uses TLS |

Size the instance from monitoring and load tests; start small.

> **Note:** a private database is only reachable from inside the same AWS network. If the backend runs outside AWS (for example on Render), it either moves into AWS or the database needs a fixed-IP allowlist. That is hosting decision D-39; settle it before production.

## 2. TLS certificate

Download the public RDS CA bundle (not a secret) on every machine that connects: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

Connections must verify the server certificate. Don't use `sslmode=no-verify`.

## 3. Create the roles

Run this once, as the master user, from a machine that can reach the database (an EC2 instance in the VPC, or a Session Manager port-forward). Generate two different passwords. Hex is safe inside connection URLs.

```bash
MIGRATOR_PW=$(openssl rand -hex 32)
APP_PW=$(openssl rand -hex 32)

psql "host=<endpoint> port=5432 dbname=multipleride user=<master-user> sslmode=verify-full sslrootcert=global-bundle.pem" \
  -v db_name=multipleride -v migrator_password="$MIGRATOR_PW" -v app_password="$APP_PW" \
  -f prisma/sql/01-roles.sql
```

Store both passwords in AWS Secrets Manager right away, then clear them from the shell.

| Role | Used by | Can do |
|---|---|---|
| `mr_migrator` | Migrations and the provisioning CLI only | Owns the tables |
| `mr_app` | The running API | No DELETE or TRUNCATE anywhere. INSERT-only on the wallet ledger. UPDATE only on specific columns, so it can't rewrite amounts, owners or webhook payloads. |

## 4. Apply the schema

Run the migrations as `mr_migrator`. Use either option below.

**Option A, with Node 24 and the repo checked out:**

```bash
npm ci
DATABASE_URL="postgresql://mr_migrator:<MIGRATOR_PW>@<endpoint>:5432/multipleride?sslmode=require&sslcert=/absolute/path/global-bundle.pem&sslaccept=strict" \
  npx prisma migrate deploy
```

**Option B, with Docker:**

```bash
docker build --target migrate -t multipleride-backend-migrate .
docker run --rm -v "$PWD/global-bundle.pem:/certs/rds.pem:ro" \
  -e DATABASE_URL="postgresql://mr_migrator:<MIGRATOR_PW>@<endpoint>:5432/multipleride?sslmode=require&sslcert=/certs/rds.pem&sslaccept=strict" \
  multipleride-backend-migrate
```

Then grant the API role its permissions, still as `mr_migrator`:

```bash
psql "host=<endpoint> port=5432 dbname=multipleride user=mr_migrator sslmode=verify-full sslrootcert=global-bundle.pem" \
  -f prisma/sql/02-app-grants.sql
```

> **Note:** the migration URL uses Prisma's TLS parameters (`sslcert`, `sslaccept`). The API URL in the next step uses node-postgres parameters (`sslrootcert`). Both point at the same bundle. If either reports a certificate error, check the file path first.

## 5. Hand over the API connection string

Put this in the backend's secret store as `DATABASE_URL`, never in git or chat:

```
postgresql://mr_app:<APP_PW>@<endpoint>:5432/multipleride?sslmode=verify-full&sslrootcert=/path/on/the/server/global-bundle.pem
```

The bundle file must exist at that path on the server or in the container.

## 6. Verify

1. `npx prisma migrate status` (as `mr_migrator`) says the schema is up to date.
2. Start the backend with the `mr_app` URL. `GET /health/ready` returns `{"status":"ok"}`.
3. Prove the API role can't rewrite money. Connected as `mr_app`, this must fail with `permission denied`:
   ```sql
   UPDATE payments SET amount_paise = 1;
   ```
4. Test a restore once: restore a snapshot to a temporary instance, check that the tables are there, then delete the temporary instance.

## Upgrading an existing database

Migration `20261006120000_bookings_collections_earnings_payouts` adds bookings, trips, fee rules, collections, driver earnings, bank accounts, payout batches, payouts, payout items, payout events, disputes and the admin audit trail. After `prisma migrate deploy`, **re-run `02-app-grants.sql`**: without it the API role can't read or write the new tables and every booking call fails with `permission denied`.

Then create the platform fee rule, which is deliberately not seeded (V1: 10% of the fare). As `mr_migrator`:

```bash
DATABASE_URL="<mr_migrator url>" npm run provision -- create-fee-rule \
  --type PERCENTAGE --value 10 --reason "V1 platform fee approved by Nikhil Enterprises"
```

Until a rule exists, the trip engine's booking registrations are refused with `FEE_RULE_NOT_CONFIGURED`. Fees always round HALF_UP to the nearest paisa (D-44); the database refuses any other rounding mode.

What the new tables protect at the database level (on top of the column grants):

- `bookings`: the confirmed fare, payment method, fee rule and customer can't change, and the final fare must equal the confirmed fare.
- `trips`: statuses only move in M6 order, and PAYMENT_CONFIRMED needs a paid booking.
- `fee_rules`, `payment_collections`, `driver_earnings`, `driver_bank_accounts`, `payout_batches`, `driver_payouts`, `payout_items`, `payment_disputes`: no DELETE or TRUNCATE; amounts and references are immutable; statuses only move forward.
- An earning can be in at most one live payout item, and a payout's amount must equal its items at COMMIT.
- `admin_actions` is append-only.

To check, connected as `mr_app`, these must fail with `permission denied`:

```sql
UPDATE driver_earnings SET net_amount_paise = 1;
UPDATE driver_payouts SET amount_paise = 1;
UPDATE bookings SET final_fare_minor = 1;
```

### Settlement gating, bank validation and TDS readiness (6 Oct 2026)

Two migrations, applied in order by `prisma migrate deploy`:

1. `20261007120000_earning_awaiting_settlement` only adds the `AWAITING_SETTLEMENT` earning status. It is separate because PostgreSQL can't use an enum value in the transaction that added it.
2. `20261007120100_settlements_bank_validation_tds`:
   - `fee_rules.rounding_mode` must be `HALF_UP` (CHECK). It **stops with an error** if any existing rule uses another mode.
   - New tables: `payment_settlements` (append-only, each row must match its payment's id, amount and booking), `bank_account_verifications` (finished results immutable) and `tax_rules` (versioned, empty, read-only for `mr_app`).
   - `drivers.legal_name` (KYC name, written by ops tooling only).
   - Earnings and payouts gain `other_deductions_paise`, `tds_amount_paise`, `tds_policy` (`DISABLED`) and `tax_rule_id`; payouts gain `gross_amount_paise`. CHECKs: net = gross − fee − other − TDS; an ONLINE earning can't be PAYABLE, IN_PAYOUT or PAID without a merchant settlement.
   - Bank status `DISABLED` is renamed `SUSPENDED`. A bank account is inserted only as `PENDING_VERIFICATION`; VERIFIED needs a completed, ACTIVE validation of that account (and a recorded resolution for a non-exact name match). A payout is inserted only for the driver's own VERIFIED account.
   - **Data corrections, each with an `admin_actions` entry:** existing ONLINE earnings that were PAYABLE (or ON_HOLD) without a settlement go back to `AWAITING_SETTLEMENT` (`EARNING_SETTLEMENT_GATED`); bank accounts VERIFIED without a validation become `SUSPENDED` with `REVALIDATION_REQUIRED` (`BANK_ACCOUNT_SUSPENDED`). It **stops with an error** if an ONLINE earning was already IN_PAYOUT or PAID, because that needs reconciling with Razorpay first.

Then **re-run `02-app-grants.sql`** (new tables and columns), and record each driver's KYC legal name before approving bank accounts:

```bash
DATABASE_URL="<mr_migrator url>" npm run provision -- set-legal-name --phone +919876543210 --name "Ramesh Kumar"
```

Connected as `mr_app`, these must also fail with `permission denied`:

```sql
UPDATE driver_earnings SET tds_amount_paise = 1;
INSERT INTO tax_rules (code, version, applies_to, rate_percent, effective_from, approval_reference)
  VALUES ('TDS_X', 1, 'PAYOUT', 1, now(), 'x');
UPDATE payment_settlements SET amount_paise = 1;
UPDATE drivers SET legal_name = 'x';
```

### Step-up bank-account changes

`20261008120000_bank_account_change_requests`:

- New table `bank_account_change_requests` (append-only by trigger; one open request per driver). `created_at` and `expires_at` (10 minutes) are always set by the database clock; a pending request's expiry can be brought forward, never extended. Verification needs a sign-in after the request (`step_up_auth_time > created_at`) on the driver's registered phone, inside the window, and must add its bank account in the same transaction (deferred check).
- `driver_bank_accounts.change_request_id` (unique, immutable): every new account must reference a step-up verified request of the same driver.
- Fund-account uniqueness now covers live (pending or verified) accounts only, so a driver can return to an earlier account (RazorpayX returns the same fund account for identical details).
- **Data correction, with an `admin_actions` entry:** accounts still `PENDING_VERIFICATION` (submitted without a step-up) become `SUSPENDED` with `STEP_UP_REQUIRED`; they can never be approved, and the driver submits them again.

Then **re-run `02-app-grants.sql`** (new table). Connected as `mr_app`, these must fail with `permission denied`:

```sql
UPDATE bank_account_change_requests SET created_at = now() - interval '1 day';
UPDATE bank_account_change_requests SET expires_at = now() + interval '1 day';
UPDATE driver_bank_accounts SET change_request_id = gen_random_uuid();
DELETE FROM bank_account_change_requests;
```

### Customer self-registration, Fare module and booking snapshot (payment flow Phase 1)

Three migrations, applied in order by `prisma migrate deploy`. Only the third touches existing rows, and only to mark them.

1. `20261014120000_customer_self_registration`: the `register_customer()` function (SECURITY DEFINER), the API's only way to create a customer account.
2. `20261014120100_fare_quotes`: `pricing_versions` (versioned, config immutable), `fare_quotes` (immutable, redeemed once) and `fare_quote_stops` (the drops must add up to the quote at commit).
3. `20261015120000_booking_quote_snapshot`:
   - `bookings.payment_model`. Every existing booking becomes `LEGACY_BOOKING_LEVEL`; that is the only change to existing data. The new snapshot columns (`fare_quote_id`, `pricing_version_id`, `fare_paise`, `tax_paise`, `platform_fee_paise`) stay NULL on them.
   - New table `booking_stops`, empty until the first new booking. Legacy bookings never get stops.
   - Guards: a new booking must be a `QUOTE_PER_STOP` copy of a quote redeemed for it, with its pinned rule's fee; `PREPAID_UPI` is refused; the snapshot and the stops never change; booking payment rows exist only for historical `PREPAID_UPI` bookings; a collection must match its booking's method, amount and (cash) frozen fee; delivery collections for new bookings are refused until per-drop collection is built (OPEN_DECISIONS section I).
   - Quote drops may go up to 25 (technical ceiling; the business limit is `FARE_MAX_DROPS`).
   - The new CHECKs are validated against existing rows. If a row didn't satisfy one, the migration would stop with an error; it never rewrites a row to make it fit.

**Required before migrating any database that holds data (decision N1).** Staging, production and every shared database stay blocked until steps 1 and 2 are done:

1. Run the read-only inventory and have someone review the output. It runs in a READ ONLY transaction:

   ```bash
   psql "<mr_migrator url>" -f prisma/sql/preflight-payment-flow.sql
   ```

   Note in particular unpaid `PREPAID_UPI` bookings in progress, unpaid `PAY_AT_PICKUP` bookings past arrival, unpaid `PAY_AT_DELIVERY` bookings at delivery, and pending QR collections. They all keep their current (legacy) rules after the migration.
2. Take a snapshot you can restore.
3. Rehearse on a copy. `npm run db:migration-check` copies databases on the **local** Postgres (`CREATE DATABASE … TEMPLATE`), migrates the copies and proves that no pre-existing row changed (row fingerprints over the old columns of every table), that every booking is `LEGACY_BOOKING_LEVEL` without stops, that the schema equals a fresh install, and that `down.sql` followed by a re-deploy gives the same result. It refuses any host other than localhost and drops its `*_migcheck_test` copies at the end. For a remote environment, restore its snapshot into the local Postgres and pass that database's name: `node test/migration/check-legacy-migration.mjs <database>`.
4. Deploy (`prisma migrate deploy` as `mr_migrator`), then **re-run `02-app-grants.sql`**: without it quotes and registrations fail with `permission denied` (new tables, `register_customer`, `booking_stops`).
5. Check:

   ```sql
   SELECT payment_model, count(*) FROM bookings GROUP BY 1;  -- only LEGACY_BOOKING_LEVEL before the first new booking
   SELECT count(*) FROM booking_stops;                        -- 0 before the first new booking
   ```

   Connected as `mr_app`, these must fail with `permission denied`:

   ```sql
   UPDATE bookings SET platform_fee_paise = 0;
   UPDATE booking_stops SET payable_paise = 1;
   DELETE FROM booking_stops;
   UPDATE fare_quotes SET payable_paise = 1;
   ```

6. No booking can be registered until a pricing version is in effect (quotes answer `503 PRICING_NOT_CONFIGURED`). Production needs approved rates (L-1); `PROTOTYPE*` versions are refused there. See `pricing/README.md`.

**Rollback** (`down.sql` in the migration folder; Prisma never runs it). Only before the first new booking: it refuses to run if a `QUOTE_PER_STOP` booking or a quote with more than 5 drops exists, and it doesn't change any existing row. Roll the backend back to the previous release at the same time.

```bash
psql "<mr_migrator url>" -v ON_ERROR_STOP=1 -f prisma/migrations/20261015120000_booking_quote_snapshot/down.sql
psql "<mr_migrator url>" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261015120000_booking_quote_snapshot';"
```

### Per-stop obligation schema (payment flow Phase 2)

`20261016120000_per_stop_obligation_schema` prepares the database for collecting a pay-at-delivery booking drop by drop. It enables nothing: the stop lifecycle arrives with Phase 3 and per-drop collection with Phase 4. It changes no existing row.

- `booking_stops` gets the facts its lifecycle will record: arrival, payment confirmation, delivery, a failed attempt and its reason, cancellation, and an admin's resolution (who, when, why). CHECKs tie each status to its facts (a `PENDING` stop has none), and at most one stop per booking is current (`ARRIVED` or `PAYMENT_CONFIRMED`). Stops still can't change.
- `payment_collections.booking_stop_id`: the drop a collection is for. A composite foreign key allows only a stop of the same booking, and a pickup collection never names one (CHECK). `uq_collection_booking_active` is replaced by `uq_collection_booking_level_active` (one live collection per booking for pickup and historical bookings, exactly the old rule) and `uq_collection_stop_active` (one per drop). The insert guard keeps a booking's collections all of one kind and still refuses per-drop collections; the stop of a collection can never change.
- No grant changes. The API role still has no UPDATE on `booking_stops`, and `booking_stop_id` isn't among its updatable collection columns.

Before migrating a database that holds data, the same rules as for Phase 1 apply (decision N1): run the preflight and have it reviewed, take a snapshot, rehearse with `npm run db:migration-check` (it covers every migration that has a `down.sql`), then deploy. The preflight now also lists bookings by payment model, the live collections per booking (at most 1 is expected, which the new booking-level index requires), and the stops and per-drop collections. Re-running `02-app-grants.sql` is harmless.

Check after deploying:

```sql
SELECT count(*) FROM payment_collections WHERE booking_stop_id IS NOT NULL;  -- 0 until per-drop collection (Phase 4)
SELECT count(*) FROM booking_stops WHERE status <> 'PENDING';               -- 0 until the stop lifecycle (Phase 3)
```

Connected as `mr_app`, these must fail with `permission denied`:

```sql
UPDATE payment_collections SET booking_stop_id = gen_random_uuid();
UPDATE booking_stops SET arrived_at = now();
```

**Rollback**, newest migration first. This `down.sql` refuses to run once a collection names a drop or a stop has lifecycle data, and restores the previous guards and the old index exactly. Rolling back `20261015120000_booking_quote_snapshot` as well means running this one first.

```bash
psql "<mr_migrator url>" -v ON_ERROR_STOP=1 -f prisma/migrations/20261016120000_per_stop_obligation_schema/down.sql
psql "<mr_migrator url>" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261016120000_per_stop_obligation_schema';"
```

### Payment gate and stop lifecycle (payment flow Phase 3)

`20261017120000_payment_gate_stop_lifecycle` changes rules only: it adds no column and touches no row.

- `guard_trip_change` gets the pickup gate: an unpaid PAY_AT_PICKUP trip can't leave DRIVER_ARRIVED, and a booking priced per drop can't start unpaid either. For bookings priced per drop it also allows DROP_PROGRESS only once a drop has been reached, and DELIVERED only once every drop is finished.
- `guard_booking_stop_update` becomes the stop state machine:
  - drops are reached in order, one at a time, only while the trip is under way
  - a drop is handed over only once it is paid
  - only an admin resolves a failed drop as undelivered
  - drops are cancelled only with their booking
  - each lifecycle fact is written only by its transition
- New deferred trigger `trg_booking_stops_resolution_audit`: a drop resolved as undelivered needs its `admin_actions` record from the same transaction.

Before migrating a database that holds data, the same rules as for Phase 1 apply (decision N1): run the preflight and have it reviewed, take a snapshot, rehearse with `npm run db:migration-check`, then deploy. The preflight now also lists:
- unpaid PAY_AT_PICKUP trips waiting at DRIVER_ARRIVED: once migrated they must be paid before the handover, historical ones included (N2)
- bookings priced per drop that are past the pickup: from now on the trip engine reports their drops
- stops by status

Deploy, then **re-run `02-app-grants.sql`**. Without it the API role can't move drops, and stop reports and admin resolutions fail with `permission denied`.

Check after deploying:

```sql
SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_booking_stops_resolution_audit';  -- 1
SELECT count(*) FROM booking_stops WHERE status <> 'PENDING';                        -- 0 until a drop is reached
```

Connected as `mr_app`, these must still fail with `permission denied`. A drop's payment is confirmed only with per-drop collection (Phase 4):

```sql
UPDATE booking_stops SET payment_confirmed_at = now();
UPDATE booking_stops SET payable_paise = 1;
```

**Rollback**, newest first. This `down.sql` drops no data and restores the previous trip and stop guards exactly. Roll the backend back to the previous release at the same time, and revoke the stop grant. Once a drop has moved, `20261016120000`'s `down.sql` refuses to run (lifecycle data).

```bash
psql "<mr_migrator url>" -v ON_ERROR_STOP=1 -f prisma/migrations/20261017120000_payment_gate_stop_lifecycle/down.sql
psql "<mr_migrator url>" -c "REVOKE UPDATE ON booking_stops FROM mr_app;"
psql "<mr_migrator url>" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261017120000_payment_gate_stop_lifecycle';"
```

### Collections per obligation (payment flow Phase 4)

Two migrations, applied in order by `prisma migrate deploy`. Neither touches a row.

- `20261018120000_partially_paid_mixed_enums` adds `PARTIALLY_PAID` to `booking_payment_status` (after UNPAID) and `MIXED` to `earning_settlement`, and nothing else. PostgreSQL can't use an enum value in the transaction that added it, so the rules that use them come in the next migration.
- `20261018120100_obligation_collections` changes rules and adds one table:
  - `booking_collected_status(booking)` says what a booking's completed collections pay for.
  - `guard_booking_update`: the payment status moves UNPAID → PARTIALLY_PAID or PAID, then PARTIALLY_PAID → PAID (the refund moves are unchanged). Only a PAY_AT_DELIVERY booking priced per drop can be PARTIALLY_PAID, and a booking priced per drop is PAID or PARTIALLY_PAID only as its collections say.
  - `guard_collection_insert`: a booking priced per drop is collected on its own trip, by its own driver, once for the whole booking at the pickup (PAY_AT_PICKUP) or drop by drop (PAY_AT_DELIVERY). A drop can be collected only while the driver is there and before it is paid, for that drop's payable amount. For every booking model, a cash fee must be the collecting driver's own CASH_RIDE_FEE debit of exactly the obligation's fee.
  - Deferred `trg_collections_effects`: a completed collection of a booking priced per drop moves the booking's payment status, and confirms its drop, in the same transaction.
  - New table `earning_collections`: the collections that fund each earning. Rows are written with their earning, in its transaction, never change, and can't be deleted or truncated.
  - Deferred `trg_earnings_sources`: an earning funded by several collections adds up to them. The `driver_earnings` CHECKs now allow such an earning (no single source) and the MIXED settlement.

The trip guard is unchanged. It only refuses PAYMENT_CONFIRMED for an UNPAID booking, so a trip priced per drop whose drops are all finished reaches it with a PARTIALLY_PAID booking and can complete (N5).

Before migrating a database that holds data, the same rules as for Phase 1 apply (decision N1): run the preflight and have it reviewed, take a snapshot, rehearse with `npm run db:migration-check`, then deploy. The preflight now also lists:
- whether the two Phase 4 enum values exist
- bookings priced per drop by payment method, status and payment status
- pending QR collections by booking model and stage (historical ones still pay the whole booking)
- earning sources, and earnings with no single source
- cash fee debits by ledger key (per booking, or per collection)

Deploy, then **re-run `02-app-grants.sql`**. The API role needs UPDATE on `booking_stops.payment_confirmed_at`, which the stop guard allows only with that drop's COMPLETED collection. It also needs SELECT and INSERT on `earning_collections`. Without them, drop payments and trip completion fail with `permission denied`.

Check after deploying:

```sql
SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE (t.typname, e.enumlabel) IN (('booking_payment_status', 'PARTIALLY_PAID'),
                                    ('earning_settlement', 'MIXED'));                    -- 2
SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_collections_effects', 'trg_earnings_sources');  -- 2
SELECT count(*) FROM earning_collections;                       -- 0 until a trip completes
```

Connected as `mr_app`, these must still fail with `permission denied`:

```sql
UPDATE earning_collections SET amount_paise = 1;
DELETE FROM earning_collections;
UPDATE booking_stops SET payable_paise = 1;
```

**Rollback**, newest first. Roll the backend back to the previous release at the same time. Neither `down.sql` drops data:
- `20261018120100`'s refuses once an earning is linked to its collections or a drop has its own collection. Otherwise it restores the previous guards and CHECKs exactly and drops `earning_collections` (its grants go with it).
- `20261018120000`'s refuses while any booking is PARTIALLY_PAID or any earning MIXED. PostgreSQL can't drop an enum value, so it recreates both types, which **rewrites `bookings` and `driver_earnings`** under an exclusive lock (every value stays the same). Run it in a maintenance window.

```bash
psql "<mr_migrator url>" -v ON_ERROR_STOP=1 -f prisma/migrations/20261018120100_obligation_collections/down.sql
psql "<mr_migrator url>" -c "REVOKE UPDATE (payment_confirmed_at) ON booking_stops FROM mr_app;"
psql "<mr_migrator url>" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261018120100_obligation_collections';"
psql "<mr_migrator url>" -v ON_ERROR_STOP=1 -f prisma/migrations/20261018120000_partially_paid_mixed_enums/down.sql
psql "<mr_migrator url>" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261018120000_partially_paid_mixed_enums';"
```

### Earnings funded by several collections (payment flow Phase 5)

One migration, `20261019120000_mixed_earnings_payout_hold`:
- `driver_earnings` gets `cash_collected_paise`, `online_collected_paise`, `cash_fee_paise`, `online_fee_paise` and `payout_amount_paise`. The migration fills them in for every existing earning from its own sources: its linked collections, or its single source (a CASH earning is all cash, an ONLINE one all online). It then asserts that every row adds up before making them NOT NULL. No existing value changes. New CHECKs keep the split adding up and tie the payout amount to the settlement: CASH 0, ONLINE the net, MIXED the online part net of its fee.
- `earning_collections` gets `net_amount_paise` (amount − fee, CHECK), filled in for the existing links. The links' immutability trigger is switched off for that one UPDATE, inside the migration's transaction.
- New deferred `trg_earnings_settled`: an earning funded by several collections is PAYABLE, IN_PAYOUT or PAID only once every online collection funding it has its merchant settlement.
- `guard_earning_change` v3: the split is immutable, and an earning in a payout leaves it PAID or ON_HOLD, never straight back to PAYABLE (N10). `check_earning_sources` v2 checks the split against the links.
- `guard_payout_item_change` v2: an item carries exactly the payout amount of a PAYABLE online or mixed earning of the payout's driver.
- New table `settlement_findings`: settled payments that matched none of ours, or another amount. A row is recorded once and then only counted; it can't be changed otherwise, deleted or truncated.

The UPDATEs write every row of `driver_earnings` and `earning_collections`, and the new CHECKs scan both tables under an exclusive lock. On a large database, run it in a maintenance window.

**Deploy it together with the Phase 5 backend.** The Phase 4 backend can't complete a trip on the new schema: its earnings lack the new NOT NULL columns. It also can't record a failed payout, because it would re-queue the earnings and the guard refuses that. So stop the old backend, migrate, re-run the grants, then start the new backend.

Before migrating a database that holds data, the same rules as for Phase 1 apply (decision N1): run the preflight and have it reviewed, take a snapshot, rehearse with `npm run db:migration-check`, then deploy. The preflight now also lists:
- whether the split columns and `settlement_findings` exist
- earnings by settlement and status, with their split and payout amount once migrated
- earnings funded by several collections, whether their online collections are settled, and any payable before all are (must be 0)
- earnings of failed or returned payouts and their status now (before this migration a failed payout re-queued them as PAYABLE on its own)
- unfinished bookings with a drop resolved UNDELIVERED (with the technical safe default `EARNINGS_UNDELIVERED_DROP_HOLD=true`, their earning's online part will start ON_HOLD; the business rule is open, L-11 / D-70)
- settlement findings by kind

Deploy, then **re-run `02-app-grants.sql`**. The API role needs SELECT and INSERT on `settlement_findings`, and UPDATE of `occurrences` and `last_seen_at` only. Without them, the settlement sync fails with `permission denied` on the first unmatched settlement.

Check after deploying:

```sql
SELECT count(*) FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'driver_earnings'
   AND column_name IN ('cash_collected_paise', 'online_collected_paise', 'cash_fee_paise',
                       'online_fee_paise', 'payout_amount_paise');                       -- 5
SELECT count(*) FROM pg_trigger
 WHERE tgname IN ('trg_earnings_settled', 'trg_settlement_findings_guard',
                  'trg_settlement_findings_no_delete', 'trg_settlement_findings_no_truncate');  -- 4
SELECT settlement, count(*), sum(payout_amount_paise) FROM driver_earnings GROUP BY 1;  -- CASH: 0
SELECT count(*) FROM settlement_findings;                       -- 0 until a settlement doesn't match
```

Connected as `mr_app`, these must still fail with `permission denied`:

```sql
UPDATE driver_earnings SET payout_amount_paise = 1;
UPDATE earning_collections SET net_amount_paise = 1;
UPDATE settlement_findings SET settled_amount_paise = 1;
DELETE FROM settlement_findings;
```

**Rollback.** Roll the backend back to the Phase 4 release at the same time. The `down.sql` drops no data the previous rules can't rebuild: the split and the link nets are derived values. It refuses once an earning funded by several collections has been made payable or carried by a payout, or a settlement finding exists, because the previous rules can't explain those. Otherwise it restores the previous guards, the sources check and the CHECK exactly, and drops the new columns, trigger and table (its grants go with it). Rolling back also brings back the automatic re-queue of a failed payout's earnings. Earnings already ON_HOLD after a failed payout stay ON_HOLD until an admin releases them.

```bash
psql "<mr_migrator url>" -v ON_ERROR_STOP=1 -f prisma/migrations/20261019120000_mixed_earnings_payout_hold/down.sql
psql "<mr_migrator url>" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261019120000_mixed_earnings_payout_hold';"
```

### Refunds (payment flow Phase 6)

Two migrations, applied in order by `prisma migrate deploy`. Neither changes an existing row.
- `20261020120000_partially_refunded_enum` adds `PARTIALLY_REFUNDED` to `booking_payment_status` (last), and nothing else. PostgreSQL can't use an enum value in the transaction that added it, so the rules that use it come in the next migration.
- `20261020120100_refunds` adds one table, one column and rules:
  - New table `payment_refunds`: one row per refund an admin requested. Either a provider refund (Razorpay refunds an online payment) or a cash return (the cash was handed back). Each names exactly one source: a completed collection, or a paid historical prepaid payment, of its own booking and drop. CHECKs tie every status to its facts. Rows can't be deleted or truncated.
  - `guard_refund_insert` (for every role, the table owner included):
    - an active admin requests it;
    - only a cancelled or completed booking is refunded;
    - the source belongs to the booking (and drop) and is completed;
    - a provider refund refunds the source's own Razorpay payment, and a cash return needs a cash collection;
    - refunds of a source never exceed what it collected. The source row is locked, so concurrent requests are checked one after the other.
  - A partial unique index allows one live (PENDING or PROCESSING) refund per source, and a Razorpay refund id is recorded once.
  - `guard_refund_update`: the source, amount, reason and decisions are immutable, and the provider refund id and each outcome time are set once. The status moves forward only: PENDING → PROCESSING → COMPLETED or FAILED; PENDING → REFUSED or CANCELLED. Only an active admin cancels a refund.
  - `payment_collections.refunded_paise` (default 0): the sum of the collection's completed refunds. A SECURITY DEFINER trigger keeps it, and `guard_collection_update` v3 refuses any other value.
  - `booking_money_status(booking)` says what a booking's collections and refunds make its payment status: REFUND_PENDING while a refund is live, REFUNDED or PARTIALLY_REFUNDED once refunds completed, otherwise what its collections (or its prepaid payment) say. `guard_booking_update` v4 and `check_collection_effects` v2 hold the refund statuses to it. The deferred `trg_refunds_effects` checks it at commit after every refund change.
  - `REFUND_REVERSAL` (a wallet entry type unused until now) is the credit of a cash ride fee given back with a cash return. A CHECK makes it always a CREDIT, referenced to the refund, with the admin and a reason. The deferred `trg_wallet_refund_reversal` refuses one that no cash return decided. The insert guard requires exactly the collection's fee, credited to the collecting driver's wallet, once.

Nothing here refunds anything. The refund policy stays open (OPEN_DECISIONS section I, Phase 6).

Before migrating a database that holds data, the same rules as for Phase 1 apply (decision N1): run the preflight and have it reviewed, take a snapshot, rehearse with `npm run db:migration-check`, then deploy. The preflight now also lists:
- whether the Phase 6 objects exist
- bookings already in a refund status. REFUND_PENDING and REFUNDED existed before but nothing set them, so any row here was set by hand and needs review before refunds go live.
- customer payments in a refund status
- REFUND_REVERSAL ledger entries (must be 0 before this migration)
- the paid-and-cancelled refund review list, by method
- refunds by kind and status, and the total refunded, once migrated

Deploy, then **re-run `02-app-grants.sql`**. The API role needs SELECT and INSERT on `payment_refunds`, and UPDATE of the lifecycle columns only: `status`, `provider_refund_id`, `provider_status`, `provider_reference`, `failure_reason`, `submit_attempts`, `last_submitted_at`, `completed_at`, `failed_at`, `cancelled_at`, `cancelled_by_user_id`, `cancellation_reason` and `updated_at`. It gets no privilege on `refunded_paise`. Without the grants, every refund request fails with `permission denied`.

Check after deploying:

```sql
SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'booking_payment_status' AND e.enumlabel = 'PARTIALLY_REFUNDED';   -- 1
SELECT count(*) FROM pg_trigger
 WHERE tgname IN ('trg_refunds_insert_guard', 'trg_refunds_guard', 'trg_refunds_no_delete',
                  'trg_refunds_no_truncate', 'trg_refunds_sync_collection', 'trg_refunds_effects',
                  'trg_wallet_refund_reversal');                                    -- 7
SELECT count(*) FROM payment_refunds;                                               -- 0
SELECT count(*) FROM payment_collections WHERE refunded_paise <> 0;                 -- 0
SELECT count(*) FROM bookings WHERE payment_status::text <> booking_money_status(id);  -- 0 expected
```

The last query is a report, not a migration check: a booking whose status was set by hand shows up here, and a refund of it would be refused at commit until it is corrected.

Connected as `mr_app`, these must still fail with `permission denied`:

```sql
UPDATE payment_refunds SET amount_paise = 1;
UPDATE payment_refunds SET source_collection_id = gen_random_uuid();
UPDATE payment_refunds SET fee_treatment = 'KEPT';
UPDATE payment_collections SET refunded_paise = 1;
DELETE FROM payment_refunds;
TRUNCATE payment_refunds;
```

**Rollback**, newest first. Roll the backend back to the Phase 5 release at the same time. Neither `down.sql` drops data the previous rules can't rebuild:
- `20261020120100`'s refuses once any refund is recorded, or any booking is in a refund status. Otherwise it restores the previous booking guard, collection effects check and collection guard exactly, and drops `payment_refunds` (its grants go with it), its functions and triggers, the REFUND_REVERSAL rule and `refunded_paise`.
- `20261020120000`'s refuses while any booking is PARTIALLY_REFUNDED. PostgreSQL can't drop an enum value, so it recreates `booking_payment_status`, which **rewrites `bookings`** under an exclusive lock (every value stays the same). Run it in a maintenance window.

```bash
psql "<mr_migrator url>" -v ON_ERROR_STOP=1 -f prisma/migrations/20261020120100_refunds/down.sql
psql "<mr_migrator url>" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261020120100_refunds';"
psql "<mr_migrator url>" -v ON_ERROR_STOP=1 -f prisma/migrations/20261020120000_partially_refunded_enum/down.sql
psql "<mr_migrator url>" -c "DELETE FROM _prisma_migrations WHERE migration_name = '20261020120000_partially_refunded_enum';"
```

## Ongoing rules

- **Schema changes:** only through new migration files. Re-run step 4 (migrate, then grants) on every release that adds one.
- **Ledger rows:** never edit or delete them, even as an admin. Corrections go through the admin adjustment API, which writes a new, audited entry.
- **Tests:** never run the automated tests against this database. They wipe their database, and they refuse anything whose name doesn't end in `_test`.
- **Credentials:** `mr_migrator` credentials never go to the running API.
