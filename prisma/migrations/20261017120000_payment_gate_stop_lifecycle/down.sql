-- Manual rollback of 20261017120000_payment_gate_stop_lifecycle. Prisma never runs this file.
--
-- It drops no data: the migration added no columns and rewrote no rows. It restores the trip
-- guard and the stop guard exactly as they were before (20261006120000 and 20261015120000) and
-- drops the resolution audit check. Stops keep any lifecycle facts already recorded; the
-- restored stop guard freezes them again, and 20261016120000's down.sql then refuses to run.
--
-- Rolling back removes the pickup gate and the stop lifecycle from the database, so roll the
-- backend back to the previous release at the same time (the restored stop guard refuses every
-- drop move the Phase 3 code makes). Then remove the stop lifecycle grant and the migration's
-- row from _prisma_migrations, so `prisma migrate deploy` can apply it again:
--   REVOKE UPDATE ON booking_stops FROM mr_app;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261017120000_payment_gate_stop_lifecycle';

BEGIN;

DROP TRIGGER IF EXISTS trg_booking_stops_resolution_audit ON "booking_stops";
DROP FUNCTION IF EXISTS check_booking_stop_resolution_audit();

-- The guards as they were before this migration.
CREATE OR REPLACE FUNCTION guard_booking_stop_update() RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.booking_id <> OLD.booking_id
       OR NEW.fare_quote_stop_id <> OLD.fare_quote_stop_id
       OR NEW.sequence <> OLD.sequence
       OR NEW.fare_paise <> OLD.fare_paise
       OR NEW.tax_paise <> OLD.tax_paise
       OR NEW.payable_paise <> OLD.payable_paise
       OR NEW.platform_fee_share_paise <> OLD.platform_fee_share_paise
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Booking stop amounts and references are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RAISE EXCEPTION 'Booking stop lifecycle changes are not enabled yet'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_trip_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'DRIVER_ASSIGNED' THEN
            RAISE EXCEPTION 'A trip starts at DRIVER_ASSIGNED' USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.id <> OLD.id OR NEW.booking_id <> OLD.booking_id OR NEW.driver_id <> OLD.driver_id
       OR NEW.assigned_at <> OLD.assigned_at OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Trip booking, driver and assignment are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
           (NEW.status = 'CANCELLED' AND OLD.status NOT IN ('COMPLETED', 'CANCELLED'))
        OR (OLD.status = 'DRIVER_ASSIGNED' AND NEW.status = 'DRIVER_ARRIVED')
        OR (OLD.status = 'DRIVER_ARRIVED' AND NEW.status = 'PICKUP_VERIFIED')
        OR (OLD.status = 'PICKUP_VERIFIED' AND NEW.status = 'IN_TRANSIT')
        OR (OLD.status = 'IN_TRANSIT' AND NEW.status = 'DROP_PROGRESS')
        OR (OLD.status = 'DROP_PROGRESS' AND NEW.status = 'DELIVERED')
        OR (OLD.status = 'DELIVERED' AND NEW.status = 'PAYMENT_CONFIRMED')
        OR (OLD.status = 'PAYMENT_CONFIRMED' AND NEW.status = 'COMPLETED')
    ) THEN
        RAISE EXCEPTION 'Invalid trip transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'PAYMENT_CONFIRMED' AND OLD.status <> 'PAYMENT_CONFIRMED' AND NOT EXISTS (
        SELECT 1 FROM bookings b WHERE b.id = NEW.booking_id AND b.payment_status <> 'UNPAID'
    ) THEN
        RAISE EXCEPTION 'Trip payment cannot be confirmed for an unpaid booking'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;
