-- Manual rollback of 20261020120100_refunds. Prisma never runs this file.
-- Run it before 20261020120000_partially_refunded_enum/down.sql.
--
-- It drops no data the previous rules can't rebuild: it refuses once any refund is recorded, or
-- any booking is being or has been refunded, because the previous rules can't explain those.
-- Otherwise it restores the booking guard and the collection effects check of 20261018120100
-- and the collection guard of 20261016120000 exactly as they were, and drops the refund table,
-- its functions and triggers, the ledger rule for REFUND_REVERSAL credits and
-- payment_collections.refunded_paise. Roll the backend back to the previous release at the
-- same time.
--
-- Then remove the migration's row from _prisma_migrations, so `prisma migrate deploy` can apply
-- it again:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261020120100_refunds';
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM payment_refunds) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261020120100: refunds are recorded';
    END IF;
    IF EXISTS (SELECT 1 FROM bookings
                WHERE payment_status::text IN ('REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED')) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261020120100: some bookings are being or have been refunded';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_refund_reversal ON "driver_wallet_transactions";
DROP FUNCTION IF EXISTS check_refund_reversal_entry();
ALTER TABLE "driver_wallet_transactions" DROP CONSTRAINT "wallet_tx_refund_reversal_shape";

DROP TABLE "payment_refunds";
DROP FUNCTION IF EXISTS guard_refund_insert();
DROP FUNCTION IF EXISTS guard_refund_update();
DROP FUNCTION IF EXISTS sync_collection_refunded();
DROP FUNCTION IF EXISTS check_refund_effects();

-- The booking guard of 20261018120100.
CREATE OR REPLACE FUNCTION guard_booking_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_collected text;
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
           (OLD.payment_status = 'UNPAID' AND NEW.payment_status IN ('PARTIALLY_PAID', 'PAID'))
        OR (OLD.payment_status = 'PARTIALLY_PAID' AND NEW.payment_status = 'PAID')
        OR (OLD.payment_status = 'PAID' AND NEW.payment_status = 'REFUND_PENDING')
        OR (OLD.payment_status = 'REFUND_PENDING' AND NEW.payment_status = 'REFUNDED')
    ) THEN
        RAISE EXCEPTION 'Invalid booking payment transition % -> %', OLD.payment_status, NEW.payment_status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.payment_status = 'PARTIALLY_PAID'
       AND NOT (NEW.payment_method = 'PAY_AT_DELIVERY' AND NEW.payment_model = 'QUOTE_PER_STOP') THEN
        RAISE EXCEPTION 'Only a booking paid drop by drop can be partially paid'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.payment_status <> OLD.payment_status
       AND NEW.payment_model = 'QUOTE_PER_STOP'
       AND NEW.payment_status IN ('PARTIALLY_PAID', 'PAID') THEN
        v_collected := booking_collected_status(NEW.id);
        IF NEW.payment_status::text <> v_collected THEN
            RAISE EXCEPTION 'A booking''s payment status follows its completed collections: they say %', v_collected
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- The collection effects check of 20261018120100.
CREATE OR REPLACE FUNCTION check_collection_effects() RETURNS trigger AS $$
DECLARE
    b RECORD;
    v_status text;
    v_collected text;
    v_stop_status text;
BEGIN
    SELECT payment_model, payment_status::text AS payment_status
      INTO b
      FROM bookings WHERE id = NEW.booking_id;
    IF b.payment_model <> 'QUOTE_PER_STOP' THEN
        RETURN NULL;
    END IF;
    SELECT status INTO v_status FROM payment_collections WHERE id = NEW.id;
    IF v_status IS DISTINCT FROM 'COMPLETED' THEN
        RETURN NULL;
    END IF;
    IF b.payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID') THEN
        v_collected := booking_collected_status(NEW.booking_id);
        IF b.payment_status <> v_collected THEN
            RAISE EXCEPTION 'Booking % is % but its completed collections say %: the payment status changes with the collection', NEW.booking_id, b.payment_status, v_collected
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.booking_stop_id IS NOT NULL THEN
        SELECT status::text INTO v_stop_status FROM booking_stops WHERE id = NEW.booking_stop_id;
        IF v_stop_status = 'ARRIVED' THEN
            RAISE EXCEPTION 'Drop % is paid: its payment is confirmed in the same transaction', NEW.booking_stop_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- The collection guard of 20261016120000.
CREATE OR REPLACE FUNCTION guard_collection_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.booking_id <> OLD.booking_id
       OR NEW.booking_stop_id IS DISTINCT FROM OLD.booking_stop_id
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

DROP FUNCTION IF EXISTS booking_money_status(uuid);

ALTER TABLE "payment_collections"
    DROP CONSTRAINT "collections_refunded_within_amount",
    DROP COLUMN "refunded_paise";
COMMIT;
