# Razorpay Integration

For whoever wires the apps and the trip engine to this backend and runs the Razorpay tests. All amounts are integer paise (₹1 = 100 paise).

Sections 1–8 cover driver wallet top-ups. Sections 9–15 cover the V1 money model: customer booking payments, pickup/delivery collections (cash and QR), driver earnings and weekly payouts.

```
ONLINE  customer → Razorpay → Nikhil Enterprises → driver earning → weekly payout → driver's verified bank
CASH    customer → cash → driver → 10% platform fee debited from the driver wallet
```

## 1. How a top-up works

1. The app calls `POST /v1/wallet/topups` with the amount. The server checks the driver and the amount, creates a Razorpay order and returns the Checkout parameters.
2. The app opens Razorpay Checkout with exactly those parameters, and the driver pays.
3. The app sends the three values Checkout returns to `POST /v1/wallet/topups/{paymentId}/verify`.
4. The server checks the signature, asks Razorpay for the payment's real state, captures it if needed, and credits the wallet once.
5. Razorpay also calls the webhook. Whichever of verify and the webhook arrives first credits the wallet; the other does nothing.

The app never decides that a payment succeeded. Only `payment.status === "PAID"` from the server means the money is in the wallet.

## 2. Razorpay Dashboard (Test mode)

1. Switch the Dashboard to **Test mode**.
2. **API keys:** Account & Settings > API Keys > Generate. Copy the Key ID (`rzp_test_…`) and the Key Secret; the secret is shown only once.
3. **Capture:** Account & Settings > Payment Capture > **Automatic**. The backend also captures authorized payments itself, but automatic capture stops Razorpay auto-refunding a payment if a step is missed.
4. **Webhook** (needs a public HTTPS URL, see section 5): Account & Settings > Webhooks > Add New Webhook.
   - URL: `https://<your-backend>/v1/webhooks/razorpay`
   - Secret: the `RAZORPAY_WEBHOOK_SECRET` value from `.env`
   - Events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`
   - Alert email: an address someone actually reads. Razorpay disables a webhook that keeps failing for 24 hours ([Razorpay webhook best practices](https://razorpay.com/docs/webhooks/best-practices)).

Test and Live mode have separate keys and separate webhooks. Repeat steps 2–4 in Live mode at go-live.

## 3. Run the backend locally with test keys

1. `docker compose up -d`
2. In `.env`, fill the four empty values:
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`: your test keys
   - `AUTH_ISSUER`: `https://securetoken.google.com/<firebase-project-id>`
   - `AUTH_AUDIENCE`: `<firebase-project-id>`

   The Firebase project id is `project_id` in the Driver app's `google-services.json`.
3. Using Node 24: `npm run build`, `npm run db:migrate`, `npm start`.
4. Create your driver account, linked to your Firebase user. The UID is in Firebase console > Authentication > Users.
   ```bash
   npm run provision -- create-driver --phone +91XXXXXXXXXX --subject <firebase-uid> --approve
   ```
5. Swagger UI is at http://localhost:3000/docs while `SWAGGER_ENABLED=true`. Keep it `false` in production.

To reach your laptop from the Android emulator, use `http://10.0.2.2:3000`. From a real phone on the same Wi-Fi, use your laptop's LAN IP.

## 4. Driver app integration

Add Razorpay's React Native SDK (`react-native-razorpay`) to the Driver app and rebuild the native app; check its README for the version matching your React Native version. Add a second base URL for this backend, for example `PAYMENTS_API_BASE_URL`, so rides keep using the prototype.

```ts
import RazorpayCheckout from 'react-native-razorpay';
import { getAuth, getIdToken } from '@react-native-firebase/auth';

const API = env.PAYMENTS_API_BASE_URL;

async function headers(extra: Record<string, string> = {}) {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not signed in');
  // getIdToken refreshes the 1-hour Firebase token when needed.
  return { Authorization: `Bearer ${await getIdToken(user)}`, 'Content-Type': 'application/json', ...extra };
}

/** idempotencyKey: a UUID generated once per top-up attempt and reused on every retry of it. */
export async function topUpWallet(amountPaise: number, idempotencyKey: string) {
  const created = await fetch(`${API}/v1/wallet/topups`, {
    method: 'POST',
    headers: await headers({ 'Idempotency-Key': idempotencyKey }),
    body: JSON.stringify({ amountPaise }),
  });
  const topUp = await created.json();
  if (!created.ok) throw topUp.error; // { code, message, requestId }

  // Rejects when the driver closes Checkout or the payment fails; the top-up stays PENDING.
  const paid = await RazorpayCheckout.open({
    key: topUp.checkout.keyId,
    order_id: topUp.checkout.orderId,
    amount: topUp.checkout.amountPaise,
    currency: topUp.checkout.currency,
    name: 'MultipleRide',
    description: 'Wallet recharge',
  });

  const verified = await fetch(`${API}/v1/wallet/topups/${topUp.paymentId}/verify`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({
      razorpayOrderId: paid.razorpay_order_id,
      razorpayPaymentId: paid.razorpay_payment_id,
      razorpaySignature: paid.razorpay_signature,
    }),
  });
  const result = await verified.json();
  if (!verified.ok) throw result.error;
  return result; // { payment, providerStatus, wallet }
}
```

Generate the idempotency key with any UUID v4 library. Hermes may not provide `crypto.randomUUID`.

| What the server says | What the app should do |
|---|---|
| `payment.status` `PAID` | Success. Show `wallet.balancePaise`. |
| `payment.status` `PENDING` after verify | Show "Payment processing". Poll `GET /v1/wallet/topups/{paymentId}` every few seconds for about a minute; the webhook finishes it. |
| Checkout closed or failed | The top-up stays `PENDING`, and its `checkout` values can be reopened. Or start a new top-up with a new key. |
| `409 PAYMENT_VERIFICATION_FAILED` | "We couldn't confirm this payment. Support has been alerted." Show the `requestId`. |
| `503` (`PAYMENT_PROVIDER_UNAVAILABLE`, `SERVICE_UNAVAILABLE`) | Retry the same call later with the same key. |
| `401 AUTH_INVALID_TOKEN` | Force-refresh the token (`getIdToken(user, true)`) and retry once. |
| `403 USER_NOT_PROVISIONED` / `DRIVER_NOT_APPROVED` / `ACCOUNT_DISABLED` | Show the account-status message; don't retry. |

## 5. Webhooks need a public HTTPS URL

Razorpay can't call `localhost`, and it blocks common tunnel services such as ngrok and localtunnel ([Razorpay: validate and test webhooks](https://razorpay.com/docs/webhooks/validate-test/)). You have two options:

- deploy a staging copy (Render, AWS) with test keys
- use zrok, which Razorpay's docs suggest

Without webhooks, verify still credits the wallet. The webhook is the safety net for when the app dies mid-payment. Behind a load balancer, set `TRUST_PROXY_HOPS=1`.

## 6. Test checklist (Test mode)

Test payment details come from Razorpay's [Standard Checkout guide](https://razorpay.com/docs/developer-tools/integrations/standard-checkout):

- **UPI:** `success@razorpay` (succeeds), `failure@razorpay` (fails), `pending@razorpay` (stays pending, which tests the webhook path)
- **Cards:** `4100 2800 0000 1007` (succeeds), `4100 2800 0006 0003` (declined); any future expiry date and any CVV

Run through these:

1. **Happy path:** top up ₹100. Expect `PAID`, the balance up by 10000 paise, and one ledger entry.
2. **Repeated verify:** call verify again. There is still exactly one credit.
3. **App killed after paying:** the webhook credits the wallet; reopening it shows the new balance.
4. **Failed payment:** the top-up stays `PENDING` and nothing is credited.
5. **Pending UPI:** the app shows "processing", and the webhook credits later.
6. **Webhook replay:** resend an event from the Dashboard. The balance doesn't change.
7. **Tampered signature:** change one character. Expect `400 INVALID_PAYMENT_SIGNATURE`.
8. **Reconciliation:** with an admin token (`npm run provision -- create-admin …`), every `/v1/admin/reconciliation/*` report returns `[]`, except `pending-payments`, which lists abandoned attempts.

## 7. API reference

Every call needs `Authorization: Bearer <Firebase ID token>` except the health checks and the webhook. Responses are JSON. Interactive docs are at `/docs` and `/docs/openapi.json` when Swagger is enabled.

| Method and path | Who | Body | Returns |
|---|---|---|---|
| `GET /health/live`, `GET /health/ready` | anyone | – | `{ status: "ok" }` |
| `GET /v1/wallet` | driver | – | `{ walletId, status, balancePaise, currency, updatedAt }` |
| `GET /v1/wallet/transactions?limit=20&cursor=` | driver | – | `{ items: [{ id, type, direction, amountPaise, balanceAfterPaise, sequence, referenceType, referenceId, providerPaymentId, reason, createdAt }], nextCursor }` |
| `POST /v1/wallet/topups` | approved driver | `{ amountPaise }` plus the `Idempotency-Key` header | `201` top-up: `{ paymentId, status, amountPaise, currency, checkout: { keyId, orderId, amountPaise, currency } \| null, providerPaymentId, paymentMethod, createdAt, updatedAt }` |
| `GET /v1/wallet/topups/{paymentId}` | owner | – | top-up |
| `POST /v1/wallet/topups/{paymentId}/verify` | owner | `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }` | `{ payment, providerStatus, wallet \| null }` |
| `POST /v1/webhooks/razorpay` | Razorpay (signed) | raw event | `{ received: true }` |
| `GET /v1/admin/wallets/{walletId}`, `GET /v1/admin/drivers/{driverId}/wallet` | admin | – | wallet including `driverId` and `version` |
| `GET /v1/admin/wallets/{walletId}/transactions` | admin | – | ledger page including `performedByUserId` and `idempotencyKey` |
| `POST /v1/admin/wallets/{walletId}/adjustments` | admin | `{ direction: CREDIT\|DEBIT, amountPaise, reason }` plus the `Idempotency-Key` header | `201 { transaction, wallet, replayed }` |
| `GET /v1/admin/payments/{paymentId}`, `POST …/sync` | admin | – | payment; sync re-reads Razorpay and applies a missed capture |
| `GET /v1/admin/reconciliation/{report}` | admin | – | `wallet-mismatches`, `unprocessed-webhooks`, `webhook-anomalies`, `pending-payments?olderThanMinutes=30`, `duplicate-provider-payments` |

**Rules:**

- **Idempotency-Key:** 16–64 characters of letters, digits, `-` or `_` (a UUID fits). Reusing a key returns the original result. Reusing it with a different body returns `409 IDEMPOTENCY_KEY_REUSED`.
- **Unknown fields:** any field the API doesn't know is rejected (`400 VALIDATION_FAILED`), so clients can't set server-owned values.
- **Rate limits:** 120 requests a minute per user by default. Top-up creation is limited to 10 a minute, and verify and admin adjustments to 30 a minute. Over the limit you get `429 RATE_LIMITED`.
- **Limits:** request bodies are capped at 100 KB.

**Errors** always look like `{ "error": { "code", "message", "requestId", "details"? } }`. Branch on `code`, never on `message`. Include `requestId` in support tickets.

| Code | HTTP |
|---|---|
| `AUTH_REQUIRED`, `AUTH_INVALID_TOKEN` | 401 |
| `USER_NOT_PROVISIONED`, `ACCOUNT_DISABLED`, `FORBIDDEN`, `DRIVER_NOT_APPROVED` | 403 |
| `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`, `AMOUNT_OUT_OF_RANGE` (`details.minPaise`/`maxPaise`), `PAYMENT_ORDER_MISMATCH`, `INVALID_PAYMENT_SIGNATURE`, `WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_MALFORMED` | 400 |
| `NOT_FOUND`, `WALLET_NOT_FOUND`, `PAYMENT_NOT_FOUND` | 404 |
| `CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `WALLET_BLOCKED`, `INSUFFICIENT_BALANCE`, `PAYMENT_NOT_PAYABLE`, `PAYMENT_VERIFICATION_FAILED` | 409 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `RATE_LIMITED` | 429 |
| `INTERNAL_ERROR` | 500 |
| `PAYMENT_PROVIDER_ERROR` | 502 |
| `PAYMENT_PROVIDER_UNAVAILABLE`, `AUTH_PROVIDER_UNAVAILABLE`, `SERVICE_UNAVAILABLE` | 503 (retry later) |

## 8. Go-live checklist

**Keys and Razorpay account**

- [ ] Live keys (`rzp_live_…`) and a new webhook secret exist only in the production secret store. They are never in the app, git or logs.
- [ ] The Razorpay account is activated for Live mode.
- [ ] The Live-mode webhook is configured, and automatic capture is on in Live mode.

**Server configuration**

- [ ] The production server runs with `NODE_ENV=production`, `SWAGGER_ENABLED=false`, HTTPS only, and `TRUST_PROXY_HOPS` set for the load balancer.
- [ ] It runs as a single instance until rate limiting moves to a shared store.

**Business decisions**

- [ ] Top-up limits are decided (D-40) and so is the admin adjustment cap (D-42).
- [ ] Admin access is decided (D-41).

**Operations**

- [ ] Someone reviews `webhook-anomalies` and `pending-payments` daily.
- [ ] Alerts fire on log lines containing `"alert":"PAYMENT_ANOMALY"`.
- [ ] Refunds for anomalies are done by hand in the Dashboard (D-22, D-43).

**App stores**

- [ ] Before store submission, confirm that wallet top-ups through Razorpay meet Apple App Review Guidelines section 3.1 ([Payments](https://developer.apple.com/app-store/review/guidelines/#payments)) and Google Play's Payments policy for physical services. I have not verified this.

## 9. Booking money model

Separate records, never merged into one balance:

| Record | What it is | Table |
|---|---|---|
| Customer payment | Money the customer paid: Razorpay order (prepaid) or a pickup/delivery collection (cash or QR) | `payments`, `payment_collections` |
| Merchant settlement | Razorpay's confirmation that it settled that payment to Nikhil Enterprises' bank account | `payment_settlements` |
| Driver earning | Per trip: gross (confirmed fare), platform fee, other deductions, TDS, net share | `driver_earnings` |
| Driver payable | An ONLINE earning whose payment is settled (status `PAYABLE`) | `driver_earnings` |
| Driver payout | A bank transfer carrying one or more payable earnings | `payout_batches`, `driver_payouts`, `payout_items` |
| Driver wallet | Prepaid balance used only for cash-trip platform fees | `driver_wallets`, ledger |

The fee is a configured rule (V1: 10% of the confirmed fare), pinned to the booking when it is confirmed, and always rounded HALF_UP to the nearest paisa (₹123.45 × 10% = ₹12.345 → ₹12.35). Apps never send a fare, fee, deduction, TDS, earning or payout amount; unknown request fields are rejected with 400.

| Customer paid by | Fee | Driver's share | Earning |
|---|---|---|---|
| App (PREPAID_UPI) | taken from the payout | paid out weekly once settled | ONLINE: `AWAITING_SETTLEMENT` → `PAYABLE` |
| QR at pickup / delivery | taken from the payout | paid out weekly once settled | ONLINE: `AWAITING_SETTLEMENT` → `PAYABLE` |
| Cash at pickup / delivery | debited from the driver wallet when the cash is recorded | already in the driver's hand | CASH, `SETTLED_IN_CASH` |

Example, ₹500 fare: fee ₹50, TDS ₹0 (policy DISABLED, OPEN_DECISIONS D-57), driver share ₹450. Online: once Razorpay settles the ₹500 to Nikhil Enterprises, the next Monday payout carries ₹450. Cash: the wallet drops by ₹50, and the driver keeps the ₹500 cash.

**Merchant settlement.** Payment capture, the app's success callback and trip completion never make an earning payable. The backend reads Razorpay's settlement reconciliation (`GET /v1/settlements/recon/combined` for each India date in a look-back window) and records a settlement only for a `payment` entry with `settled: true`, a `setl_` id and the same amount as our payment; anything else is not recorded and a mismatch is logged as `"alert":"SETTLEMENT_ANOMALY"`. Pulls happen every `SETTLEMENT_SYNC_INTERVAL_MINUTES` (60), on the `settlement.processed` webhook, on `POST /v1/admin/settlements/sync` and before each scheduled payout batch. No settlement timing (T+2 or other) is assumed.

## 10. Trip engine (server to server)

The engine (dispatch, stops, OTPs) reports what happens; this backend owns the money. Every call needs `X-Internal-Api-Key: <one of INTERNAL_API_KEYS>`. Keep the key on the engine's server only.

1. Customer confirms → `POST /v1/internal/bookings` `{ externalRef, customerSubject, vehicleCategory?, paymentMethod, confirmedFarePaise }`. Same `externalRef` again returns the same booking (200). Different terms: `409 BOOKING_REF_CONFLICT`. No fee rule: `409 FEE_RULE_NOT_CONFIGURED`.
2. Optional: `POST /v1/internal/bookings/{id}/searching`.
3. Driver accepts → `POST /v1/internal/bookings/{id}/assign` `{ driverSubject }` creates the trip.
4. Each step → `POST /v1/internal/trips/{tripId}/status` `{ status }`, in this order: `DRIVER_ARRIVED`, `PICKUP_VERIFIED`, `IN_TRANSIT`, `DROP_PROGRESS`, `DELIVERED`, `COMPLETED`. Repeats are no-ops; skipping is `409 INVALID_TRIP_TRANSITION`.
5. `PAYMENT_CONFIRMED` is set by this backend when the booking is paid and delivered. `COMPLETED` before that is `409 PAYMENT_REQUIRED`: the engine waits for payment and retries.
6. Cancel → `POST /v1/internal/bookings/{id}/cancel` `{ reason }`. An open payment QR is closed at Razorpay.

`customerSubject` / `driverSubject` are Firebase UIDs of provisioned accounts (`npm run provision -- create-customer|create-driver`).

## 11. Customer app: prepaid booking payment

Same Checkout flow as top-ups (section 4), against the booking:

1. `POST /v1/bookings/{bookingId}/payment` with an `Idempotency-Key`. Returns `{ paymentId, bookingId, status, amountPaise, checkout }`. The amount is the confirmed fare. A booking has one live payment, so every retry returns the same order.
2. Open Razorpay Checkout with `checkout`.
3. `POST /v1/bookings/{bookingId}/payment/verify` with the three Checkout values. `booking.paymentStatus` `PAID` is the only success signal.
4. `GET /v1/bookings/{bookingId}/payment` shows the booking and its latest payment, for polling.

Pay-at-pickup / pay-at-delivery bookings answer `409 BOOKING_NOT_PAYABLE`; the customer pays the driver.

## 12. Driver app: collecting at pickup or delivery

`GET /v1/trips/{tripId}` returns `payment: { method, status, farePaise, platformFeePaise, driverSharePaise, collectionStage, collectionOpen }`. Show the collect button only when `collectionOpen` is true: PAY_AT_PICKUP from arrival, PAY_AT_DELIVERY after the last drop.

`POST /v1/trips/{tripId}/collections` with an `Idempotency-Key` and `{ method, amountPaise }`, where `amountPaise` is the fare shown (it must match).

- **CASH:** `201` with `status: COMPLETED` and `platformFeePaise`. The fee is already debited from the wallet. `409 INSUFFICIENT_BALANCE` (`details.requiredFeePaise`): ask the driver to recharge, then retry with the same key. Nothing was recorded.
- **ONLINE_QR:** `201` with `status: PENDING` and `qr: { product, url, expiresAt }`. For `PAYMENT_LINK`, draw `url` as a QR code; for `QR_CODE`, `url` is the QR image. Poll `GET /v1/trips/{tripId}/collections/{collectionId}` every few seconds: the server re-checks Razorpay and returns `COMPLETED` once the money has arrived. `FAILED` means it expired or was cancelled; start a new one.
- Asking for a QR twice returns the same open QR. Recording cash while a QR is open closes the QR first, and if the customer had already paid it, the cash is refused (`409 BOOKING_ALREADY_PAID`).

Never show a driver's personal UPI id. Payments only go to Nikhil Enterprises' Razorpay account.

## 13. Earnings, bank account and payouts

**Driver app:**

- `GET /v1/earnings?status=&limit=&cursor=`, `GET /v1/earnings/{earningId}` (`grossAmountPaise`, `platformFeePaise`, `otherDeductionsPaise`, `tdsAmountPaise`, `netAmountPaise`, `merchantSettled`, `status`), `GET /v1/earnings/summary` (`awaitingSettlementPaise`, `payablePaise`, `inPayoutPaise`, `onHoldPaise`, `paidPaise`, `settledInCashPaise`, ...). Show "awaiting settlement" separately from "payable". Don't show the wallet balance as earnings.
- `POST /v1/bank-account` `{ accountHolderName, ifsc, accountNumber, confirmAccountNumber }` → `PENDING_VERIFICATION`, `payoutsEnabled: false`, `validationStatus: IN_PROGRESS`. Only the last 4 digits are stored. The bank's registered name is never returned to the driver. Submitting a different account later suspends the current one at once; nothing is paid until an admin approves the new one. A second submission while one is pending: `409 BANK_ACCOUNT_CHANGE_PENDING`. Limited to 5 per hour.
- `GET /v1/bank-account`: `status` (`PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, `SUSPENDED`), `payoutsEnabled`, `validationStatus` (`NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`).
- `GET /v1/payouts`, `GET /v1/payouts/{payoutId}`: each payout with `grossAmountPaise`, `tdsAmountPaise`, `amountPaise` (transferred), status, UTR and the earnings it carried.

**Admin:**

- Bank accounts: `GET /v1/admin/bank-accounts/{id}` shows the driver's KYC name and every bank validation (account status, registered name, provider score, our MATCH / PARTIAL / MISMATCH / UNAVAILABLE). `POST /v1/admin/bank-accounts/{id}/approve` `{ verificationId?, mismatchResolution? }` approves on a completed validation of an active account; a non-MATCH needs `mismatchResolution` (`409 BANK_NAME_MISMATCH_UNRESOLVED` otherwise). `/reject` and `/suspend` take `{ reason }`. `POST /v1/admin/bank-accounts/{id}/validations` starts a new validation (pending or suspended accounts); `POST /v1/admin/bank-accounts/{id}/validations/{validationId}/refresh` re-reads one from RazorpayX. Reinstating a suspended account is `approve` on a validation started after the suspension; a replaced account can't be reinstated.
- Settlements: `POST /v1/admin/settlements/sync` `{ from?, to? }` (India dates, at most 31 days); `GET /v1/admin/settlements?bookingId=`; `GET /v1/admin/settlements/overdue-earnings` (still unsettled after `SETTLEMENT_OVERDUE_DAYS`).
- Schedule: `GET /v1/admin/payout-schedule` (weekday, time, time zone, last and next run); `POST /v1/admin/payout-schedule/run` runs this week's schedule now if its time has passed (same idempotency key as the scheduler).
- Weekly run: with `PAYOUT_SCHEDULE_ENABLED`, every Monday at 11:00 IST (defaults) the server pulls settlements, then prepares one batch from every PAYABLE, settled earning payable up to the cutoff whose driver has a VERIFIED bank account. It executes only if `PAYOUT_AUTO_EXECUTE=true`; by default an admin reviews it (`GET /v1/admin/payout-batches/{id}`) and runs `POST /v1/admin/payout-batches/{id}/execute`. `POST /v1/admin/payout-batches` (`Idempotency-Key`; optional `{ cutoffAt }`) prepares an extra batch by hand. All are safe to repeat.
- `POST /v1/admin/payouts/{id}/sync` re-reads a payout from RazorpayX when a webhook was missed.
- Holds: `POST /v1/admin/earnings/{id}/hold` and `/release` `{ reason }`. Releasing an unsettled earning returns it to `AWAITING_SETTLEMENT`, never to `PAYABLE`.
- The full trail of one trip: `GET /v1/admin/bookings/{bookingId}` (fare, fee rule, payment or collection, merchant settlement, wallet debit, earning with deductions, payout, batch, provider payout id, UTR).

Earning states: `AWAITING_SETTLEMENT` → `PAYABLE` → `IN_PAYOUT` → `PAID`; `ON_HOLD` from any of the first three (dispute, admin, reversed payout). Payout states: `PREPARED` → `SUBMITTING` → `SUBMITTED` → `PROCESSED`. `FAILED` returns the earnings to PAYABLE for the next batch. `REVERSED` (money returned by the bank) puts them ON_HOLD for an admin and suspends the bank account; it is never retried automatically.

## 14. Webhooks to configure

| Dashboard | URL | Secret | Events |
|---|---|---|---|
| Razorpay | `/v1/webhooks/razorpay` | `RAZORPAY_WEBHOOK_SECRET` | `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `payment_link.paid`, `payment_link.partially_paid`, `payment_link.expired`, `payment_link.cancelled`, `qr_code.credited`, `qr_code.closed`, `payment.dispute.created`, `payment.dispute.won`, `payment.dispute.lost`, `payment.dispute.closed`, `payment.dispute.under_review`, `payment.dispute.action_required`, `settlement.processed` |
| RazorpayX | `/v1/webhooks/razorpayx` | `RAZORPAYX_WEBHOOK_SECRET` | all `payout.*` events (`payout.failed` is mandatory in RazorpayX), `fund_account.validation.completed`, `fund_account.validation.failed` |

`settlement.processed` carries no list of payments: it only triggers a pull of the settlement reconciliation data for the dates around it.

Collection webhooks only identify the collection; the server then reads its state from Razorpay. Disputes hold the trip's earning and show in `webhook-anomalies`.

**Testing without webhooks:** booking payments complete through verify, QR collections through the driver app's polling, settlements through the periodic pull or `POST /v1/admin/settlements/sync`, bank validations through the admin refresh, and payouts through admin sync.

**Test mode limits** (Razorpay docs and a probe on 6 Oct 2026): QR codes can't be paid in test mode; payment links can. Test payments are not settled (the settlement and recon endpoints answer 200 with empty lists), so in test mode an ONLINE earning stays `AWAITING_SETTLEMENT` unless the simulator is used (section 16). Fund Account Validation is not available in test mode. RazorpayX test payouts stay in `processing` until moved in the RazorpayX dashboard, and test mode sends only some payout events.

## 15. Go-live additions

- [ ] Fee rule created with the CLI or `POST /v1/admin/fee-rules` (HALF_UP is the only rounding).
- [ ] `INTERNAL_API_KEYS` generated, stored in both servers' secret stores, and the engine calls the internal API (D-51).
- [ ] QR product chosen and enabled on the Razorpay account (D-47); automatic capture on.
- [ ] RazorpayX activated: business account number, payout IP allowlist, webhook with its own secret, balance funded (D-46); Fund Account Validation enabled and its fee known (D-58).
- [ ] Settlement reconciliation verified on the live account (D-56); `settlement.processed` webhook on; `SETTLEMENT_PROVIDER=razorpay`.
- [ ] Every driver's KYC legal name recorded (`provision.js set-legal-name`, D-59) before bank accounts are approved.
- [ ] `PAYOUT_SCHEDULE_ENABLED=true` (Monday 11:00 IST); `PAYOUT_AUTO_EXECUTE` stays false until finance decides otherwise.
- [ ] `SETTLEMENT_PROVIDER` and `PAYOUT_PROVIDER` are never `simulated` (the server refuses it in production and with live keys).
- [ ] Someone owns the daily reports: `earning-mismatches`, `payout-mismatches`, `failed-payouts`, `paid-cancelled-bookings`, `cash-fee-mismatches`, `stale-collections`, `payable-without-bank-account`, `unprocessed-payout-webhooks`, `payout-webhook-anomalies`, and `GET /v1/admin/settlements/overdue-earnings`. Alerts on `"alert":"PAYOUT_ANOMALY"`, `"alert":"PAYMENT_DISPUTE"` and `"alert":"SETTLEMENT_ANOMALY"`.
- [ ] TDS on driver payouts confirmed with a CA (D-57). `TDS_ENABLED` stays false until a rule is implemented.

### New error codes

| Code | HTTP |
|---|---|
| `INTERNAL_AUTH_INVALID` | 401 |
| `BANK_ACCOUNT_REJECTED_BY_PROVIDER`, `CUSTOMER_NOT_FOUND`, `DRIVER_NOT_FOUND`, `COLLECTION_AMOUNT_MISMATCH` | 422 |
| `BOOKING_NOT_FOUND`, `TRIP_NOT_FOUND`, `COLLECTION_NOT_FOUND`, `EARNING_NOT_FOUND`, `BANK_ACCOUNT_NOT_FOUND`, `PAYOUT_NOT_FOUND`, `PAYOUT_BATCH_NOT_FOUND`, `FEE_RULE_NOT_FOUND` | 404 |
| `BOOKING_REF_CONFLICT`, `BOOKING_NOT_PAYABLE`, `BOOKING_ALREADY_PAID`, `BOOKING_CLOSED`, `TRIP_ALREADY_ASSIGNED`, `INVALID_TRIP_TRANSITION`, `PAYMENT_REQUIRED`, `COLLECTION_NOT_ALLOWED`, `COLLECTION_IN_PROGRESS`, `FEE_RULE_NOT_CONFIGURED`, `FEE_RULE_AMBIGUOUS`, `FEE_RULE_OVERLAP`, `EARNING_INVALID_STATE`, `BANK_ACCOUNT_EXISTS`, `BANK_ACCOUNT_INVALID_STATE`, `BANK_ACCOUNT_CHANGE_PENDING`, `BANK_VALIDATION_NOT_FOUND`, `BANK_VALIDATION_NOT_ACCEPTABLE`, `BANK_NAME_MISMATCH_UNRESOLVED`, `DRIVER_KYC_NAME_MISSING` | 409 |
| `FEE_RULE_INVALID` | 400 (creating a rule) or 409 (applying one) |
| `PAYOUT_PROVIDER_ERROR` | 502 |
| `INTERNAL_API_DISABLED`, `COLLECTION_PROVIDER_NOT_CONFIGURED`, `PAYOUT_PROVIDER_NOT_CONFIGURED`, `PAYOUT_PROVIDER_UNAVAILABLE`, `SETTLEMENT_TRACKING_DISABLED` | 503 |

## 16. End-to-end run with API calls (`npm run e2e:local`)

Proves the whole money flow through the HTTP API before any app screen exists, with the approved example: ₹500 fare, ₹50 fee (10%, HALF_UP), ₹0 TDS, ₹450 to the driver.

```bash
docker compose up -d          # Postgres
npm run e2e:local             # build, then test/e2e/run-local-e2e.mjs
```

The runner creates a separate database (`multipleride_e2e`, dropped and recreated each run; the name must end in `_e2e`), starts a second backend on port 3100 with freshly generated secrets, a local RS256 key published as a JWKS (real token verification, no auth bypass) and the real ops CLI for accounts and the fee rule. It prints every request as an equivalent `curl` command (tokens, keys and signatures as `$PLACEHOLDERS`) and writes a report to `%TEMP%\multipleride-e2e-report.json`. The dev database and the dev backend are not touched. It refuses to run with live Razorpay keys.

| Step | How it is driven |
|---|---|
| 0. Driver bank account | Driver submits it; the simulated bank answers the penny drop; a signed `fund_account.validation.completed` webhook records it; an admin approves (MATCH with the KYC name). |
| 1. Payment created | Trip engine registers and assigns the booking (internal API); the customer starts the payment, which creates a real Razorpay test-mode order. |
| 2. Payment verified | Signed `payment.captured` webhook (checkout itself needs a phone). A forged signature is refused and not stored. |
| 3. Settlement confirmed | `/v1/dev/simulate/settlements`, then a signed `settlement.processed` webhook makes the backend pull the (simulated) recon data. |
| 4. Trip completion | Trip engine status events up to `COMPLETED`, repeated and concurrent. |
| 5. Earning created once | Exactly one earning: gross 50000, fee 5000, other 0, TDS 0 (DISABLED), net 45000 paise. |
| 6. Earning payable | `PAYABLE` and settled. A control trip (₹300) paid but never settled stays `AWAITING_SETTLEMENT`. |
| 7. Monday batch | The real scheduler, configured for a run a few minutes ahead (weekday and HH:MM in IST), pulls settlements and prepares the batch: the settled earning only, ₹450, not executed. |
| 8. Payout created | Admin executes the batch: one payout to the approved bank account. |
| 9. Provider success | Simulated RazorpayX moves the payout to `processed`; a signed `payout.processed` webhook applies it. |
| 10. Earning PAID | Earning `PAID`; the driver sees the payout with its UTR; the control earning is still unpaid. |
| 11. Audit trail | Booking chain (payment, settlement, earning, payout, UTR), clean reconciliation reports, `admin_actions`, webhook events and row counts. |

Idempotency checks: repeated booking registration, payment start with the same `Idempotency-Key`, duplicate `payment.captured`, settlement re-sync, repeated `COMPLETED`, re-running the weekly schedule, re-executing the batch, duplicate `payout.processed`. Each must change nothing.

`SETTLEMENT_PROVIDER=simulated` and `PAYOUT_PROVIDER=simulated` mount `/v1/dev/simulate/*` (admin-only). Config validation refuses both in production and with live keys. The simulators only change the fake provider's state; the backend learns about it only through the signed webhooks and syncs it uses in production.
