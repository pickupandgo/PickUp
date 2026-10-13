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

## Ongoing rules

- **Schema changes:** only through new migration files. Re-run step 4 (migrate, then grants) on every release that adds one.
- **Ledger rows:** never edit or delete them, even as an admin. Corrections go through the admin adjustment API, which writes a new, audited entry.
- **Tests:** never run the automated tests against this database. They wipe their database, and they refuse anything whose name doesn't end in `_test`.
- **Credentials:** `mr_migrator` credentials never go to the running API.
