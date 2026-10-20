-- Manual rollback of 20261018120100_obligation_collections. Prisma never runs this file.
-- Run it before 20261018120000_partially_paid_mixed_enums/down.sql.
--
-- It drops no data: it refuses once an earning is linked to its collections or a drop has its own
-- collection, the only rows the previous rules can't explain. It restores the collection insert
-- guard (20261016120000), the booking update guard (20261015120000) and the earnings CHECKs
-- exactly as they were, and drops earning_collections and the Phase 4 checks.
--
-- Rolling back removes per-drop collection from the database, so roll the backend back to the
-- previous release at the same time. Then remove the drop payment grant and the migration's row
-- from _prisma_migrations, so `prisma migrate deploy` can apply it again:
--   REVOKE UPDATE (payment_confirmed_at) ON booking_stops FROM mr_app;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261018120100_obligation_collections';

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM earning_collections) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261018120100: earnings are linked to their collections';
    END IF;
    IF EXISTS (SELECT 1 FROM payment_collections WHERE booking_stop_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261018120100: drops have their own collections';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_earnings_sources ON "driver_earnings";
DROP FUNCTION IF EXISTS check_earning_sources();
DROP TABLE "earning_collections";
DROP FUNCTION IF EXISTS guard_earning_collection_insert();
DROP FUNCTION IF EXISTS guard_earning_collection_update();
DROP TRIGGER IF EXISTS trg_collections_effects ON "payment_collections";
DROP FUNCTION IF EXISTS check_collection_effects();

ALTER TABLE "driver_earnings"
    DROP CONSTRAINT "earnings_single_source",
    DROP CONSTRAINT "earnings_cash_from_collection",
    DROP CONSTRAINT "earnings_mixed_from_collections",
    DROP CONSTRAINT "earnings_awaiting_settlement_shape",
    DROP CONSTRAINT "earnings_online_settled_before_payable",
    ADD CONSTRAINT "earnings_single_source" CHECK ((payment_id IS NULL) <> (collection_id IS NULL)),
    ADD CONSTRAINT "earnings_cash_from_collection" CHECK (settlement <> 'CASH' OR collection_id IS NOT NULL),
    ADD CONSTRAINT "earnings_awaiting_settlement_shape"
        CHECK (status <> 'AWAITING_SETTLEMENT'
               OR (settlement = 'ONLINE' AND payment_settlement_id IS NULL AND payable_at IS NULL)),
    ADD CONSTRAINT "earnings_online_settled_before_payable"
        CHECK (settlement <> 'ONLINE' OR status NOT IN ('PAYABLE', 'IN_PAYOUT', 'PAID')
               OR payment_settlement_id IS NOT NULL);
COMMENT ON COLUMN "driver_earnings"."collection_id" IS NULL;

-- The guards as they were before this migration.
CREATE OR REPLACE FUNCTION guard_collection_insert() RETURNS trigger AS $$
DECLARE
    b RECORD;
BEGIN
    SELECT payment_method, payment_model, final_fare_minor, platform_fee_paise
      INTO b
      FROM bookings WHERE id = NEW.booking_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking % does not exist', NEW.booking_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF b.payment_method = 'PREPAID_UPI' THEN
        RAISE EXCEPTION 'Prepaid bookings are paid in the app, never collected by the driver'
            USING ERRCODE = 'check_violation';
    END IF;
    IF (b.payment_method = 'PAY_AT_PICKUP') <> (NEW.stage = 'PICKUP') THEN
        RAISE EXCEPTION 'A % booking cannot be collected at stage %', b.payment_method, NEW.stage
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.booking_stop_id IS NOT NULL
       AND NOT (b.payment_model = 'QUOTE_PER_STOP' AND NEW.stage = 'DELIVERY') THEN
        RAISE EXCEPTION 'Only a drop of a pay-at-delivery booking priced per drop is collected on its own'
            USING ERRCODE = 'check_violation';
    END IF;
    IF b.payment_model = 'QUOTE_PER_STOP' AND NEW.stage = 'DELIVERY' THEN
        RAISE EXCEPTION 'Per-drop collections for pay-at-delivery bookings are not enabled yet'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.amount_paise <> b.final_fare_minor THEN
        RAISE EXCEPTION 'A collection must be for the booking''s payable amount'
            USING ERRCODE = 'check_violation';
    END IF;
    IF b.payment_model = 'QUOTE_PER_STOP' AND NEW.method = 'CASH'
       AND NEW.platform_fee_paise IS DISTINCT FROM b.platform_fee_paise THEN
        RAISE EXCEPTION 'A cash collection must debit the booking''s frozen platform fee'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_booking_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.external_ref <> OLD.external_ref
       OR NEW.customer_id <> OLD.customer_id
       OR NEW.vehicle_category IS DISTINCT FROM OLD.vehicle_category
       OR NEW.fare_estimate_minor <> OLD.fare_estimate_minor
       OR NEW.final_fare_minor <> OLD.final_fare_minor
       OR NEW.payment_method <> OLD.payment_method
       OR NEW.fee_rule_id <> OLD.fee_rule_id
       OR NEW.confirmed_at <> OLD.confirmed_at
       OR NEW.created_at <> OLD.created_at
       OR NEW.payment_model <> OLD.payment_model
       OR NEW.fare_quote_id IS DISTINCT FROM OLD.fare_quote_id
       OR NEW.pricing_version_id IS DISTINCT FROM OLD.pricing_version_id
       OR NEW.fare_paise IS DISTINCT FROM OLD.fare_paise
       OR NEW.tax_paise IS DISTINCT FROM OLD.tax_paise
       OR NEW.platform_fee_paise IS DISTINCT FROM OLD.platform_fee_paise THEN
        RAISE EXCEPTION 'Confirmed booking terms (customer, fare snapshot, payment method, fee rule) are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
           (OLD.status = 'CREATED' AND NEW.status IN ('SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'CANCELLED'))
        OR (OLD.status = 'SEARCHING_DRIVER' AND NEW.status IN ('DRIVER_ASSIGNED', 'CANCELLED'))
        OR (OLD.status = 'DRIVER_ASSIGNED' AND NEW.status IN ('COMPLETED', 'CANCELLED'))
    ) THEN
        RAISE EXCEPTION 'Invalid booking transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.payment_status <> OLD.payment_status AND NOT (
           (OLD.payment_status = 'UNPAID' AND NEW.payment_status = 'PAID')
        OR (OLD.payment_status = 'PAID' AND NEW.payment_status = 'REFUND_PENDING')
        OR (OLD.payment_status = 'REFUND_PENDING' AND NEW.payment_status = 'REFUNDED')
    ) THEN
        RAISE EXCEPTION 'Invalid booking payment transition % -> %', OLD.payment_status, NEW.payment_status
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS booking_collected_status(uuid);

COMMIT;
