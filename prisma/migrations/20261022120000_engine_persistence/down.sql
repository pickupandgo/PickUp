-- Manual rollback of 20261022120000_engine_persistence. Prisma never runs this file.
--
-- It drops no data: it refuses once any booking is recorded (bookings, trips and the outbox are
-- the engine's record of what it registered with the payment backend). Otherwise it drops the
-- empty tables, their types and the outbox guard. Roll the engine back to its previous release
-- at the same time.
--
-- Then remove the migration's row from _prisma_migrations:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261022120000_engine_persistence';
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM engine_bookings) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261022120000: engine bookings are recorded';
    END IF;
END;
$$;

DROP TABLE "engine_outbox";
DROP TABLE "engine_trips";
DROP TABLE "engine_offers";
DROP TABLE "engine_stops";
DROP TABLE "engine_bookings";
DROP FUNCTION IF EXISTS prevent_pending_outbox_delete();
DROP TYPE "engine_outbox_status";
DROP TYPE "engine_outbox_mode";
DROP TYPE "engine_outbox_kind";
DROP TYPE "engine_stop_status";
DROP TYPE "engine_trip_status";
DROP TYPE "engine_offer_status";
DROP TYPE "engine_payment_method";
DROP TYPE "engine_booking_status";
COMMIT;
