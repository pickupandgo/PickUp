-- Read-only inventory before the PAY AT PICKUP / per-drop PAY AT DELIVERY migrations
-- (20261015120000_booking_quote_snapshot, 20261016120000_per_stop_obligation_schema,
-- 20261017120000_payment_gate_stop_lifecycle, 20261018120000_partially_paid_mixed_enums,
-- 20261018120100_obligation_collections, and later payment-flow migrations). Run it in every
-- environment that holds data, and review the output before migrating:
--   psql "$DATABASE_URL" -f prisma/sql/preflight-payment-flow.sql
-- It only SELECTs; the transaction is READ ONLY so it cannot change anything by mistake. Every
-- query works at any schema level: columns and tables a migration adds show as NULL / false
-- until it has been applied.
BEGIN TRANSACTION READ ONLY;

\echo '== Applied migrations (latest 5) =='
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 5;

\echo '== Bookings by payment method, booking status and payment status =='
SELECT payment_method, status, payment_status, count(*) AS bookings
FROM bookings GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== Unfinished bookings (not COMPLETED / CANCELLED) by method and trip status =='
SELECT b.payment_method, b.payment_status, COALESCE(t.status::text, '(no trip)') AS trip_status,
       count(*) AS bookings
FROM bookings b LEFT JOIN trips t ON t.booking_id = b.id
WHERE b.status NOT IN ('COMPLETED', 'CANCELLED')
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== Rows the new rules would hold up: unpaid PAY_AT_PICKUP past arrival, unpaid PAY_AT_DELIVERY at delivery, unpaid PREPAID_UPI in progress =='
SELECT b.payment_method, t.status AS trip_status, count(*) AS bookings
FROM bookings b JOIN trips t ON t.booking_id = b.id
WHERE b.payment_status = 'UNPAID'
  AND b.status NOT IN ('COMPLETED', 'CANCELLED')
  AND (
       (b.payment_method = 'PAY_AT_PICKUP'
          AND t.status IN ('PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS', 'DELIVERED'))
    OR (b.payment_method = 'PAY_AT_DELIVERY' AND t.status = 'DELIVERED')
    OR (b.payment_method = 'PREPAID_UPI')
  )
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Paid but cancelled bookings (refund review today) =='
SELECT payment_method, payment_status, count(*) AS bookings
FROM bookings WHERE status = 'CANCELLED' AND payment_status <> 'UNPAID'
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Collections by stage, method and status =='
SELECT stage, method, status, count(*) AS collections, COALESCE(sum(amount_paise), 0) AS amount_paise
FROM payment_collections GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== Customer booking payments (prepaid) by status =='
SELECT purpose, status, count(*) AS payments, COALESCE(sum(amount_paise), 0) AS amount_paise
FROM payments GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Earnings by settlement and status =='
SELECT settlement, status, count(*) AS earnings, COALESCE(sum(net_amount_paise), 0) AS net_paise
FROM driver_earnings GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Payouts by status =='
SELECT status, count(*) AS payouts, COALESCE(sum(amount_paise), 0) AS amount_paise
FROM driver_payouts GROUP BY 1 ORDER BY 1;

\echo '== Wallets =='
SELECT count(*) AS wallets, COALESCE(sum(balance_paise), 0) AS total_balance_paise,
       count(*) FILTER (WHERE balance_paise < 0) AS negative_wallets
FROM driver_wallets;

\echo '== Fare module (present only after 20261014120100_fare_quotes) =='
SELECT to_regclass('public.fare_quotes') IS NOT NULL AS fare_tables_present;

\echo '== Bookings by payment model (NULL: before 20261015120000_booking_quote_snapshot, which marks them all LEGACY_BOOKING_LEVEL) =='
SELECT to_jsonb(b) ->> 'payment_model' AS payment_model, payment_method, count(*) AS bookings
FROM bookings b GROUP BY 1, 2 ORDER BY 1 NULLS FIRST, 2;

\echo '== Live (PENDING or COMPLETED) collections for a whole booking: at most 1 per booking is expected =='
SELECT count(*) FILTER (WHERE live > 1) AS bookings_with_several_live_collections,
       count(*) AS bookings_with_a_live_collection
FROM (SELECT booking_id, count(*) AS live
      FROM payment_collections c
      WHERE status IN ('PENDING', 'COMPLETED') AND to_jsonb(c) ->> 'booking_stop_id' IS NULL
      GROUP BY booking_id) per_booking;

\echo '== Booking stops and collections for a single drop (NULL: before the migration that adds them) =='
SELECT to_regclass('public.booking_stops') IS NOT NULL AS booking_stops_present,
       CASE WHEN to_regclass('public.booking_stops') IS NULL THEN NULL
            ELSE (xpath('/row/n/text()', query_to_xml(
                     'SELECT count(*) AS n FROM booking_stops', false, true, '')))[1]::text::bigint
       END AS booking_stops,
       CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_schema = 'public' AND table_name = 'payment_collections'
                               AND column_name = 'booking_stop_id') THEN NULL
            ELSE (xpath('/row/n/text()', query_to_xml(
                     'SELECT count(*) AS n FROM payment_collections WHERE booking_stop_id IS NOT NULL',
                     false, true, '')))[1]::text::bigint
       END AS collections_for_one_drop;

\echo '== Held at the pickup by the pickup gate (20261017120000): unpaid PAY_AT_PICKUP trips at DRIVER_ARRIVED, every model (NULL: before 20261015120000) =='
SELECT to_jsonb(b) ->> 'payment_model' AS payment_model, count(*) AS bookings
FROM bookings b JOIN trips t ON t.booking_id = b.id
WHERE b.payment_method = 'PAY_AT_PICKUP' AND b.payment_status = 'UNPAID'
  AND b.status NOT IN ('COMPLETED', 'CANCELLED') AND t.status = 'DRIVER_ARRIVED'
GROUP BY 1 ORDER BY 1 NULLS FIRST;

\echo '== Bookings priced per drop past the pickup: after 20261017120000 their trip moves through its drops, reported per drop =='
SELECT b.payment_method, b.payment_status, t.status AS trip_status, count(*) AS bookings
FROM bookings b JOIN trips t ON t.booking_id = b.id
WHERE to_jsonb(b) ->> 'payment_model' = 'QUOTE_PER_STOP'
  AND b.status NOT IN ('COMPLETED', 'CANCELLED')
  AND t.status IN ('PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS', 'DELIVERED', 'PAYMENT_CONFIRMED')
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== Booking stops by status (NULL: before the migration that adds them) =='
SELECT CASE WHEN to_regclass('public.booking_stops') IS NULL THEN NULL
            ELSE (xpath('/row/s/text()', query_to_xml(
                     'SELECT COALESCE(string_agg(status || ''='' || n, '', '' ORDER BY status), ''(none)'') AS s
                        FROM (SELECT status::text AS status, count(*) AS n FROM booking_stops GROUP BY 1) per_status',
                     false, true, '')))[1]::text
       END AS stops_by_status;

-- Payment flow Phase 4 (20261018120000_partially_paid_mixed_enums,
-- 20261018120100_obligation_collections): one collection per obligation.

\echo '== Phase 4 labels: PARTIALLY_PAID payment status and MIXED earning settlement (false: before 20261018120000) =='
SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
               WHERE t.typname = 'booking_payment_status' AND e.enumlabel = 'PARTIALLY_PAID') AS partially_paid_label,
       EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
               WHERE t.typname = 'earning_settlement' AND e.enumlabel = 'MIXED') AS mixed_label;

\echo '== Bookings priced per drop by method, status and payment status: after 20261018120100 a pay-at-delivery one is PARTIALLY_PAID until its last drop is paid =='
SELECT b.payment_method, b.status, b.payment_status, count(*) AS bookings
FROM bookings b
WHERE to_jsonb(b) ->> 'payment_model' = 'QUOTE_PER_STOP'
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '== Pending QR collections by booking model, method and stage: each pays only its own obligation (historical bookings: the whole booking) =='
SELECT to_jsonb(b) ->> 'payment_model' AS payment_model, b.payment_method, c.stage::text AS stage,
       count(*) AS pending_qrs, COALESCE(sum(c.amount_paise), 0) AS amount_paise
FROM payment_collections c JOIN bookings b ON b.id = c.booking_id
WHERE c.method::text = 'ONLINE_QR' AND c.status::text = 'PENDING'
GROUP BY 1, 2, 3 ORDER BY 1 NULLS FIRST, 2, 3;

\echo '== Earning sources (earning_collections, NULL: before 20261018120100) and earnings with no direct source (0 before it: one source each) =='
SELECT to_regclass('public.earning_collections') IS NOT NULL AS earning_collections_present,
       CASE WHEN to_regclass('public.earning_collections') IS NULL THEN NULL
            ELSE (xpath('/row/n/text()', query_to_xml(
                     'SELECT count(*) AS n FROM earning_collections', false, true, '')))[1]::text::bigint
       END AS earning_collection_rows,
       (SELECT count(*) FROM driver_earnings e
         WHERE to_jsonb(e) ->> 'collection_id' IS NULL AND to_jsonb(e) ->> 'payment_id' IS NULL) AS earnings_without_a_direct_source;

\echo '== Cash platform-fee debits by ledger key: per booking (historical bookings, and before Phase 4) or per collection (bookings priced per drop) =='
SELECT CASE WHEN to_jsonb(t) ->> 'idempotency_key' LIKE 'cash-ride-fee:collection:%' THEN 'per collection'
            ELSE 'per booking' END AS ledger_key,
       count(*) AS debits, COALESCE(sum(t.amount_paise), 0) AS amount_paise
FROM driver_wallet_transactions t
WHERE t.type::text = 'CASH_RIDE_FEE'
GROUP BY 1 ORDER BY 1;

ROLLBACK;
