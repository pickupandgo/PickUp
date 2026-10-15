-- Manual rollback of 20261016120000_per_stop_obligation_schema. Prisma never runs this file.
--
-- Run it only while no collection names a stop and no stop has lifecycle data: it refuses
-- otherwise, because dropping those columns would lose financial facts. Afterwards remove the
-- migration's row from _prisma_migrations so `prisma migrate deploy` can apply it again:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261016120000_per_stop_obligation_schema';
--
-- Every pre-existing row keeps its values: the migration only added columns, constraints and
-- indexes, and replaced two guard functions, which are restored here exactly as they were.

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM payment_collections WHERE booking_stop_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Refusing to roll back: collections for single drops exist';
    END IF;
    IF EXISTS (
        SELECT 1 FROM booking_stops
         WHERE status <> 'PENDING'
            OR arrived_at IS NOT NULL OR payment_confirmed_at IS NOT NULL
            OR delivered_at IS NOT NULL OR failed_at IS NOT NULL OR failure_reason IS NOT NULL
            OR cancelled_at IS NOT NULL OR resolved_at IS NOT NULL
            OR resolved_by_user_id IS NOT NULL OR resolution_reason IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Refusing to roll back: booking stops have lifecycle data';
    END IF;
END;
$$;

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

CREATE OR REPLACE FUNCTION guard_collection_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.booking_id <> OLD.booking_id
       OR NEW.trip_id <> OLD.trip_id
       OR NEW.stage <> OLD.stage
       OR NEW.method <> OLD.method
       OR NEW.amount_paise <> OLD.amount_paise
       OR NEW.collected_by_driver_id <> OLD.collected_by_driver_id
       OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_product IS DISTINCT FROM OLD.provider_product
       OR NEW.provider_reference_id IS DISTINCT FROM OLD.provider_reference_id
       OR NEW.platform_fee_paise IS DISTINCT FROM OLD.platform_fee_paise
       OR NEW.fee_rule_id IS DISTINCT FROM OLD.fee_rule_id
       OR NEW.wallet_transaction_id IS DISTINCT FROM OLD.wallet_transaction_id
       OR NEW.created_at <> OLD.created_at
       OR (OLD.provider_payment_id IS NOT NULL
           AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id) THEN
        RAISE EXCEPTION 'Collection amounts and references are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
           (OLD.status = 'PENDING' AND NEW.status IN ('COMPLETED', 'FAILED'))
        OR (OLD.status = 'COMPLETED' AND NEW.status = 'REVERSED')
    ) THEN
        RAISE EXCEPTION 'Invalid collection transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- One live collection per booking again. It holds: no collection names a stop (checked above),
-- so this is exactly the booking-level rule. Built before the new indexes are dropped.
CREATE UNIQUE INDEX "uq_collection_booking_active" ON "payment_collections"("booking_id") WHERE ((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('COMPLETED'::character varying)::text]));
DROP INDEX IF EXISTS "uq_collection_stop_active";
DROP INDEX IF EXISTS "uq_collection_booking_level_active";

ALTER TABLE "payment_collections"
    DROP CONSTRAINT IF EXISTS "collections_pickup_has_no_stop",
    DROP CONSTRAINT IF EXISTS "payment_collections_booking_id_booking_stop_id_fkey";
ALTER TABLE "payment_collections" DROP COLUMN IF EXISTS "booking_stop_id";

DROP INDEX IF EXISTS "uq_booking_stops_current";
ALTER TABLE "booking_stops"
    DROP CONSTRAINT IF EXISTS "booking_stops_reasons_not_blank",
    DROP CONSTRAINT IF EXISTS "booking_stops_resolution_complete",
    DROP CONSTRAINT IF EXISTS "booking_stops_failure_complete",
    DROP CONSTRAINT IF EXISTS "booking_stops_facts_follow_arrival",
    DROP CONSTRAINT IF EXISTS "booking_stops_status_facts",
    DROP CONSTRAINT IF EXISTS "booking_stops_pending_is_untouched",
    DROP CONSTRAINT IF EXISTS "booking_stops_resolved_by_user_id_fkey";
ALTER TABLE "booking_stops"
    DROP COLUMN IF EXISTS "resolved_by_user_id",
    DROP COLUMN IF EXISTS "resolved_at",
    DROP COLUMN IF EXISTS "resolution_reason",
    DROP COLUMN IF EXISTS "payment_confirmed_at",
    DROP COLUMN IF EXISTS "failure_reason",
    DROP COLUMN IF EXISTS "failed_at",
    DROP COLUMN IF EXISTS "delivered_at",
    DROP COLUMN IF EXISTS "cancelled_at",
    DROP COLUMN IF EXISTS "arrived_at";

COMMIT;
