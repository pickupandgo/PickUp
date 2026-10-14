-- Read-only inventory before the PAY AT PICKUP / per-drop PAY AT DELIVERY migrations.
-- Run it in every environment that holds data, and review the output before migrating:
--   psql "$DATABASE_URL" -f prisma/sql/preflight-payment-flow.sql
-- It only SELECTs; the transaction is READ ONLY so it cannot change anything by mistake.
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

ROLLBACK;
