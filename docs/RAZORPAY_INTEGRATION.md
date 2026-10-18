# Razorpay Integration

For whoever wires the apps and the trip engine to this backend and runs the Razorpay tests. All amounts are integer paise (₹1 = 100 paise).

Sections 1–8 cover driver wallet top-ups. Sections 9–15 cover the V1 money model: customer booking payments, pickup/delivery collections (cash and QR), driver earnings and weekly payouts. Section 16 runs the whole flow end to end, section 17 covers refunds, and section 18 the audit trail, reconciliation and the recovery of missed QR payments.

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
| Driver earning | Per trip: gross (what was collected), platform fee, other deductions, TDS, net share; split into the cash part and the online part, each with its fee, and the payout amount | `driver_earnings`, `earning_collections` |
| Driver payable | An ONLINE or MIXED earning whose online payments are all settled (status `PAYABLE`), for its payout amount | `driver_earnings` |
| Driver payout | A bank transfer carrying one or more payable earnings | `payout_batches`, `driver_payouts`, `payout_items` |
| Driver wallet | Prepaid balance used only for cash-trip platform fees | `driver_wallets`, ledger |

The fee is a configured rule (V1: 10% of the confirmed fare), pinned to the booking when it is confirmed, and always rounded HALF_UP to the nearest paisa (₹123.45 × 10% = ₹12.345 → ₹12.35). Apps never send a fare, fee, deduction, TDS, earning or payout amount; unknown request fields are rejected with 400.

| Customer paid by | Fee | Driver's share | Earning |
|---|---|---|---|
| App (PREPAID_UPI) | taken from the payout | paid out weekly once settled | ONLINE: `AWAITING_SETTLEMENT` → `PAYABLE` |
| QR at pickup / delivery | taken from the payout | paid out weekly once settled | ONLINE: `AWAITING_SETTLEMENT` → `PAYABLE` |
| Cash at pickup / delivery | debited from the driver wallet when the cash is recorded | already in the driver's hand | CASH, `SETTLED_IN_CASH` |
| Drop by drop (PAY_AT_DELIVERY priced per drop), cash and QR mixed | each cash drop's fee share debited from the wallet when it is recorded; each QR drop's fee share taken from the payout | cash drops already in hand; the QR drops' net paid out weekly once every QR drop is settled | MIXED: `AWAITING_SETTLEMENT` → `PAYABLE` |

Example, ₹500 fare: fee ₹50, TDS ₹0 (policy DISABLED, OPEN_DECISIONS D-57), driver share ₹450. Online: once Razorpay settles the ₹500 to Nikhil Enterprises, the next Monday payout carries ₹450. Cash: the wallet drops by ₹50, and the driver keeps the ₹500 cash.

**Booking paid drop by drop** (payment flow Phase 4). Each drop is its own obligation, collected when the driver reaches it, for the drop's frozen payable amount, with the drop's frozen share of the fee. The booking is `PARTIALLY_PAID` until every drop is paid, then `PAID`. Its one earning lists every collection that funded it (method, amount, fee share, net): CASH if every drop was cash, ONLINE if every drop was paid by QR, MIXED otherwise. Gross is what was collected.

**What a payout carries** (payment flow Phase 5). Every earning records its cash part and its online part, each with its fee, and its payout amount:
- CASH pays out nothing: the driver kept the cash, and its fee came out of the wallet.
- ONLINE pays out its net.
- MIXED pays out its online part net of the online fee. The cash part, net of its fee, is already in the driver's hand: it is never held as if it were online, and never paid twice.

Example, three drops of ₹260 (cash), ₹182 (QR) and ₹139 (cash), 10% fee: the payout carries ₹163.80 (₹182 − ₹18.20), and the driver already holds ₹359.10 (₹399 − ₹39.90 debited from the wallet). An earning funded by several QR drops becomes `PAYABLE` only when the last of them is settled: one QR settling never makes the others payable. A payout item always carries exactly the earning's payout amount. Multi-drop PAY_AT_DELIVERY bookings containing a QR drop still stay blocked in production until the live validation in section 15 is done; all-cash multi-drop and single-drop QR bookings work.

**Merchant settlement.** Payment capture, the app's success callback and trip completion never make an earning payable. The backend reads Razorpay's settlement reconciliation (`GET /v1/settlements/recon/combined` for each India date in a look-back window) and records a settlement only for a `payment` entry with `settled: true`, a `setl_` id and the same amount as our payment; anything else is not recorded and a mismatch is logged as `"alert":"SETTLEMENT_ANOMALY"`. Pulls happen every `SETTLEMENT_SYNC_INTERVAL_MINUTES` (60), on the `settlement.processed` webhook, on `POST /v1/admin/settlements/sync` and before each scheduled payout batch. No settlement timing (T+2 or other) is assumed.

## 10. Trip engine (server to server)

The engine (dispatch, stops, OTPs) reports what happens; this backend owns the money. Every call needs `X-Internal-Api-Key: <one of INTERNAL_API_KEYS>`. Keep the key on the engine's server only.

1. Customer confirms → `POST /v1/internal/bookings` `{ externalRef, customerSubject, quoteId, paymentMethod }`, where `quoteId` is the fare quote the customer confirmed (`POST /v1/fare/quotes`; the engine can read it with `GET /v1/internal/fare-quotes/{quoteId}`) and `paymentMethod` is `PAY_AT_PICKUP` or `PAY_AT_DELIVERY`. No amount is accepted: every amount comes from the quote, and any other field (`confirmedFarePaise`, `vehicleCategory`, …) is `400 VALIDATION_FAILED`. The response has `paymentModel: QUOTE_PER_STOP`, `quoteId`, `pricingVersionId`, `farePaise`, `taxPaise`, `payablePaise`, `platformFeePaise` and `stops: [{ sequence, payablePaise, status }]`.
   - `201` created; `200` for the same `externalRef` with the same quote, method and customer, even when two requests race.
   - `422 PAYMENT_METHOD_NOT_OFFERED` (`PREPAID_UPI`), `422 QUOTE_NOT_FOUND` (missing, or another customer's), `422 CUSTOMER_NOT_FOUND`, `422 TAX_NOT_SUPPORTED`.
   - `409 QUOTE_EXPIRED` (ask for a new quote), `409 QUOTE_ALREADY_USED`, `409 BOOKING_REF_CONFLICT` (the ref with other terms), `409 FEE_RULE_NOT_CONFIGURED`.
   - Historical bookings (`paymentModel: LEGACY_BOOKING_LEVEL`, registered before quotes) show `quoteId: null` and `stops: []`.
2. Optional: `POST /v1/internal/bookings/{id}/searching`.
3. Driver accepts → `POST /v1/internal/bookings/{id}/assign` `{ driverSubject }` creates the trip.
4. Each trip step → `POST /v1/internal/trips/{tripId}/status` `{ status }`, in this order: `DRIVER_ARRIVED`, `PICKUP_VERIFIED`, `IN_TRANSIT`, then `COMPLETED`. Repeats are no-ops; skipping is `409 INVALID_TRIP_TRANSITION`.
   - **Pickup gate.** For a PAY_AT_PICKUP booking, read `paymentGate` once at DRIVER_ARRIVED and check the pickup OTP only when `handoverAllowed` is true. Until the booking is paid, `PICKUP_VERIFIED` (and anything later) is `409 PAYMENT_REQUIRED { stage: "PICKUP", amountPaise }`: refuse the OTP and commit nothing. This applies to historical bookings too.
   - **Drops** (bookings with `stops`, i.e. priced per drop). After `IN_TRANSIT`, report each drop with `POST /v1/internal/trips/{tripId}/stops/{sequence}/status` `{ status: "ARRIVED" | "DELIVERED" | "DELIVERY_FAILED", reason? }`:
     - Drops go in order, one at a time; ARRIVED on a failed drop is its retry.
     - Read `paymentGate.handoverAllowed` before each drop OTP. DELIVERED on an unpaid pay-at-delivery drop is `409 PAYMENT_REQUIRED { stage: "DROP", stopSequence, amountPaise }`: keep the drop open. The driver collects that drop at the drop (section 12); payment for another drop never counts.
     - DELIVERY_FAILED closes the drop's open QR at Razorpay; a retry (ARRIVED) shows a new one.
     - DELIVERY_FAILED needs a `reason` (3–200 characters), and only DELIVERY_FAILED takes one.
     - Other errors: `404 STOP_NOT_FOUND`, `409 INVALID_STOP_TRANSITION { from, to, currentStop, tripStatus, reason }`, `409 BOOKING_CLOSED`.
     - The trip follows its drops: `DROP_PROGRESS` when the first drop is reached, `DELIVERED` once every drop is delivered, undelivered or cancelled. Reporting those trip statuses yourself is `409 STOP_REQUIRED` / `409 STOPS_PENDING { pendingStops }`.
     - A failed drop holds back the next one until it is retried or an admin resolves it (`POST /v1/admin/bookings/{id}/stops/{sequence}/resolve` `{ resolution: "RETRY" | "UNDELIVERED", reason }`).
   - Historical bookings (`stops: []`) keep reporting `DROP_PROGRESS` and `DELIVERED` themselves.
5. `PAYMENT_CONFIRMED` is set by this backend when the booking is paid and delivered. A booking paid drop by drop gets it once every drop is finished and at least one was paid: a drop an admin resolved as undelivered leaves it `PARTIALLY_PAID`, and it still completes (N5). `COMPLETED` before that is `409 PAYMENT_REQUIRED` while nothing is paid (`409 INVALID_TRIP_TRANSITION` while a paid booking still has drops to finish): the engine waits and retries.
6. Cancel → `POST /v1/internal/bookings/{id}/cancel` `{ reason }`. An open payment QR is closed at Razorpay, and every drop not finished yet is cancelled.

Every booking response carries `paymentGate`: `{ stage, stopSequence, paymentState, amountPaise, cashFeePaise, handoverAllowed, collectionId, lastFailure }`. `paymentState` is one of:
- `NOT_REQUIRED`
- `NOT_YET`
- `PAYMENT_REQUIRED`
- `PAYMENT_PROCESSING` (a QR is open)
- `PAYMENT_FAILED` (the last QR expired)
- `PAYMENT_CONFIRMED`

It is derived on every read and never stored.

`customerSubject` / `driverSubject` are Firebase UIDs of provisioned accounts (`npm run provision -- create-customer|create-driver`).

**The trip engine (payment flow Phase 8).** Branch `raj_engine` implements this contract. Its README has the details; this backend is unchanged.
- It stores each booking before registering it (`externalRef: ENG-<uuid>`), so a retry is a replay.
- It reports through a durable outbox, in order per booking, and retries with backoff until it gets an answer. Repeats are no-ops here.
- It reads `paymentGate` fresh before every OTP and checks the OTP only when `handoverAllowed` is true.
- It sends `PICKUP_VERIFIED`, `IN_TRANSIT`, stop `DELIVERED` and `COMPLETED` before committing them, and applies nothing that was refused.
- Its `X-Request-Id`s are `eng-quote-…`, `eng-reg-<rideId>`, `eng-gate-<tripId>`, `eng-otp-<rideId>` and `eng-ob-<outboxId>-<attempt>`.
- A 401/403 here (the key refused) is retried and logged as `"alert":"PAYMENT_BACKEND_AUTH_FAILED"`.

`npm run test:contract` in `raj_engine` runs the engine build against this backend's build on their own databases.

## 11. Customer app: paying a historical prepaid booking

New bookings are never paid in the app: they pay at pickup or at delivery (sections 10 and 12). This flow exists only for historical `PREPAID_UPI` bookings (`paymentModel: LEGACY_BOOKING_LEVEL`, registered before quotes), so they can still be paid. For any other booking every route below answers `409 BOOKING_NOT_PAYABLE`, and the webhook and the admin sync never capture or apply a payment for one (the database refuses such a payment row too).

Same Checkout flow as top-ups (section 4), against the booking:

1. `POST /v1/bookings/{bookingId}/payment` with an `Idempotency-Key`. Returns `{ paymentId, bookingId, status, amountPaise, checkout }`. The amount is the confirmed fare. A booking has one live payment, so every retry returns the same order.
2. Open Razorpay Checkout with `checkout`.
3. `POST /v1/bookings/{bookingId}/payment/verify` with the three Checkout values. `booking.paymentStatus` `PAID` is the only success signal.
4. `GET /v1/bookings/{bookingId}/payment` shows the booking and its latest payment, for polling.

Pay-at-pickup / pay-at-delivery bookings answer `409 BOOKING_NOT_PAYABLE`; the customer pays the driver.

## 12. Driver app: collecting at pickup or delivery

`GET /v1/trips/{tripId}` returns `payment: { method, status, farePaise, platformFeePaise, driverSharePaise, collectionStage, collectionOpen }`. Show the collect button only when `collectionOpen` is true:
- PAY_AT_PICKUP: from arrival.
- PAY_AT_DELIVERY priced per drop (the booking has `stops`): while the driver is at a drop that isn't paid yet.
- Historical PAY_AT_DELIVERY: after the last drop.

Each collection pays one obligation, and the server decides which and how much (payment flow Phase 4): the whole booking at the pickup, the drop the driver is at for a booking paid drop by drop, or the whole booking after delivery for a historical one. Read the amount from `paymentGate.amountPaise` and the cash fee from `paymentGate.cashFeePaise`.

`POST /v1/trips/{tripId}/collections` with an `Idempotency-Key` and `{ method, amountPaise, stopSequence? }`. `amountPaise` only echoes what is owed: anything else is `422 COLLECTION_AMOUNT_MISMATCH` (`details.expectedPaise`).
- For a booking paid drop by drop, send the `stopSequence` of the drop the driver is at. Without it the answer is `422 STOP_REQUIRED`.
- Another drop (a later one, or one already paid) is `409 COLLECTION_NOT_ALLOWED` (`details: { stage, reason: NOT_CURRENT | STOP_ALREADY_PAID, stopSequence, stopStatus, currentStop, tripStatus }`). An unknown drop is `404 STOP_NOT_FOUND`.
- A whole-booking obligation takes no `stopSequence` (`400 VALIDATION_FAILED`).

The response is the collection with `stopSequence` (null for the whole booking), plus `bookingPaymentStatus` (`UNPAID`, `PARTIALLY_PAID` or `PAID`) and `paymentGate` as the server recorded them.

- **CASH:** `201` with `status: COMPLETED` and `platformFeePaise` (the booking's fee, or the drop's share of it). The fee is already debited from the wallet, once per collection. `409 INSUFFICIENT_BALANCE` (`details.requiredFeePaise`): ask the driver to recharge, then retry with the same key. Nothing was recorded.
- **ONLINE_QR:** `201` with `status: PENDING` and `qr: { product, url, expiresAt }`. The QR is for that obligation only. For `PAYMENT_LINK`, draw `url` as a QR code; for `QR_CODE`, `url` is the QR image. Poll `GET /v1/trips/{tripId}/collections/{collectionId}` every few seconds: the server re-checks Razorpay and returns `COMPLETED` once the money has arrived. `FAILED` means it expired or was cancelled; start a new one.
- Asking for a QR twice returns the same open QR (`replayed: true`). Recording cash while a QR is open closes the QR first, and if the customer had already paid it, the cash is refused: `409 BOOKING_ALREADY_PAID` once the whole booking is paid, or `409 COLLECTION_NOT_ALLOWED` with `STOP_ALREADY_PAID` for a drop while other drops are still owed.
- Hand over (and show the drop OTP) only when `paymentGate.handoverAllowed` is true.

Never show a driver's personal UPI id. Payments only go to Nikhil Enterprises' Razorpay account.

## 13. Earnings, bank account and payouts

**Driver app:**

- `GET /v1/earnings?status=&limit=&cursor=`, `GET /v1/earnings/{earningId}` (`grossAmountPaise`, `platformFeePaise`, `otherDeductionsPaise`, `tdsAmountPaise`, `netAmountPaise`, `merchantSettled`, `status`), `GET /v1/earnings/summary` (`awaitingSettlementPaise`, `payablePaise`, `inPayoutPaise`, `onHoldPaise`, `paidPaise`, `settledInCashPaise`, ...). Show "awaiting settlement" separately from "payable". Don't show the wallet balance as earnings.
- Payment flow Phase 5: each earning also has `cashCollectedPaise`, `onlineCollectedPaise`, `cashFeePaise`, `onlineFeePaise`, `netCashPaise` (already with the driver), `netOnlinePaise`, `payoutAmountPaise` (what a payout carries) and `onlineSettledPaise` (settled so far). In the summary, each status shows payout amounts, and `settledInCashPaise` is every cash part, net of its fee. The cash drops of a MIXED trip count there, never as awaiting settlement.
- Adding or changing the bank account is a **step-up flow** (D-61). The normal session alone can never set a payout destination:
  1. `POST /v1/bank-account/change-requests` (no body, 5 per hour) → `{ changeRequestId, status: PENDING_STEP_UP, createdAt, expiresAt (10 minutes), stepUp: { method: FIREBASE_PHONE_REAUTH, phoneNumberHint, notBefore } }`. A new request replaces an open one. Refused with `409 BANK_ACCOUNT_CHANGE_PENDING` while an account is waiting for approval.
  2. The app re-authenticates the signed-in Firebase user with an OTP to the registered phone (`PhoneAuthProvider.credential(verificationId, code)` + `reauthenticateWithCredential`), then gets a fresh ID token (`getIdToken(true)`). Its `auth_time` is the OTP time; a token refresh never changes it.
  3. `POST /v1/bank-account/change-requests/{id}/confirm` `{ accountHolderName, ifsc, accountNumber, confirmAccountNumber }` with **that** token (10 per hour) → the account as `PENDING_VERIFICATION`, `payoutsEnabled: false`, `validationStatus: IN_PROGRESS`; the current account is suspended in the same transaction. Without a valid step-up: `403 STEP_UP_REQUIRED` with `details.reason` = `REAUTHENTICATION_REQUIRED` (sign-in before the request), `PHONE_MISMATCH` (not the registered number) or `NOT_PHONE_SIGN_IN`; nothing changes and the refusal is audited. Bad details (400) or a provider rejection (422) leave the request open, so the driver can correct them with the same token until `expiresAt`. Afterwards: `409 BANK_CHANGE_REQUEST_EXPIRED` or `409 BANK_CHANGE_REQUEST_CLOSED` (`details.status`: `COMPLETED`, `CANCELLED`).
  4. `POST /v1/bank-account/change-requests/{id}/cancel` (idempotent).
  The database enforces the binding: a bank account is only inserted for a step-up verified request of the same driver, verified inside the window with a sign-in after the request on the registered phone. Only the last 4 digits are stored. The bank's registered name is never returned to the driver. Nothing is paid to the new account until the bank validates it and an admin approves it.
- `GET /v1/bank-account`: `status` (`PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, `SUSPENDED`), `payoutsEnabled`, `validationStatus` (`NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`).
- `GET /v1/payouts`, `GET /v1/payouts/{payoutId}`: each payout with `grossAmountPaise`, `tdsAmountPaise`, `amountPaise` (transferred), status, UTR and the earnings it carried.

**Admin:**

- Bank accounts: `GET /v1/admin/bank-accounts/{id}` shows the driver's KYC name, the step-up evidence (`changeRequest`: method, OTP sign-in time, request time) and every bank validation (account status, registered name, provider score, our MATCH / PARTIAL / MISMATCH / UNAVAILABLE). MATCH means the same words in the same order (only case, punctuation, accents and titles ignored); reordered words, initials and missing names are PARTIAL. `POST /v1/admin/bank-accounts/{id}/approve` `{ verificationId?, mismatchResolution? }` approves on a completed validation of an active account; every non-MATCH needs `mismatchResolution` (`409 BANK_NAME_MISMATCH_UNRESOLVED` otherwise) and is recorded as `BANK_NAME_MISMATCH_RESOLVED` with both names, the result and the resolution. `/reject` and `/suspend` take `{ reason }`. `POST /v1/admin/bank-accounts/{id}/validations` starts a new validation (pending or suspended accounts); `POST /v1/admin/bank-accounts/{id}/validations/{validationId}/refresh` re-reads one from RazorpayX. Reinstating a suspended account is `approve` on a validation started after the suspension; a replaced account can't be reinstated.
- Settlements: `POST /v1/admin/settlements/sync` `{ from?, to? }` (India dates, at most 31 days); `GET /v1/admin/settlements?bookingId=`; `GET /v1/admin/settlements/overdue-earnings` (still unsettled after `SETTLEMENT_OVERDUE_DAYS`).
- Schedule: `GET /v1/admin/payout-schedule` (weekday, time, time zone, last and next run); `POST /v1/admin/payout-schedule/run` runs this week's schedule now if its time has passed (same idempotency key as the scheduler).
- Weekly run: with `PAYOUT_SCHEDULE_ENABLED`, every Monday at 11:00 IST (defaults) the server pulls settlements, then prepares one batch from every PAYABLE, settled earning payable up to the cutoff whose driver has a VERIFIED bank account. It executes only if `PAYOUT_AUTO_EXECUTE=true`; by default an admin reviews it (`GET /v1/admin/payout-batches/{id}`) and runs `POST /v1/admin/payout-batches/{id}/execute`. `POST /v1/admin/payout-batches` (`Idempotency-Key`; optional `{ cutoffAt }`) prepares an extra batch by hand. All are safe to repeat.
- `POST /v1/admin/payouts/{id}/sync` re-reads a payout from RazorpayX when a webhook was missed.
- Holds: `POST /v1/admin/earnings/{id}/hold` and `/release` `{ reason }`. Releasing an earning whose online payments are not all settled returns it to `AWAITING_SETTLEMENT`, never to `PAYABLE`. Releasing is idempotent: an earning already released stays as it is, with no second audit record. `GET /v1/admin/earnings/{id}` lists the earning's `sources`: each collection with its drop, method, amount, fee share, net and settlement.
- The full trail of one trip: `GET /v1/admin/bookings/{bookingId}`. It shows the fare, fee rule, payment or collections, wallet debits, the earning with its deductions, split and payout amount, each payout with its item amount, the batch, the provider payout id and the UTR. Each collection shows its own merchant settlement and the earning it funds, and `merchantSettlements` lists every settlement of the booking (`merchantSettlement` is the first, kept for older readers).
- Settlement anomalies: `GET /v1/admin/reconciliation/settlement-anomalies` lists settled payments that match none of our payments (`SETTLEMENT_UNKNOWN_PAYMENT`) or match one with another amount (`SETTLEMENT_AMOUNT_MISMATCH`), with both amounts and how often they were seen. They are never applied to an earning.

Earning states: `AWAITING_SETTLEMENT` → `PAYABLE` → `IN_PAYOUT` → `PAID`. `ON_HOLD` comes from a dispute, an admin, a failed or returned payout, or a refund request (`REFUND: …`, section 17). It also comes from a drop left undelivered on a trip with an online part (`UNDELIVERED_STOP_REVIEW`). That is a technical safe default (`EARNINGS_UNDELIVERED_DROP_HOLD`, default true), and the business rule is still open (L-11 / D-70). A trip left partly paid pays out only what was collected and settled, and nothing is refunded or debited on its own (N5 driver pay, open). Payout states: `PREPARED` → `SUBMITTING` → `SUBMITTED` → `PROCESSED`.
- `FAILED` (payment flow Phase 5, N10): its items are released and its earnings go `ON_HOLD` (`PAYOUT_FAILED: payout … failed (…)`). Nothing is re-queued on its own. An admin releases each earning, and a later batch pays it with a new payout, for the same payout amount.
- `REVERSED` (money returned by the bank) puts the earnings ON_HOLD for an admin and suspends the bank account. It is never retried automatically.

## 14. Webhooks to configure

| Dashboard | URL | Secret | Events |
|---|---|---|---|
| Razorpay | `/v1/webhooks/razorpay` | `RAZORPAY_WEBHOOK_SECRET` | `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `payment_link.paid`, `payment_link.partially_paid`, `payment_link.expired`, `payment_link.cancelled`, `qr_code.credited`, `qr_code.closed`, `payment.dispute.created`, `payment.dispute.won`, `payment.dispute.lost`, `payment.dispute.closed`, `payment.dispute.under_review`, `payment.dispute.action_required`, `settlement.processed`, `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed` |
| RazorpayX | `/v1/webhooks/razorpayx` | `RAZORPAYX_WEBHOOK_SECRET` | all `payout.*` events (`payout.failed` is mandatory in RazorpayX), `fund_account.validation.completed`, `fund_account.validation.failed` |

`settlement.processed` carries no list of payments: it only triggers a pull of the settlement reconciliation data for the dates around it.

Collection webhooks only identify the collection; the server then reads its state from Razorpay. Disputes hold the trip's earning and show in `webhook-anomalies`.

**Collections per obligation** (payment flow Phase 4). Each QR is created for one obligation (the booking, or one drop) and for its amount only. Its reference id is our collection id, and its notes carry `collection_id`, `booking_id`, `stage` (`PICKUP` or `DELIVERY`) and, for a drop, `booking_stop_id` and `stop_sequence`. How a payment reaches its collection:
- `qr_code.credited` names the QR.
- `payment.captured` without an order is matched by the payment, then the `collection_id` note, then Razorpay's QR lookup.

Every path (webhook, the driver app's polling, `POST /v1/admin/collections/{id}/sync`) re-reads the QR and ends in the same finalizer, which applies the payment once. A repeat is `ALREADY_APPLIED`. If the backend crashed after Razorpay took the money, the next webhook retry, poll or admin sync completes it, still once. A QR only ever pays its own obligation:
- Money on a QR that was closed (cash taken, attempt failed, booking cancelled, expired) is not applied anywhere and is flagged (`PAYMENT_NOT_PENDING` in `webhook-anomalies`).
- Money for a drop an admin resolved as undelivered meanwhile is recorded for that drop and flagged (`PAID_FOR_CLOSED_DROP`) for refund review.

**Settlements per collection** (payment flow Phase 5). Each QR payment's settlement is recorded against its own collection. An earning funded by several QR drops becomes payable when the last of them is settled, whichever webhook or sync records it. A repeated `settlement.processed` or a repeated sync records nothing twice. A settled payment that matches none of ours, or another amount, is recorded as a settlement finding for review (section 13), never applied.

**Refunds** (payment flow Phase 6). A `refund.*` event is matched to our refund by its Razorpay id, or by our receipt or `refund_id` note when the submission reply was lost. It must be exactly ours (payment, amount, currency, receipt, notes) and is applied forward only, through the same finalizer as the submission reply and `POST /v1/admin/refunds/{id}/sync`. A repeat is `REFUND_ALREADY_APPLIED`, and an older state after a newer one is `REFUND_STALE_UPDATE`. A different amount or payment is `REFUND_MISMATCH`, never applied. A refund this service never requested (made on the Dashboard) is `REFUND_UNKNOWN`. A refund Razorpay reports for one we refused or cancelled is `REFUND_CONFLICTING_STATE`. All three show in `webhook-anomalies` for review. Section 17 has the details.

**Missed webhooks and reconciliation** (payment flow Phase 7). If a QR's webhook never arrives and the driver's app never polls, the collection recovery job re-reads the QR after 5 minutes and applies it through the same finalizer, once. A signed event processed with a problem, left unprocessed, or delivered again under a new event id is also recorded as a reconciliation finding for an admin. Section 18 has the details.

**Testing without webhooks:** booking payments complete through verify, QR collections through the driver app's polling or the recovery job, settlements through the periodic pull or `POST /v1/admin/settlements/sync`, bank validations through the admin refresh, payouts through admin sync, and refunds through `POST /v1/admin/refunds/{id}/sync`.

**Test mode limits** (Razorpay docs and a probe on 6 Oct 2026): QR codes can't be paid in test mode; payment links can. Test payments are not settled (the settlement and recon endpoints answer 200 with empty lists), so in test mode an ONLINE earning stays `AWAITING_SETTLEMENT` unless the simulator is used (section 16). Fund Account Validation is not available in test mode. RazorpayX test payouts stay in `processing` until moved in the RazorpayX dashboard, and test mode sends only some payout events.

## 15. Go-live additions

- [ ] Fee rule created with the CLI or `POST /v1/admin/fee-rules` (HALF_UP is the only rounding).
- [ ] `INTERNAL_API_KEYS` generated, stored in both servers' secret stores, and the engine calls the internal API (D-51).
- [ ] Razorpay QR Codes enabled on the live account and `COLLECTION_LINK_PROVIDER=razorpay_qr_code` (UPI QR, D-47; the payment-link QR is refused with live keys); tested with a ₹1 fare from GPay, PhonePe and Paytm; `qr_code.credited` and `qr_code.closed` webhooks on; automatic capture on.
- [ ] **Open, blocks real payouts:** RazorpayX activated on Nikhil Enterprises' account: business account number, payout IP allowlist, webhook with its own secret, balance funded (D-46); Payouts and Fund Account Validation confirmed available on that account and the validation fee known (D-58). Only then set `RAZORPAYX_CAPABILITIES_CONFIRMED=true` and `PAYOUT_PROVIDER=razorpayx`; the server refuses `razorpayx` in production or with live keys without it. Until then `PAYOUT_PROVIDER=disabled`.
- [ ] **Open, blocks payable ONLINE earnings:** settlement reconciliation verified on the live account (D-56); `settlement.processed` webhook on. Only then set `SETTLEMENT_RECON_VERIFIED=true` with `SETTLEMENT_PROVIDER=razorpay`; the server refuses `razorpay` in production or with live keys without it. Until then `SETTLEMENT_PROVIDER=disabled` (earnings stay `AWAITING_SETTLEMENT`; nothing is paid).
- [ ] The startup log lists the production-readiness items still open (`Open production-readiness items`). At go-live it should show only D-57 (TDS), plus D-47 if launching with cash collection only and D-72 if launching without provider refunds. It also shows the open business decisions with a technical safe default, until Raj decides them: L-11 / D-70 (undelivered drop), N5 driver pay (partly paid trip) and L-7 to L-10, L-21 (refund policy).
- [ ] The Driver App implements the bank-account step-up (Firebase phone re-authentication before `confirm`).
- [ ] Every driver's KYC legal name recorded (`provision.js set-legal-name`, D-59) before bank accounts are approved.
- [ ] `PAYOUT_SCHEDULE_ENABLED=true` (Monday 11:00 IST); `PAYOUT_AUTO_EXECUTE` stays false until finance decides otherwise.
- [ ] `SETTLEMENT_PROVIDER`, `PAYOUT_PROVIDER`, `COLLECTION_LINK_PROVIDER` and `REFUND_PROVIDER` are never `simulated` (the server refuses it in production and with live keys).
- [ ] **Production restriction, still in force after payment flow Phase 7** (OPEN_DECISIONS section I, Phases 4 to 7):
  - All-cash multi-drop PAY_AT_DELIVERY may work through the current backend flow.
  - Single-drop QR works (one collection, paid out once settled).
  - Multi-drop PAY_AT_DELIVERY containing a QR drop stays blocked operationally. Phase 5 makes these earnings payable and settleable in the backend, proven with simulated providers only. The backend doesn't refuse such a QR, so keep these bookings off until every go-live condition in OPEN_DECISIONS section I, Phase 5 is met. In short: live QR Codes, live settlement reconciliation with one real two-QR booking, live RazorpayX payouts with the failure path run once, the ops reviews in place, the production preflight reviewed, and Raj's written approval.
- [ ] Someone owns the daily reports: `earning-mismatches`, `payout-mismatches`, `failed-payouts`, `paid-cancelled-bookings`, `cash-fee-mismatches`, `stale-collections`, `payable-without-bank-account`, `unprocessed-payout-webhooks`, `payout-webhook-anomalies`, `settlement-anomalies`, and `GET /v1/admin/settlements/overdue-earnings`. Alerts on `"alert":"PAYOUT_ANOMALY"`, `"alert":"PAYMENT_DISPUTE"` and `"alert":"SETTLEMENT_ANOMALY"`.
- [ ] Someone reviews ON_HOLD earnings (`GET /v1/admin/earnings?status=ON_HOLD`) every day. Each failed payout (`PAYOUT_FAILED`) and each trip with a drop left undelivered (`UNDELIVERED_STOP_REVIEW`) waits there for an admin release (N10, L-11).
- [ ] TDS on driver payouts confirmed with a CA (D-57). `TDS_ENABLED` stays false until a rule is implemented.
- [ ] **Open, blocks live provider refunds:** Razorpay refunds verified on the live account (D-72; the checklist is in OPEN_DECISIONS section I, Phase 6) and the `refund.*` webhooks on. Only then set `REFUNDS_PROVIDER_VERIFIED=true` with `REFUND_PROVIDER=razorpay`; the server refuses `razorpay` in production or with live keys without it. Until then `REFUND_PROVIDER=disabled`: provider refunds are refused (503 `REFUND_PROVIDER_NOT_CONFIGURED`), cash returns can still be recorded, and any customer refund is done by hand on the Dashboard (it then shows as `REFUND_UNKNOWN` for review).
- [ ] The refund policy stays open until Raj decides it (L-7 to L-10, L-21). Keep the safe defaults: `REFUND_AUTO_ON_CANCEL=false` (true is refused), `REFUND_PARTIAL_ALLOWED=false`, and `REFUND_ALLOWED_CASES` left at all cases. Every refund is requested by an admin with a reason.
- [ ] Someone owns `refund-anomalies` daily: stale refunds, refunds after a payout or on a cash earning (nothing is recovered from the driver automatically, L-21), and any total that disagrees. Alerts on `"alert":"REFUND_ANOMALY"`.
- [ ] The collection recovery and reconciliation jobs run (`COLLECTION_RECOVERY_INTERVAL_MINUTES`, `RECONCILIATION_INTERVAL_MINUTES` not 0; the startup log lists either as an open item when it is off), and `GET /v1/admin/reconciliation/summary` shows recent `COMPLETED` runs.
- [ ] Someone owns the reconciliation findings daily, CRITICAL first: `GET /v1/admin/reconciliation/findings?status=OPEN&severity=CRITICAL`. Each is resolved with a note saying what was checked or done (section 18). A finding moves no money; the sync, hold, release or refund decision it names does.
- [ ] The production database's preflight shows no `app.*` actor setting outside the backend (DATABASE_SETUP.md, Phase 7), so unattributed changes stay `UNATTRIBUTED` in the event log.

### New error codes

| Code | HTTP |
|---|---|
| `INTERNAL_AUTH_INVALID` | 401 |
| `STEP_UP_REQUIRED` (`details.reason`, `details.method`) | 403 |
| `BANK_ACCOUNT_REJECTED_BY_PROVIDER`, `CUSTOMER_NOT_FOUND`, `DRIVER_NOT_FOUND`, `COLLECTION_AMOUNT_MISMATCH` (`details.expectedPaise`), `PAYMENT_METHOD_NOT_OFFERED` (`details.offered`), `VEHICLE_CATEGORY_NOT_PRICED`, `TOO_MANY_DROPS` (`details.maxDrops`), `TAX_NOT_SUPPORTED` | 422 |
| `STOP_REQUIRED` | 422 (a collection without `stopSequence` for a booking paid drop by drop) or 409 (a trip status that the drops set) |
| `STOP_NOT_FOUND` | 404 |
| `QUOTE_NOT_FOUND` | 422 (registration) or 404 (reading a quote) |
| `QUOTE_EXPIRED`, `QUOTE_ALREADY_USED` | 409 |
| `PRICING_VERSION_INVALID` | 400 |
| `PRICING_NOT_CONFIGURED` | 503 (quotes) or 404 (admin: no version in effect) |
| `BOOKING_NOT_FOUND`, `TRIP_NOT_FOUND`, `COLLECTION_NOT_FOUND`, `EARNING_NOT_FOUND`, `BANK_ACCOUNT_NOT_FOUND`, `BANK_CHANGE_REQUEST_NOT_FOUND`, `PAYOUT_NOT_FOUND`, `PAYOUT_BATCH_NOT_FOUND`, `FEE_RULE_NOT_FOUND` | 404 |
| `BOOKING_REF_CONFLICT`, `BOOKING_NOT_PAYABLE`, `BOOKING_ALREADY_PAID`, `BOOKING_CLOSED`, `TRIP_ALREADY_ASSIGNED`, `INVALID_TRIP_TRANSITION`, `PAYMENT_REQUIRED`, `COLLECTION_NOT_ALLOWED`, `COLLECTION_IN_PROGRESS`, `FEE_RULE_NOT_CONFIGURED`, `FEE_RULE_AMBIGUOUS`, `FEE_RULE_OVERLAP`, `EARNING_INVALID_STATE`, `BANK_ACCOUNT_EXISTS`, `BANK_ACCOUNT_INVALID_STATE`, `BANK_ACCOUNT_CHANGE_PENDING`, `BANK_CHANGE_REQUEST_EXPIRED`, `BANK_CHANGE_REQUEST_CLOSED`, `BANK_VALIDATION_NOT_FOUND`, `BANK_VALIDATION_NOT_ACCEPTABLE`, `BANK_NAME_MISMATCH_UNRESOLVED`, `DRIVER_KYC_NAME_MISSING` | 409 |
| `FEE_RULE_INVALID` | 400 (creating a rule) or 409 (applying one) |
| `PAYOUT_PROVIDER_ERROR`, `REFUND_PROVIDER_ERROR` | 502 |
| `INTERNAL_API_DISABLED`, `COLLECTION_PROVIDER_NOT_CONFIGURED`, `PAYOUT_PROVIDER_NOT_CONFIGURED`, `PAYOUT_PROVIDER_UNAVAILABLE`, `SETTLEMENT_TRACKING_DISABLED`, `REFUND_PROVIDER_NOT_CONFIGURED` | 503 |
| `REFUND_NOT_FOUND` | 404 |
| `REFUND_SOURCE_NOT_REFUNDABLE` (`details.reason`), `REFUND_IN_PROGRESS` (`details.refundId`), `REFUND_CASE_NOT_ALLOWED` (`details.refundCase`), `REFUND_EARNING_IN_PAYOUT`, `REFUND_INVALID_STATE` (`details.status`, `details.reason`) | 409 |
| `REFUND_SOURCE_INVALID` (`details.reason`), `REFUND_AMOUNT_NOT_ALLOWED` (`details.refundablePaise`, `details.reason`), `REFUND_FEE_TREATMENT_REQUIRED` (`details.reason`) | 422 |
| `RECONCILIATION_RUN_NOT_FOUND`, `RECONCILIATION_FINDING_NOT_FOUND` | 404 |
| `RECONCILIATION_RUN_IN_PROGRESS` (`details.runId`), `RECONCILIATION_FINDING_RESOLVED` | 409 |

## 16. End-to-end run with API calls (`npm run e2e:local`)

Proves the whole money flow through the HTTP API before any app screen exists, with the approved example: ₹500 fare, ₹50 fee (10%, HALF_UP), ₹0 TDS, ₹450 to the driver.

```bash
docker compose up -d          # Postgres
npm run e2e:local             # build, then test/e2e/run-local-e2e.mjs
```

The runner creates a separate database (`multipleride_e2e`, dropped and recreated each run; the name must end in `_e2e`), starts a second backend on port 3100 with freshly generated secrets, a local RS256 key published as a JWKS (real token verification, no auth bypass) and the real ops CLI for accounts and the fee rule. It prints every request as an equivalent `curl` command (tokens, keys and signatures as `$PLACEHOLDERS`) and writes a report to `%TEMP%\multipleride-e2e-report.json`. The dev database and the dev backend are not touched. It refuses to run with live Razorpay keys.

| Step | How it is driven |
|---|---|
| 0. Driver bank account | Driver opens a change request; confirming with the existing session is refused (`403 STEP_UP_REQUIRED`); a fresh token (OTP re-authentication after the request, registered phone) confirms it; a replay is refused. The simulated bank answers the penny drop; a signed `fund_account.validation.completed` webhook records it; an admin approves (MATCH with the KYC name) and sees the step-up evidence. |
| 1a. New bookings | A development (`PROTOTYPE-E2E-…`) pricing version from the ops CLI; the customer gets a two-drop quote (an amount sent by the app is refused); the engine registers a PAY_AT_PICKUP booking from it (replay 200, the quote can't be used twice); `PREPAID_UPI` and an engine-sent amount are refused. |
| 1. Payment created | A historical `PREPAID_UPI` booking (inserted as a database migrated from before quotes holds it, since nothing can create one now) is assigned through the internal API; the customer starts the payment, which creates a real Razorpay test-mode order. Steps 1–11 prove the online money path; steps 13–15 and 17–18 prove it for new bookings paid by QR. |
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
| 12. PAY_AT_PICKUP, cash | The step 1a booking, still unpaid at the pickup. Cash with an empty wallet is refused (`INSUFFICIENT_BALANCE`); an admin credits the wallet. A wrong amount and a `stopSequence` are refused. Cash for the frozen total debits the frozen fee once (the replay returns the same collection), a second collection is refused, then the handover, the drops and `COMPLETED`: one CASH earning, `SETTLED_IN_CASH`. |
| 13. PAY_AT_PICKUP, QR | A new one-drop booking. The driver shows a QR for the total (asked again: the same QR), and the handover is refused while it is open. `/v1/dev/simulate/qr-codes/{id}/payments` pays it, and a signed `qr_code.credited` (delivered twice) completes it. `payment.captured`, the driver's poll and the admin sync then find it already paid, and the paid QR takes no second payment. Completion gives an ONLINE earning `AWAITING_SETTLEMENT`, which becomes `PAYABLE` after a simulated settlement and `settlement.processed`. |
| 14. PAY_AT_DELIVERY, three drops | Drop 1 in cash, drop 2 by QR, drop 3 in cash. At drop 1, a missing `stopSequence`, drop 3, the booking total and an unpaid DELIVERED are refused. A QR shown at drop 1 is closed when cash is taken, and can't be paid afterwards. The booking is `PARTIALLY_PAID` after drops 1 and 2 and `PAID` after drop 3. Drop 2's QR completes through the driver's poll before its webhook arrives. The wallet pays each cash drop's fee share once. The result is one MIXED earning with three linked collections: cash ₹399, online ₹182, payout amount ₹163.80. The driver's summary counts the cash drops as kept in cash, not as awaiting settlement. Settling the QR drop makes it `PAYABLE`, and the booking chain shows each drop's settlement state. |
| 15. Payout, pickup QR and MIXED | An admin batch (`POST /v1/admin/payout-batches`) carries step 13's earning for its net (₹234) and the MIXED earning for its payout amount (₹163.80): one transfer of ₹397.80. The cash earning (payout amount 0) stays out. It is executed, a signed `payout.processed` arrives, and both earnings are `PAID` with a UTR. |
| 16. Phase 4 audit | Reconciliation reports clean for the new bookings and the wallet; no Phase 4 webhook in the anomaly or unprocessed lists; the driver summary (paid out, kept in cash, awaiting settlement); one link per completed collection; one CASH_RIDE_FEE debit per cash collection, keyed to it. |
| 17. PAY_AT_DELIVERY, QR + cash + QR | Drop 1 by QR (signed `qr_code.credited`), drop 2 in cash, drop 3 by QR (driver's poll). One MIXED earning with a payout amount of ₹359.10, the two QR nets. Drop 1 is settled first, and the earning stays `AWAITING_SETTLEMENT` with each source's settlement state. A repeated `settlement.processed` and two concurrent admin syncs record nothing. Drop 3 is settled next, and the earning becomes `PAYABLE`, with one settlement per QR drop. |
| 18. Failed payout | A batch carries the step 17 earning (₹359.10). Simulated RazorpayX fails it, and a signed `payout.failed` (delivered twice) puts the earning `ON_HOLD` (`PAYOUT_FAILED`) and releases the item. The next batch doesn't carry it. An admin releases it (twice: one audit record). A new batch pays it with a new transfer for the same amount, and a duplicate `payout.processed` changes nothing: `PAID` once. The booking chain shows both payouts. |
| 19. Phase 5 audit | Reconciliation reports, including `settlement-anomalies`, clean for every booking paid by collection, its payments and the wallet; no webhook of the run in the anomaly or unprocessed lists. Paid out = the processed payouts; kept in cash = every cash part; nothing payable, in payout or on hold. Every payout item is its earning's payout amount, no earning is in two live items, no cash earning is in a payout, and there are four cash fee debits. |
| 20. Provider refund | A new PAY_AT_PICKUP booking paid by QR is cancelled: it stays PAID and is listed for refund review. An admin requests a refund without an amount, and the server computes the whole collection. Razorpay (simulated) accepts it: `PROCESSING`, booking `REFUND_PENDING`. The same `Idempotency-Key` returns the same refund, and a second request is refused (`REFUND_IN_PROGRESS`). `/v1/dev/simulate/refunds/{id}` processes it; a signed `refund.processed` (delivered twice, then again as a new event) and an admin sync complete it once. The refund is `COMPLETED` with the bank reference, and the booking `REFUNDED`. The collection keeps its facts and shows `refundedPaise`, and the booking leaves the review list. |
| 21. Cash returned | The step 12 cash trip. A cash return with no fee decision and a provider refund of cash are refused. With `CREDITED_TO_WALLET`, the cash return is recorded `COMPLETED` and the platform fee is credited back to the wallet once, as a `REFUND_REVERSAL` entry (replay: same refund, one credit). The cash earning is untouched and reported (`REFUND_ON_CASH_EARNING`), and the booking is `REFUNDED`. |
| 22. Refund after payout | Drop 1 of the step 17 booking, whose earning was paid out in step 18. Only that drop's money is refunded. The earning stays `PAID` (no clawback), the booking is `PARTIALLY_REFUNDED`, and `refund-anomalies` reports `REFUND_AFTER_PAYOUT` with the payout. The wallet is not touched. |
| 23. Phase 6 audit | No refund integrity finding. The wallet and this run's refund webhooks are absent from the mismatch, anomaly and unprocessed reports. Three refunds are all `COMPLETED`, and every booking's status is what its money says. `refunded_paise` is exactly the completed refunds. The audit trail has two provider refunds requested and completed and one cash return. There is one `REFUND_REVERSAL` credit, and the driver's paid-out total is unchanged. |
| 24. Recovery, audit trail, reconciliation | A new PAY_AT_PICKUP booking's QR is paid, but its webhook is lost and the driver's app never refreshes: the collection stays `PENDING`. An admin starts a `COLLECTION_RECOVERY` run (202, polled until `COMPLETED`), which applies exactly one payment: the collection is `COMPLETED` with the provider's payment, and the booking `PAID`. One `COLLECTION_RECOVERED` finding (INFO, source `RECOVERY`) names the booking. The event log shows the driver creating the collection and the job completing it under its run id; the booking chain's `auditTrail` runs from the engine's registration to the payment. The late `qr_code.credited` is `ALREADY_APPLIED`, a second run changes nothing, and `webhook-events` shows the late event without its payload. A full `RECONCILIATION` run: every database check runs, and there is no critical wallet, earning-source or duplicate-money finding after the whole flow. The admin resolves the recovery finding (a second resolution is 409), the admin actions show three runs and one resolution, the event log refuses an UPDATE from the table owner, and the summary shows the latest run of each job. |

Idempotency checks: a used bank change request confirmed again, repeated booking registration, payment start with the same `Idempotency-Key`, duplicate `payment.captured`, settlement re-sync, repeated `COMPLETED`, re-running the weekly schedule, re-executing the batch, duplicate `payout.processed`. Phase 4 adds:
- pickup cash and drop cash replayed with the same key (one collection, one fee debit)
- the same live QR shown again
- duplicate `qr_code.credited`
- `payment.captured`, the driver's poll and the admin sync after the QR is paid
- the webhook after the poll
- a second payment on a paid QR

Phase 5 adds:
- a duplicate `settlement.processed`
- two concurrent admin settlement syncs
- a duplicate `payout.failed`
- the next batch after a failure (nothing re-queued)
- a second release
- a duplicate `payout.processed` for the new payout

Phase 6 adds:
- a refund request replayed with the same key
- a second refund of the same collection while one is in progress
- a duplicate `refund.processed`, the same state in a new event, and an admin sync after the webhook
- a cash return replayed with the same key (one fee credit)

Phase 7 adds:
- a late `qr_code.credited` after the recovery job applied the QR
- a second recovery run (no new event, no new sighting)
- a second resolution of the same finding

Each must change nothing.

`SETTLEMENT_PROVIDER=simulated`, `PAYOUT_PROVIDER=simulated`, `COLLECTION_LINK_PROVIDER=simulated` and `REFUND_PROVIDER=simulated` mount `/v1/dev/simulate/*` (admin-only). Config validation refuses all four in production and with live keys. The simulators only change the fake provider's state; the backend learns about it only through the signed webhooks and syncs it uses in production (for a QR: it re-reads the QR from the simulated provider, as it would from Razorpay).

## 17. Refunds (payment flow Phase 6)

The technical refund system, for admins only. The refund policy is still open (OPEN_DECISIONS L-7 to L-10, L-21), so nothing is refunded automatically: every refund is requested by an admin, with a reason, and audited. Cancelling a paid booking refunds nothing; it is listed in `paid-cancelled-bookings` for review. The apps don't change.

Two kinds:
- `PROVIDER`: money paid online (a QR collection, or the payment of a historical `PREPAID_UPI` booking) goes back through Razorpay to where it came from.
- `CASH_RETURNED`: the driver handed the cash back. The backend records it and sends nothing.

**Admin API**

| Method and path | Body | Returns |
|---|---|---|
| `POST /v1/admin/refunds` (`Idempotency-Key` required, 10 a minute) | `{ bookingId, sourceCollectionId \| sourcePaymentId, stopSequence?, kind, amountPaise?, reason, feeTreatment? }` | `201 { refund, created: true, submission }`, or `200` with the original refund (`created: false`) when the key was already used for the same request |
| `GET /v1/admin/refunds?bookingId=&status=&limit=` | – | refunds, newest first (50 by default, at most 100) |
| `GET /v1/admin/refunds/{refundId}` | – | refund |
| `POST /v1/admin/refunds/{refundId}/sync` (30 a minute) | – | `{ refund, outcome }` |
| `POST /v1/admin/refunds/{refundId}/cancel` (10 a minute) | `{ reason }` | refund |
| `GET /v1/admin/reconciliation/refund-anomalies` | – | findings (below) |

The request:
- **One source** of this booking: `sourceCollectionId` (a completed collection: a QR for `PROVIDER`, cash for `CASH_RETURNED`) or `sourcePaymentId` (the paid payment of a historical prepaid booking, `PROVIDER` only). `stopSequence` is an optional cross-check of the collection's drop.
- **The server computes the amount:** what the source collected minus what was already refunded. `amountPaise` is optional. While partial refunds are off (`REFUND_PARTIAL_ALLOWED=false`, the default) it can only confirm that amount; any other is `422 REFUND_AMOUNT_NOT_ALLOWED` with `details.refundablePaise`. With partial refunds on, it may be 1 paisa up to what is left.
- **`reason`:** 10–500 characters, stored on the refund and in the audit trail.
- **`feeTreatment`:** cash returns only, and required there (below).
- The body can't carry a status, a provider id, a case or a fee credit (`400 VALIDATION_FAILED`). Reusing the key for a different request is `409 IDEMPOTENCY_KEY_REUSED`.
- `submission` says what sending a provider refund did on this request: `PROCESSING`, `COMPLETED`, `FAILED`, `REFUSED`, `PENDING_RETRY` (unknown outcome, retried with the same key) or `SKIPPED` (a submission is already in flight). It is `null` for a cash return.

What is checked, by the service and again by the database:
- Only a `CANCELLED` or `COMPLETED` booking is refunded, so a trip in progress keeps its money (`409 REFUND_SOURCE_NOT_REFUNDABLE`, `details.reason: BOOKING_NOT_CLOSED`).
- The source is this booking's (and this drop's), completed or paid, and of the right kind. Otherwise: `422 REFUND_SOURCE_INVALID` (`ONE_SOURCE`, `NOT_THIS_BOOKING`, `STOP_MISMATCH`, `NOT_ONLINE`, `NOT_CASH`) or `409 REFUND_SOURCE_NOT_REFUNDABLE` (`SOURCE_NOT_COMPLETED`, `ALREADY_REFUNDED`).
- One live refund per source at a time (`409 REFUND_IN_PROGRESS`, `details.refundId`). The refunds of a source never add up to more than it collected.
- The case the booking's facts show is recorded on the refund as `refundCase`: `CANCELLED_BEFORE_HANDOVER`, `CANCELLED_AFTER_HANDOVER` (picked up; for a drop's money, delivered), `UNDELIVERED_DROP` or `COMPLETED_BOOKING`. It decides nothing. `REFUND_ALLOWED_CASES` can narrow the cases an admin may refund (`409 REFUND_CASE_NOT_ALLOWED`, `details.refundCase`).

**States.** A provider refund is recorded `PENDING`, then:
- Razorpay accepts it (`pending`): `PROCESSING`. Processed: `COMPLETED`, with the bank reference (ARN, RRN or UTR from `acquirer_data`) in `providerReference` once Razorpay reports it. Failed: `FAILED`.
- Razorpay rejects it outright and has no record of it: `REFUSED`. An admin withdraws it before it reached Razorpay: `CANCELLED`.

A cash return is recorded `COMPLETED`. States only move forward. A `FAILED`, `REFUSED` or `CANCELLED` refund moved no money, and the source can be refunded with a new request.

The booking's payment status follows its money: `REFUND_PENDING` while a refund is `PENDING` or `PROCESSING`, then `REFUNDED` once everything it collected was refunded, or `PARTIALLY_REFUNDED` before that. If nothing was refunded in the end, it goes back to `PAID` or `PARTIALLY_PAID`. A collection keeps its own facts and shows `refundedPaise`. A refunded prepaid payment stays `PAID` in `payments`; the refund is its own row.

**Sending a refund to Razorpay.** The refund is recorded first and sent after that transaction commits, never inside one:
- `POST /v1/payments/{pay_id}/refund` with the amount, `speed: normal`, `receipt` = our refund id, notes (`refund_id`, `booking_id`, and `collection_id` or `payment_id`) and the header `X-Refund-Idempotency: <our refund id>`.
- Each submission is claimed for 120 seconds, so two workers never send the same refund at once.
- A retry (the same request again, or a sync) first looks for our refund in `GET /v1/payments/{pay_id}/refunds`. It sends the refund again, with the same key, only if Razorpay has no record of it.
- Razorpay unavailable (timeout, network, 5xx): the refund stays `PENDING` (`PENDING_RETRY`).
- Razorpay answers with an error: if our refund is found there anyway, its state is applied. If not, HTTP 400, 401, 403, 404 or 422 makes it `REFUSED` (`failureReason: PROVIDER_REJECTED:<code>`). Anything else, an unreadable reply included, leaves it `PENDING`.
- Every reply, webhook and sync result is validated, then must be exactly ours: the same payment, amount, currency, receipt and notes, and a Razorpay refund id not recorded for another refund. Otherwise it is `REFUND_MISMATCH`, and nothing is applied.

The webhooks (`refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`), the submission reply and the sync all go through the same finalizer, so they converge (section 14 lists the outcomes). The sync adds `RESUBMITTED_<result>` (a pending refund Razorpay had no record of, sent again), `NOT_FOUND_AT_PROVIDER` and `NOT_A_PROVIDER_REFUND`.

**Cancelling** works only for a provider refund still `PENDING` with no Razorpay id; anything else is `409 REFUND_INVALID_STATE` (`details.reason: NOT_PENDING`). A refund that was ever sent is looked up at Razorpay first. Found there, its state is applied and the cancel is refused (`REACHED_PROVIDER`). A submission less than 120 seconds old can't be cancelled (`SUBMISSION_IN_PROGRESS`).

**Cash returns.** `kind: CASH_RETURNED`, from a completed cash collection, for the amount the server computes. It is recorded `COMPLETED` and audited as `CASH_RETURN_RECORDED`. The admin states the platform fee decision each time, and there is no default (`422 REFUND_FEE_TREATMENT_REQUIRED`, `details.reason: MISSING`):
- `KEPT`: the fee stays debited. No wallet movement.
- `CREDITED_TO_WALLET`: the collection's platform fee is credited back to the collecting driver's wallet in the same transaction, as one `REFUND_REVERSAL` entry keyed `refund-fee-credit:<refundId>`. It needs the return of everything left of the collection (`NEEDS_FULL_RETURN`) and a collection that had a fee (`NO_FEE_TO_CREDIT`), and happens once per collection.

A provider refund never touches the wallet; a fee decision sent with one is refused (`NOT_A_CASH_RETURN`).

**Earnings.** In the refund request's transaction:
- An `AWAITING_SETTLEMENT` or `PAYABLE` earning goes `ON_HOLD` (`REFUND: refund <id> requested (<case>); an admin decides what the driver is paid (OPEN_DECISIONS L-21)`). One already `ON_HOLD` stays held.
- An earning `IN_PAYOUT` refuses the refund (`409 REFUND_EARNING_IN_PAYOUT`). Retry once that payout is processed or has failed.
- A `PAID` or `SETTLED_IN_CASH` earning is left as it is. Nothing is debited or recovered from the driver, and `refund-anomalies` reports it (`REFUND_AFTER_PAYOUT`, `REFUND_ON_CASH_EARNING`).
- A failed refund releases nothing. An admin may release a held earning, but a refunded booking is never paid out: payout batches take only `PAID` or `PARTIALLY_PAID` bookings.

**Reports.** `GET /v1/admin/reconciliation/refund-anomalies` lists:
- `STALE_PENDING_REFUND` (over 30 minutes) and `STALE_PROCESSING_REFUND` (over 10 days);
- `REFUND_AFTER_PAYOUT` and `REFUND_ON_CASH_EARNING`;
- `REFUNDED_TOTAL_MISMATCH`, `REFUNDS_EXCEED_SOURCE`, `BOOKING_REFUND_STATUS_MISMATCH` and `FEE_CREDIT_MISMATCH`.

`paid-cancelled-bookings` shows what is not refunded yet and leaves out a source refunded in full. The booking chain (`GET /v1/admin/bookings/{bookingId}`) lists every refund with its wallet credit. Anomalies are logged with `"alert":"REFUND_ANOMALY"`.

**Configuration** (safe defaults while the policy is open):

| Variable | Default | Meaning |
|---|---|---|
| `REFUND_PROVIDER` | `disabled` | `razorpay`, `simulated` (local runs only) or `disabled`. Disabled refuses provider refunds (`503 REFUND_PROVIDER_NOT_CONFIGURED`); cash returns can still be recorded |
| `REFUNDS_PROVIDER_VERIFIED` | `false` | D-72 gate: `razorpay` is refused in production and with live keys until it is true |
| `REFUND_PARTIAL_ALLOWED` | `false` | L-9: a refund returns everything left of its source |
| `REFUND_AUTO_ON_CANCEL` | `false` | L-8: `true` is refused at startup; there is no automatic refund |
| `REFUND_ALLOWED_CASES` | all four cases | L-7: comma-separated cases, or `NONE` |

The startup log lists D-72 until provider refunds are verified, and the open refund policy with the values in force.

**Testing.** `REFUND_PROVIDER=simulated` (test keys, outside production) mounts `POST /v1/dev/simulate/refunds/{providerRefundId}` `{ status: processed | failed }`. It returns the refund entity to deliver as a signed `refund.processed` or `refund.failed` webhook. Steps 20–23 of the end-to-end run (section 16) use it. None of this has been run against Razorpay itself, in test or live mode (D-72).

**Not covered yet:**
- Money that reached a QR after it was closed (`PAYMENT_NOT_PENDING` in `webhook-anomalies`) is not recorded as a collection, so there is no source to refund through the API. Refund it on the Dashboard; it then shows as `REFUND_UNKNOWN`.
- Refunds made on the Dashboard are reported, never recorded.
- No admin UI and no customer notification.

## 18. Audit trail, reconciliation and collection recovery (payment flow Phase 7)

Admin only, and backend only: the apps don't change. Every change to a financial record is in an append-only event log. A reconciliation job compares our records with each other and with what Razorpay and RazorpayX report, and records every mismatch as a finding for an admin. Nothing is fixed silently, and no business policy is decided (OPEN_DECISIONS section I, Phase 7).

Only one thing writes: the **collection recovery job**. It applies what Razorpay reports for a QR or payment link still PENDING, through the same finalizer as the webhook. Everything else only reads. No refund or payout is created, and no provider call other than a GET is made.

**Financial event log.** Database triggers record each change on 14 tables (bookings, trips, drops, payments, collections, settlements, disputes, refunds, earnings, payout batches, payouts, payout items, wallet entries and admin actions). Each event carries who made it, in which request or run, and the changed columns before and after. The API role can only read it, and nobody can change or delete an event (DATABASE_SETUP.md, Phase 7). The actor comes from the request:

| `actorType` | When | `actorUserId` | `requestId` | `origin` (examples) |
|---|---|---|---|---|
| `ADMIN`, `DRIVER`, `CUSTOMER` | an authenticated API call | the user | `X-Request-Id` | `POST /v1/admin/refunds/:refundId/sync`, `POST /v1/trips/:tripId/collections` |
| `ENGINE` | `/v1/internal/*` | – | `X-Request-Id` | `POST /v1/internal/bookings` |
| `PROVIDER` | a signed webhook, once its signature is verified; `providerEventId` is Razorpay's event id | – | `X-Request-Id` | `webhook razorpay qr_code.credited`, `webhook razorpayx payout.processed` |
| `SYSTEM` | a job: the recovery and reconciliation runs (request id = run id), the settlement sync and the payout schedule (`job:<uuid>`) | – | as listed | `job COLLECTION_RECOVERY`, `job SETTLEMENT_SYNC` |
| `SYSTEM` | the ops CLI | – | – | `cli <command>` |
| `UNATTRIBUTED` | anything else: an operator's SQL, a fixture (`dbRole` says which database role) | – | – | – |

A booking's trail is also on the booking chain (`GET /v1/admin/bookings/{bookingId}`): `auditTrail`, up to 500 events oldest first, and `auditTrailComplete`.

**The two jobs**

| Job | Schedule | What it does |
|---|---|---|
| `COLLECTION_RECOVERY` | every `COLLECTION_RECOVERY_INTERVAL_MINUTES` (5) | Re-reads each `ONLINE_QR` collection still PENDING after `COLLECTION_RECOVERY_MIN_AGE_MINUTES` (5), up to 200 per run, oldest first, from Razorpay (QR code or payment link). It applies what Razorpay reports through `CollectionsService.recover`, the same finalizer as the webhook, the driver's poll and `POST /v1/admin/collections/{id}/sync`. Paid: completed once, and recorded as `COLLECTION_RECOVERED`. Expired or cancelled: closed as FAILED, as the webhook would. Still open: left alone. |
| `RECONCILIATION` | every `RECONCILIATION_INTERVAL_MINUTES` (60) | Runs the 23 database checks (up to 2,000 rows each), then the read-only provider checks (up to 200 records each), and records what they find. |

Both jobs are leased in `reconciliation_runs`. Only one run per job runs at a time, across instances: a timer tick that finds one running does nothing. A run renews its lease while it works (10 minutes for recovery, 30 for reconciliation). If it dies, the next run closes it `ABANDONED` and starts over, which is safe because every step can be repeated:
- Recovery goes through the finalizer, so a payment is applied at most once. A webhook racing it gets `ALREADY_APPLIED`, and a second run finds nothing pending.
- A finding counts one sighting per run, however often a run records it.

After three "provider unavailable" answers in a row, a run stops reading the provider and reports itself incomplete (`complete: false`, the counts in `summary`). The next run retries. Pending Checkout payments (wallet top-ups, historical prepaid bookings) are never applied by a job. They are reported, and `POST /v1/admin/payments/{id}/sync` applies one, capturing it first if it is only authorized.

**Provider checks** (`RECONCILIATION_PROVIDER_CHECKS=true`). These look at records of the last `RECONCILIATION_LOOKBACK_DAYS` (3), or since the run's `since`. Pending payments under `RECONCILIATION_MIN_AGE_MINUTES` (15) old are left alone.

| Check | Reads | Reports |
|---|---|---|
| `PROVIDER_PENDING_PAYMENTS` | `GET /v1/orders/{id}/payments` for payments we hold PENDING | `PROVIDER_PAID_PAYMENT_PENDING`, `PROVIDER_AUTHORIZED_PAYMENT_PENDING`, `PROVIDER_ORDER_PAID_TWICE` |
| `PROVIDER_CLOSED_COLLECTIONS` | the QR or link of collections we closed as FAILED | `PROVIDER_PAID_COLLECTION_CLOSED` |
| `PROVIDER_PAID_COLLECTIONS` | the QR or link of collections we hold COMPLETED, and the payment's refunds | `PROVIDER_PAYMENT_NOT_CAPTURED`, `PROVIDER_EXTRA_COLLECTION_PAYMENT`, `PROVIDER_REFUND_NOT_RECORDED`, `INTERNAL_REFUND_NOT_AT_PROVIDER` |
| `PROVIDER_PAID_PAYMENTS` | `GET /v1/payments/{id}` for payments we hold PAID, and their refunds | `PROVIDER_PAYMENT_NOT_CAPTURED`, `PROVIDER_REFUND_NOT_RECORDED`, `INTERNAL_REFUND_NOT_AT_PROVIDER` |
| `PROVIDER_PAYOUTS` (when payouts are on) | `GET /v1/payouts/{id}`, or by our reference when the id was never recorded | `PAYOUT_AMOUNT_MISMATCH`, `PAYOUT_STATUS_BEHIND`, `PAYOUT_STATUS_CONFLICT` |
| `PROVIDER_REFUNDS` (when refunds are on) | `GET /v1/refunds/{id}`, or `GET /v1/payments/{id}/refunds` for a reply that was lost | `REFUND_STATUS_BEHIND`, `REFUND_STATUS_CONFLICT`, `REFUND_PROVIDER_MISMATCH` |

A lookup Razorpay refuses is `PROVIDER_LOOKUP_FAILED`. Refunds are compared through the refunds API while provider refunds are on. With them off, a Checkout payment's refunds come from its `amount_refunded` (read for this comparison only, never used to apply a payment), and a QR payment's refunds aren't compared. `*_BEHIND` means the provider moved forward and the sync named in the finding's `detail` records it. `*_CONFLICT` contradicts what we recorded, and needs a human.

**Findings.** Each finding has a `category`, a `kind`, a `severity` and a `source` (`DATABASE`, `PROVIDER` or `RECOVERY`). It names the record (`entityType`, `entityId`, `bookingId`, `driverId`), the provider id (`providerRef`), both states and both amounts, and says in `detail` what to do. Severities: CRITICAL where money may be wrong or not applied, WARNING where a state lags or waits for a review, INFO where nothing needs doing by itself.

| Category | Kinds |
|---|---|
| `PROVIDER_PAID_INTERNAL_PENDING` | CRITICAL: `PROVIDER_PAID_PAYMENT_PENDING`, `PROVIDER_PAID_COLLECTION_CLOSED`, `PROVIDER_EXTRA_COLLECTION_PAYMENT`, `RECOVERED_PAID_AFTER_CANCELLATION`, `RECOVERED_PAID_FOR_CLOSED_DROP`, `RECOVERY_<outcome>`, `WEBHOOK_AMOUNT_MISMATCH`, `WEBHOOK_ORDER_MISMATCH`, `WEBHOOK_PAYMENT_NOT_PENDING`, `WEBHOOK_UNKNOWN_ORDER`, `WEBHOOK_MISSING_ORDER_ID`, `WEBHOOK_UNKNOWN_COLLECTION` (money events). WARNING: `PROVIDER_AUTHORIZED_PAYMENT_PENDING`, `WEBHOOK_BOOKING_NOT_PAYABLE`. INFO: `COLLECTION_RECOVERED` |
| `INTERNAL_PAID_PROVIDER_NOT_PAID` | CRITICAL: `PROVIDER_PAYMENT_NOT_CAPTURED`, `PROVIDER_REFUND_NOT_RECORDED`, `DISPUTED_EARNING_NOT_HELD`, `DISPUTE_LOST`, `WEBHOOK_DISPUTE_RECORDED`, `WEBHOOK_REFUND_UNKNOWN` |
| `EARNING_SOURCE_MISMATCH` | CRITICAL: `GROSS_NOT_BOOKING_FARE`, `COMPLETED_TRIP_WITHOUT_EARNING`, `CASH_FEE_NOT_COLLECTION_FEE`, `EARNING_NOT_SUM_OF_SOURCES`, `FEE_NOT_SUM_OF_SOURCES`, `CASH_NOT_CASH_SOURCES`, `ONLINE_NOT_ONLINE_SOURCES`, `PAYOUT_AMOUNT_NOT_ONLINE_NET`, `COLLECTION_LINKED_TWICE`, `COLLECTION_FUNDS_SEVERAL_EARNINGS`, `COLLECTION_NOT_IN_EARNING`, `SOURCE_LINK_NOT_COLLECTION`, `SOURCE_NOT_COMPLETED`, `SOURCE_DRIVER_MISMATCH` |
| `SETTLEMENT_MISMATCH` | CRITICAL: `SETTLEMENT_AMOUNT_NOT_GROSS`, `PAYABLE_BEFORE_SETTLEMENT`, `SETTLEMENT_UNKNOWN_PAYMENT`, `SETTLEMENT_AMOUNT_MISMATCH`. WARNING: `SETTLED_BUT_AWAITING`, `SETTLEMENT_OVERDUE` (only while settlement tracking is on) |
| `PAYOUT_MISMATCH` | CRITICAL: `PAID_WITHOUT_PAID_ITEM`, `IN_PAYOUT_WITHOUT_ITEM`, `ITEM_PAID_EARNING_NOT_PAID`, `GROSS_NOT_SUM_OF_ITEMS`, `PROCESSED_WITH_UNPAID_ITEMS`, `FAILED_WITH_LIVE_ITEMS`, `ITEM_NOT_EARNING_PAYOUT_AMOUNT`, `EARNING_IN_SEVERAL_LIVE_ITEMS`, `ITEM_DRIVER_NOT_PAYOUT_DRIVER`, `PAYOUT_AMOUNT_MISMATCH`, `PAYOUT_STATUS_CONFLICT`, `PAYOUT_WEBHOOK_MISMATCH`, `PAYOUT_WEBHOOK_CONFLICTING_STATE`, `PAYOUT_WEBHOOK_UNKNOWN_PAYOUT`. WARNING: `PAYOUT_FAILED`, `PAYOUT_REVERSED`, `PROCESSED_WITHOUT_UTR`, `PAYOUT_STATUS_BEHIND`. INFO: `PAYABLE_WITHOUT_BANK_ACCOUNT` |
| `REFUND_MISMATCH` | CRITICAL: `REFUNDED_TOTAL_MISMATCH`, `REFUNDS_EXCEED_SOURCE`, `BOOKING_REFUND_STATUS_MISMATCH`, `INTERNAL_REFUND_NOT_AT_PROVIDER`, `REFUND_PROVIDER_MISMATCH`, `REFUND_STATUS_CONFLICT`, `WEBHOOK_REFUND_MISMATCH`, `WEBHOOK_REFUND_CONFLICTING_STATE`. WARNING: `REFUND_AFTER_PAYOUT`, `REFUND_ON_CASH_EARNING`, `REFUND_ON_PAYABLE_EARNING`, `REFUND_STATUS_BEHIND`, `WEBHOOK_PAID_AFTER_CANCELLATION`, `WEBHOOK_PAID_FOR_CLOSED_DROP`. INFO: `PAID_BOOKING_CANCELLED` |
| `WALLET_MISMATCH` | CRITICAL: `WALLET_BALANCE_NOT_LEDGER`, `LEDGER_BALANCE_CHAIN_BROKEN`, `FEE_NOT_LEDGER_AMOUNT`, `LEDGER_FEE_WITHOUT_COLLECTION`, `CASH_FEE_DEBIT_MISMATCH`, `FEE_CREDIT_MISMATCH`, `TOPUP_CREDIT_MISMATCH`, `TOPUP_CREDIT_WITHOUT_PAYMENT` |
| `STALE_PENDING` | WARNING: `PENDING_PAST_EXPIRY`, `STALE_COLLECTION_UNRECOVERABLE`, `STALE_PAYMENT_WITHOUT_ORDER`, `STUCK_SUBMITTING`, `STUCK_AT_PROVIDER`, `STALE_PENDING_REFUND`, `STALE_PROCESSING_REFUND`, `WEBHOOK_NOT_PROCESSED`, `PAYOUT_WEBHOOK_NOT_PROCESSED`. INFO: `STALE_PENDING_PAYMENT` (usually an abandoned checkout; the provider check tells a paid one apart) |
| `DUPLICATE_PROVIDER_EVENT` | CRITICAL: `PROVIDER_PAYMENT_ON_TWO_RECORDS`, `BOOKING_PAID_TWICE`, `PROVIDER_EVENT_APPLIED_TWICE`, `DUPLICATE_LEDGER_PROVIDER_PAYMENT`, `PROVIDER_ORDER_PAID_TWICE`, `WEBHOOK_DUPLICATE_ORDER_PAYMENT`, `WEBHOOK_DUPLICATE_BOOKING_PAYMENT`. INFO: `DUPLICATE_WEBHOOK_DELIVERY` (the same event type for the same object under different event ids, each handled idempotently) |
| `PROVIDER_EVENT_ANOMALY` | WARNING: `PROVIDER_LOOKUP_FAILED`, `RECOVERY_PROVIDER_LOOKUP_FAILED`, and any other `WEBHOOK_<outcome>` or `PAYOUT_WEBHOOK_<outcome>` (an event the backend couldn't use) |

The existing reports keep their codes; only `REVERSED` (`payout-mismatches`) is recorded as `PAYOUT_REVERSED`. `WEBHOOK_<outcome>` and `PAYOUT_WEBHOOK_<outcome>` are the signed events of the look-back window processed with a problem, one finding per event.

How a finding lives:
- **Recorded:** OPEN at its first sighting, once per condition (`fingerprint`).
- **Seen again:** each later run adds one to `occurrences`, and moves `lastSeenAt` and `lastRunId`.
- **Cleared:** a complete run with no `since` sets `clearedAt` on what its database state checks no longer see. The record is kept. Seen again while OPEN, `clearedAt` goes back to null. Findings about past events (webhook problems, duplicate deliveries, settlement data) and provider and recovery findings are never cleared.
- **Resolved:** only an admin resolves a finding, with a note, once. The resolution is audited and never changes. A resolved finding whose condition is still seen keeps counting sightings and is never reopened. One that was cleared and comes back is a new OPEN finding.

**Admin API**

| Method and path | Body or query | Returns |
|---|---|---|
| `GET /v1/admin/reconciliation/summary` | – | OPEN findings by severity and category, the latest run of each job, and the schedule |
| `GET /v1/admin/reconciliation/findings` | `status`, `category`, `severity`, `source`, `kind`, `bookingId`, `driverId`, `entityId`, `runId`, `cleared`, `limit` (1–200, default 50), `cursor` | `{ items, nextCursor }`, newest first |
| `GET /v1/admin/reconciliation/findings/{findingId}` | – | finding |
| `POST /v1/admin/reconciliation/findings/{findingId}/resolve` (30 a minute) | `{ note }`, 10–500 characters: what was checked or done, or the decision reference | `200` finding, audited as `RECONCILIATION_FINDING_RESOLVED`; `409 RECONCILIATION_FINDING_RESOLVED` if it already is |
| `POST /v1/admin/reconciliation/runs` (5 a minute) | `{ job: "COLLECTION_RECOVERY" \| "RECONCILIATION", since? }` | `202` with the RUNNING run, audited as `RECONCILIATION_RUN_REQUESTED`; poll `GET runs/{runId}`. `409 RECONCILIATION_RUN_IN_PROGRESS` (`details.runId`) while one is running |
| `GET /v1/admin/reconciliation/runs` | `job`, `status`, `limit` (1–100, default 20), `cursor` | `{ items, nextCursor }`, newest first |
| `GET /v1/admin/reconciliation/runs/{runId}` | – | run, with `summary`: counts and each check's result (`complete`, `note`) |
| `GET /v1/admin/reconciliation/integrity-checks` (10 a minute) | – | what the 23 database checks see now (200 rows each); records nothing |
| `GET /v1/admin/audit/financial-events` | `bookingId`, `driverId`, `entityType`, `entityId`, `action`, `actorType`, `actorUserId`, `requestId`, `providerEventId`, `from`, `to`, `order` (`desc` by default), `limit` (1–200, default 50), `cursor` | `{ items, nextCursor }` |
| `GET /v1/admin/audit/admin-actions` | `actorUserId`, `action`, `targetType`, `targetId`, `from`, `to`, `limit`, `cursor` | `{ items, nextCursor }`, newest first |
| `GET /v1/admin/audit/webhook-events` | `source` (`RAZORPAY` by default, or `RAZORPAYX`), `eventType`, `outcome`, `eventId`, `paymentId`, `payoutId`, `problemsOnly`, `from`, `to`, `limit`, `cursor` | each signed event: its outcome, error and attempts, and the provider entity and status it named. Never its payload. |

A run with `since` re-reads (recovery) or compares with the provider only the records created since then; the database checks still cover everything, and it never marks anything cleared. Unknown fields are refused (`400 VALIDATION_FAILED`).

**Configuration**

| Variable | Default | Meaning |
|---|---|---|
| `COLLECTION_RECOVERY_INTERVAL_MINUTES` | `5` | 0 turns the timer off; an admin can still start a run. The startup log then lists it as an open item. |
| `COLLECTION_RECOVERY_MIN_AGE_MINUTES` | `5` | A younger pending collection is left to the webhook and the driver's app |
| `RECONCILIATION_INTERVAL_MINUTES` | `60` | 0 turns the timer off (listed in the startup log too) |
| `RECONCILIATION_PROVIDER_CHECKS` | `true` | The read-only provider checks |
| `RECONCILIATION_LOOKBACK_DAYS` | `3` (1–31) | How far back the provider checks and the webhook checks look |
| `RECONCILIATION_MIN_AGE_MINUTES` | `15` | Pending payments, unprocessed webhooks and pending refunds younger than this aren't reported |

**Testing.** The integration suite drives every category with the in-memory gateways (`reconciliation.int-spec.ts`, `audit.int-spec.ts`). Step 24 of the end-to-end run (section 16) recovers a QR whose webhook was lost and runs a full reconciliation. The end-to-end run sets `RECONCILIATION_PROVIDER_CHECKS=false`: its historical Checkout payment is made up by the runner, and Razorpay test mode would rightly report it as unknown. None of the provider checks has been run against Razorpay itself, in test or live mode. They use the same GET endpoints as the existing syncs.
