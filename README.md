# MultipleRide Backend: Payments + Driver Wallet

NestJS service that owns the money side of MultipleRide V1 for Nikhil Enterprises: driver wallet top-ups, customer booking payments, pickup/delivery collection (cash or booking-linked Razorpay link/QR), the 10% platform fee, per-trip driver earnings, Razorpay merchant-settlement tracking, bank-account validation and the weekly Monday payout to verified bank accounts. Dispatch, stops and OTPs stay in the trip engine, which reports events through `/v1/internal/*`. Decisions and their status: [docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md).

Amounts are always integer paise (₹1 = 100 paise), rounded HALF_UP where a percentage applies. PostgreSQL is the only financial source of truth. Customer payment, merchant settlement, driver earning, payout and wallet are separate records.

## What's in this slice

- **Driver wallet:** one wallet per driver with an append-only ledger. The database blocks UPDATE, DELETE and TRUNCATE on ledger rows, and every wallet's entries form a gap-free sequence 1, 2, 3, …
- **Razorpay top-ups:**
  - the server creates the order for a server-checked amount
  - it checks the Checkout signature, then confirms and captures the payment with Razorpay itself
  - signed webhooks credit the wallet exactly once, however many times they arrive
- **Admin:** manual adjustments (reason required; there is no "set balance"), payment re-sync from Razorpay, and reconciliation reports.
- **Security:**
  - login with Firebase ID tokens, while roles and account status come from our own database
  - every route has to declare who may call it, and anything undeclared is refused
  - a least-privilege database role for the API

- **Bookings and earnings:** the trip engine registers bookings (fare and fee rule fixed at confirmation); the customer pays in the app or at pickup/delivery; completing a trip creates its earning once. An ONLINE earning becomes payable only after Razorpay settles the customer payment to Nikhil Enterprises.
- **Payouts:** every Monday at 11:00 IST the scheduler prepares one batch of settled earnings for drivers with an admin-approved, bank-validated account; an admin executes it; a payout is PAID only when RazorpayX confirms it. TDS fields exist but stay 0 until a CA-approved rule exists.

Not in this slice: a refunds API, customer features beyond booking payment, dispatch.

## Run locally

You need Node 24 (`nvm use 24.21.0`) and Docker.

```bash
docker compose up -d          # local PostgreSQL on 127.0.0.1:5433
npm ci
# fill the empty values in .env (copy .env.example to .env if you don't have one)
npm run build
npm run db:migrate
npm start                     # http://localhost:3000, Swagger at /docs when SWAGGER_ENABLED=true
```

If a setting is missing or malformed, startup fails and lists the variable names. Values are never printed.

Create test accounts linked to Firebase users (the UID is in Firebase console > Authentication > Users):

```bash
npm run provision -- create-driver --phone +91XXXXXXXXXX --subject <firebase-uid> --approve
npm run provision -- create-admin  --phone +91XXXXXXXXXX --subject <firebase-uid>
```

## Checks

| Command | What it does |
|---|---|
| `npm test` | Unit tests |
| `npm run test:int` | Integration tests against the local `multipleride_test` database. It is wiped on every run, and the suite refuses any database whose name doesn't end in `_test`. |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks |
| `npm run build` | Prisma client and compiled JS in `dist/`. No database needed. |
| `npm run e2e:local` | Builds, then runs the whole money flow through the HTTP API (₹500 fare → settlement → Monday batch → payout → PAID) on a separate `multipleride_e2e` database and port 3100, printing each call as `curl`. See [docs/RAZORPAY_INTEGRATION.md §16](docs/RAZORPAY_INTEGRATION.md). |

The integration suite includes the master prompt's financial-integrity tests (§18). The traceability doc maps each one to its test.

## Docker

```bash
docker build -t multipleride-backend .                                   # API image (runs as non-root)
docker build --target migrate -t multipleride-backend-migrate .          # one-off migration job
```

Run the migrate image with the migrator connection string, and the API image with the API role's connection string. All configuration comes from environment variables, and no secrets are baked into the images.

## Docs

- [docs/DATABASE_SETUP.md](docs/DATABASE_SETUP.md): creating the cloud database (AWS RDS) and its roles.
- [docs/RAZORPAY_INTEGRATION.md](docs/RAZORPAY_INTEGRATION.md): Razorpay setup, Driver app integration, API reference, test and go-live checklists.
- [docs/ARCHITECTURE_TRACEABILITY.md](docs/ARCHITECTURE_TRACEABILITY.md): spec requirement → code → test.
- [docs/OPEN_DECISIONS.md](docs/OPEN_DECISIONS.md): business decisions still needed.

## Known limitations

- Rate limits live in memory, so run a single instance until they move to a shared store such as Redis.
- Booking payments and cash collection are not built. The cash-collection idempotency test (#2) is a placeholder until they are.
- Refunds for payments that can't be applied automatically are done by hand in the Razorpay Dashboard (OPEN_DECISIONS D-22, D-43).
