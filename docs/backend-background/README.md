# Backend changes awaiting deployment

These patches implement the server portion of the Partner background task. They have **not** been committed, pushed, deployed, or applied to a live database.

| Patch | Branch base |
| --- | --- |
| [raj_backend.patch](./raj_backend.patch) | `raj_backend` at `06ae0b5bbd2e896bf781a2b42ab550b783be6948` |
| [raj_engine.patch](./raj_engine.patch) | `raj_engine` at `496b2364e0355d1b1f33cef50c7ffa913ebfa4e0` |

Both source checkouts are isolated under the Codex visualization work directory. The older local backend exports and the Customer App were not modified. The patches include new files, and were checked in reverse against the implemented working trees. Review against the current remote branches before applying; do not overwrite someone else's later work.

## Changes

Payments backend:

- Authenticated internal pre-offer routing using the existing Google Routes service and persisted fare-quote stops.
- Authenticated engine-to-backend offer and cancelled-offer notifications.
- Transactional notification capture on committed ledger, earnings, payout, collection, settlement, trip/drop, KYC, vehicle/document, profile and account transitions.
- Durable notification outbox with retry backoff, recipient/device ownership checks, per-device checkpoints, stable notification IDs and Android notification tags.
- Backend unread counts, read-all, category preferences and essential account-notice handling.
- Configurable wallet alert thresholds, hysteresis and cooldown.

Engine:

- Persisted explicit Online preference, independent of fresh GPS and active-trip eligibility.
- Fresh-location guards for dispatch and new assignments.
- Targeted, unexpired-offer road routing with server-side itinerary resolution and request limits.
- Retryable delivery of persisted offer notifications without blocking dispatch progression.

No new monetary field, fare rule, wallet deduction, payout calculation or price-dependent Accept condition is introduced.

## Migrations

- Engine: `20261102220000_driver_availability`.
- Payments backend: `20261102221500_partner_notification_outbox`.

The notification migration creates triggers inside the existing business transactions. Failed transactions do not leave inbox or queue entries. The triggers insert notification/configuration records only; they do not update financial or trip state.

The SQL behavior was exercised with isolated PostgreSQL fixture tables through PGlite. This is **not** a substitute for applying the full historical migrations and exercising the restricted deployment role on a staging PostgreSQL instance. Docker's PostgreSQL service was unavailable during this task. Do not skip that staging check.

Where a restricted API role is used, review grants for:

- Reading/writing `notification_outbox`.
- Reading/writing `partner_notification_policy` for approved server configuration.
- Reading the existing inbox and preferences, including the added columns.
- Engine availability and offer notification columns.

The security-definer notification helpers use a fixed search path and do not grant public access to the helper that creates Partner notices. Confirm function ownership and schema permissions with the actual migration/API roles.

## Configuration and rollout

Keep the existing Firebase project, Firebase Admin application-default credentials, routing key, internal API keys and service hosts. No credentials are included in these patches.

Existing push requirements remain `FCM_ENABLED=true`, `FCM_PROJECT_ID`, and authorized Admin credentials on the server. A disabled/unconfigured dispatcher does not pretend that a push was sent. Inbox/queue records remain persisted.

Wallet alerts require all four approved server settings:

- `PARTNER_WALLET_LOW_PAISE`
- `PARTNER_WALLET_CRITICAL_PAISE`
- `PARTNER_WALLET_HYSTERESIS_PAISE`
- `PARTNER_WALLET_ALERT_COOLDOWN_SECONDS`

No production threshold was chosen. The validated settings populate a persisted policy row; removing environment variables does not erase a previously configured policy. Review policy changes with operations rather than assuming unset variables delete saved configuration.

Suggested rollout sequence after review:

1. Verify the deployed engine host/branch and the payments host/branch against the application's environment. A Git branch head does not prove a live deployment SHA.
2. Test full migrations, transactional rollback, grants, concurrent dispatch and outbox recovery in staging.
3. Coordinate the old synchronous FCM sender and the new queue worker during deployment so migration-time events are not sent twice. Avoid running both delivery paths for the same queue backlog.
4. Apply the payments migration and deploy its API/worker, then apply the engine migration and deploy the engine. Ensure the internal keys/hosts match.
5. Have Online Partners explicitly refresh their availability after the engine migration. Historical in-memory availability is deliberately not guessed or backfilled.
6. Test real owned offers, road routes, cancellation, actual wallet/settlement events and notification taps using approved test accounts/events.
7. Test the optional overlay through the approved Play Store testing flow, as requested by the user.

FCM acceptance is not device delivery or a read acknowledgement. The queue is at least once: a crash after FCM accepts a send but before its checkpoint can retry that send. Stable inbox IDs, notification tags and client deduplication handle that window. Queue completion also covers opt-out, no active devices and expired offers; `delivered_at` must not be treated as proof that a phone displayed the notice.

Unsupported backend features do not generate fabricated events: delivery-proof moderation, document-expiry scheduling, support replies and announcements still need their own authoritative event sources if those features are added.
