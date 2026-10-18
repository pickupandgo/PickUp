-- Manual rollback of 20261021120000_financial_events. Prisma never runs this file.
-- Run 20261021120100_reconciliation_findings/down.sql first.
--
-- It drops no data: the event log is the audit trail, so it refuses once any financial event is
-- recorded (export financial_events first if a rollback is ever really needed). Otherwise it
-- drops the event triggers on the financial tables, their functions and the empty table. No
-- financial record changes. Roll the backend back to the previous release at the same time
-- (the Phase 6 backend never sets the transaction-local actor settings, which is harmless).
--
-- Then remove the migration's row from _prisma_migrations, so `prisma migrate deploy` can apply
-- it again:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261021120000_financial_events';
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM financial_events) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261021120000: financial events are recorded (export financial_events first)';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_financial_event ON "bookings";
DROP TRIGGER IF EXISTS trg_trips_financial_event ON "trips";
DROP TRIGGER IF EXISTS trg_booking_stops_financial_event ON "booking_stops";
DROP TRIGGER IF EXISTS trg_payments_financial_event ON "payments";
DROP TRIGGER IF EXISTS trg_payment_collections_financial_event ON "payment_collections";
DROP TRIGGER IF EXISTS trg_payment_settlements_financial_event ON "payment_settlements";
DROP TRIGGER IF EXISTS trg_payment_disputes_financial_event ON "payment_disputes";
DROP TRIGGER IF EXISTS trg_payment_refunds_financial_event ON "payment_refunds";
DROP TRIGGER IF EXISTS trg_driver_earnings_financial_event ON "driver_earnings";
DROP TRIGGER IF EXISTS trg_payout_batches_financial_event ON "payout_batches";
DROP TRIGGER IF EXISTS trg_driver_payouts_financial_event ON "driver_payouts";
DROP TRIGGER IF EXISTS trg_payout_items_financial_event ON "payout_items";
DROP TRIGGER IF EXISTS trg_wallet_tx_financial_event ON "driver_wallet_transactions";
DROP TRIGGER IF EXISTS trg_admin_actions_financial_event ON "admin_actions";

DROP TABLE "financial_events";
DROP FUNCTION IF EXISTS record_financial_event();
DROP FUNCTION IF EXISTS guard_financial_event_insert();
DROP FUNCTION IF EXISTS prevent_financial_event_mutation();
DROP FUNCTION IF EXISTS financial_event_setting(text, integer);
DROP FUNCTION IF EXISTS financial_event_uuid(text);
COMMIT;
