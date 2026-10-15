-- Manual rollback of 20261018120000_partially_paid_mixed_enums. Prisma never runs this file.
-- Run it after 20261018120100_obligation_collections/down.sql.
--
-- PostgreSQL cannot drop an enum value, so this recreates both types without the Phase 4 values
-- and moves their columns over. It refuses while any row uses PARTIALLY_PAID or MIXED. Changing
-- the type of bookings.payment_status and driver_earnings.settlement rewrites those two tables
-- (every value stays the same) under an exclusive lock: run it in a maintenance window.
--
-- Then remove the migration's row from _prisma_migrations, so `prisma migrate deploy` can apply
-- it again:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261018120000_partially_paid_mixed_enums';

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bookings WHERE payment_status::text = 'PARTIALLY_PAID') THEN
        RAISE EXCEPTION 'Refusing to roll back 20261018120000: some bookings are PARTIALLY_PAID';
    END IF;
    IF EXISTS (SELECT 1 FROM driver_earnings WHERE settlement::text = 'MIXED') THEN
        RAISE EXCEPTION 'Refusing to roll back 20261018120000: some earnings are MIXED';
    END IF;
END;
$$;

-- bookings.payment_status
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_completed_is_paid";
ALTER TABLE "bookings" ALTER COLUMN "payment_status" DROP DEFAULT;
ALTER TYPE "booking_payment_status" RENAME TO "booking_payment_status_phase4";
CREATE TYPE "booking_payment_status" AS ENUM ('UNPAID', 'PAID', 'REFUND_PENDING', 'REFUNDED');
ALTER TABLE "bookings"
    ALTER COLUMN "payment_status" TYPE "booking_payment_status"
    USING payment_status::text::"booking_payment_status";
ALTER TABLE "bookings" ALTER COLUMN "payment_status" SET DEFAULT 'UNPAID';
DROP TYPE "booking_payment_status_phase4";
ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_completed_is_paid" CHECK (status <> 'COMPLETED' OR payment_status <> 'UNPAID');

-- driver_earnings.settlement
ALTER TABLE "driver_earnings"
    DROP CONSTRAINT "earnings_awaiting_settlement_shape",
    DROP CONSTRAINT "earnings_cash_from_collection",
    DROP CONSTRAINT "earnings_cash_has_no_settlement_link",
    DROP CONSTRAINT "earnings_cash_is_settled",
    DROP CONSTRAINT "earnings_online_settled_before_payable";
ALTER TYPE "earning_settlement" RENAME TO "earning_settlement_phase4";
CREATE TYPE "earning_settlement" AS ENUM ('ONLINE', 'CASH');
ALTER TABLE "driver_earnings"
    ALTER COLUMN "settlement" TYPE "earning_settlement"
    USING settlement::text::"earning_settlement";
DROP TYPE "earning_settlement_phase4";
ALTER TABLE "driver_earnings"
    ADD CONSTRAINT "earnings_awaiting_settlement_shape"
        CHECK (status <> 'AWAITING_SETTLEMENT'
               OR (settlement = 'ONLINE' AND payment_settlement_id IS NULL AND payable_at IS NULL)),
    ADD CONSTRAINT "earnings_cash_from_collection" CHECK (settlement <> 'CASH' OR collection_id IS NOT NULL),
    ADD CONSTRAINT "earnings_cash_has_no_settlement_link"
        CHECK (settlement <> 'CASH' OR (payment_settlement_id IS NULL AND payable_at IS NULL)),
    ADD CONSTRAINT "earnings_cash_is_settled" CHECK ((settlement = 'CASH') = (status = 'SETTLED_IN_CASH')),
    ADD CONSTRAINT "earnings_online_settled_before_payable"
        CHECK (settlement <> 'ONLINE' OR status NOT IN ('PAYABLE', 'IN_PAYOUT', 'PAID')
               OR payment_settlement_id IS NOT NULL);

COMMIT;
