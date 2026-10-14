-- Manual rollback of 20261015120000_booking_quote_snapshot. Prisma never runs this file.
--
-- Run it only on a database where no QUOTE_PER_STOP booking exists yet: it refuses otherwise,
-- because dropping the snapshot of a real booking would lose financial data. Afterwards remove
-- the migration's row from _prisma_migrations so `prisma migrate deploy` can apply it again:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261015120000_booking_quote_snapshot';
--
-- The enum types are dropped too (nothing else uses them). Every pre-existing row keeps its
-- values: the migration only added columns, tables, constraints and triggers.

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bookings WHERE payment_model = 'QUOTE_PER_STOP') THEN
        RAISE EXCEPTION 'Refusing to roll back: QUOTE_PER_STOP bookings exist';
    END IF;
    -- The previous schema allowed at most 5 drops per quote; never drop a quote's drops to fit.
    IF EXISTS (SELECT 1 FROM fare_quote_stops WHERE sequence > 5) THEN
        RAISE EXCEPTION 'Refusing to roll back: fare quotes with more than 5 drops exist';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_collections_insert_guard ON "payment_collections";
DROP FUNCTION IF EXISTS guard_collection_insert();

DROP TRIGGER IF EXISTS trg_payments_booking_insert_guard ON "payments";
DROP FUNCTION IF EXISTS guard_booking_payment_insert();

DROP TRIGGER IF EXISTS trg_bookings_snapshot ON "bookings";
DROP TRIGGER IF EXISTS trg_bookings_insert_guard ON "bookings";
DROP FUNCTION IF EXISTS guard_booking_insert();

-- booking_stops has a no-truncate trigger, and no rows can exist (no QUOTE_PER_STOP booking).
DROP TABLE IF EXISTS "booking_stops";
DROP FUNCTION IF EXISTS check_booking_snapshot();
DROP FUNCTION IF EXISTS guard_booking_stop_insert();
DROP FUNCTION IF EXISTS guard_booking_stop_update();

-- The booking guard as it was before this migration.
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
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Confirmed booking terms (customer, fare, payment method, fee rule) are immutable'
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

ALTER TABLE "bookings"
    DROP CONSTRAINT IF EXISTS "bookings_quote_bookings_not_prepaid",
    DROP CONSTRAINT IF EXISTS "bookings_snapshot_shape",
    DROP CONSTRAINT IF EXISTS "bookings_pricing_version_id_fkey",
    DROP CONSTRAINT IF EXISTS "bookings_fare_quote_id_fkey";
DROP INDEX IF EXISTS "idx_bookings_pricing_version";
DROP INDEX IF EXISTS "uq_bookings_fare_quote";
ALTER TABLE "bookings"
    DROP COLUMN IF EXISTS "tax_paise",
    DROP COLUMN IF EXISTS "pricing_version_id",
    DROP COLUMN IF EXISTS "platform_fee_paise",
    DROP COLUMN IF EXISTS "payment_model",
    DROP COLUMN IF EXISTS "fare_quote_id",
    DROP COLUMN IF EXISTS "fare_paise";

ALTER TABLE "fare_quote_stops"
    DROP CONSTRAINT "fare_quote_stops_sequence_range",
    ADD CONSTRAINT "fare_quote_stops_sequence_range" CHECK (sequence BETWEEN 1 AND 5);

DROP TYPE IF EXISTS "booking_stop_status";
DROP TYPE IF EXISTS "booking_payment_model";

COMMIT;
