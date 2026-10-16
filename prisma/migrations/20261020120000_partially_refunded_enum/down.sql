-- Manual rollback of 20261020120000_partially_refunded_enum. Prisma never runs this file.
-- Run it after 20261020120100_refunds/down.sql.
--
-- PostgreSQL cannot drop an enum value, so this recreates booking_payment_status without
-- PARTIALLY_REFUNDED and moves bookings.payment_status over. It refuses while any booking is
-- PARTIALLY_REFUNDED. Changing the column type rewrites bookings (every value stays the same)
-- under an exclusive lock: run it in a maintenance window.
--
-- Then remove the migration's row from _prisma_migrations, so `prisma migrate deploy` can apply
-- it again:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261020120000_partially_refunded_enum';
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bookings WHERE payment_status::text = 'PARTIALLY_REFUNDED') THEN
        RAISE EXCEPTION 'Refusing to roll back 20261020120000: some bookings are PARTIALLY_REFUNDED';
    END IF;
END;
$$;
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_completed_is_paid";
ALTER TABLE "bookings" ALTER COLUMN "payment_status" DROP DEFAULT;
ALTER TYPE "booking_payment_status" RENAME TO "booking_payment_status_phase6";
CREATE TYPE "booking_payment_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUND_PENDING', 'REFUNDED');
ALTER TABLE "bookings"
    ALTER COLUMN "payment_status" TYPE "booking_payment_status"
    USING payment_status::text::"booking_payment_status";
ALTER TABLE "bookings" ALTER COLUMN "payment_status" SET DEFAULT 'UNPAID';
DROP TYPE "booking_payment_status_phase6";
ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_completed_is_paid" CHECK (status <> 'COMPLETED' OR payment_status <> 'UNPAID');
COMMIT;
