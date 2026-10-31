# Database readiness reliability — staging investigation

## Confirmed evidence (2026-10-31, UTC)

The original readiness check performed lazy Prisma initialization and its first real database
query inside a 2,000 ms HTTP deadline. The diagnostic-only release
`1a1f025ed3bfae3764818a9fa8ada5b825f7dac4` reproduced the reported 503 → 200 behavior
against the actual Render service and its internal PostgreSQL connection.

At 11:42:32, request `94a57636-d255-40d6-b72b-0cd4f0015efc` exceeded the deadline:

- Prisma initialization: 2,103 ms.
- First connection/query path: 1,398 ms, including connection establishment and application work.
- Underlying work completed after 3,502 ms; the HTTP failure was logged after 2,500 ms.
- Pool at failure: one connection being established, zero queued waiters, zero established connections.
- Subsequent readiness requests returned 200; the third took 291 ms end to end.

These are application timings, not SQL execution times. External client request latency includes
networking and scheduling. A read-only synthetic account lookup took 0.079 ms SQL execution
and 0.763 ms planning. Historical database evidence showed no blocked queries, long transactions,
deadlocks or connection exhaustion; maximum observed connections were 7 of 100. PostgreSQL
had not restarted since October 23. Historical logs did not preserve the underlying exception,
so they cannot establish the cause of every reported Customer timeout or Firebase verification latency.

## Correction

Nest now awaits real Prisma initialization **and SELECT 1** before opening the HTTP listener.
`$connect()` alone does not exercise the entire first query/physical connection path.
Initialization failure stops startup with a sanitized error, rather than exposing a live process
whose database path has not been initialized.

Readiness still executes a real database probe with the same 2,000 ms deadline and generic
503 failure contract. Concurrent probes share one underlying attempt until it settles, even
after HTTP timeouts. Prisma work is not canceled by Promise.race; sharing prevents repeated
health requests from accumulating additional database queries. Existing connection and statement
timeouts bound driver work. A timed-out probe does not cancel another request's transaction.

Pool ownership, size, acquisition/idle/statement timeouts, financial transactions, authentication,
Customer APIs, KYC, migrations and environment values are unchanged. There is no readiness cache
that returns success without checking the database. Slow, failed and late probes retain only
request IDs, phase timings, pool counts and classified error codes in server logs. Public health
responses expose none of those details.

## Verification and operating limits

Focused unit coverage checks startup gating, safe failure logging, timeout handling, one shared
probe after HTTP deadlines, and recovery. The isolated PostgreSQL integration test interrupts only
its own loopback proxy connections, verifies liveness 200/readiness 503 during an actual outage,
then verifies readiness and authenticated Customer access recover. It cannot target a remote DB.

Render configuration is checked against the original environment fingerprint before deployment.
No staging migrations, grants, credentials or security settings are changed. Manual KYC remains
enabled with STAGING_KYC_V1. The service uses Render Free; this code change cannot guarantee
availability during platform spin-up, instance replacement, resource throttling or upstream outages.
Those risks must not be described as permanently eliminated. A fresh real Customer Firebase token
is required to complete live authenticated acceptance; locally signed test tokens are never sent
to staging. See CODEX_MEMORY.md in the workspace for deployment and live-probe results.
