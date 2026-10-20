-- Booking monetary snapshot from fare quotes (payment flow Phase 1).
--
-- Every new booking is priced from a server-side fare quote: the quote is redeemed once, its
-- amounts are frozen on the booking and on one stop row per drop, and the platform fee is frozen
-- and split across the drops. Nothing a client sends can change these amounts.
--
-- Existing rows are NOT rewritten. They are marked LEGACY_BOOKING_LEVEL (the only backfill) and
-- keep the booking-level rules they were created under; no stops are created for them. New
-- PREPAID_UPI bookings are refused; historical PREPAID_UPI bookings keep their payment path.
-- See docs/PAYMENT_FLOW_FINAL_REVIEW.md (sections C, E and K).
--
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

-- CreateEnum
CREATE TYPE "booking_payment_model" AS ENUM ('LEGACY_BOOKING_LEVEL', 'QUOTE_PER_STOP');

-- CreateEnum
CREATE TYPE "booking_stop_status" AS ENUM ('PENDING', 'ARRIVED', 'PAYMENT_CONFIRMED', 'DELIVERED', 'DELIVERY_FAILED', 'UNDELIVERED', 'CANCELLED');

-- AlterTable. payment_model is added with a default so every existing row becomes
-- LEGACY_BOOKING_LEVEL; the default is then dropped, so every new row must state its model.
ALTER TABLE "bookings" ADD COLUMN     "fare_paise" BIGINT,
ADD COLUMN     "fare_quote_id" UUID,
ADD COLUMN     "payment_model" "booking_payment_model" NOT NULL DEFAULT 'LEGACY_BOOKING_LEVEL',
ADD COLUMN     "platform_fee_paise" BIGINT,
ADD COLUMN     "pricing_version_id" UUID,
ADD COLUMN     "tax_paise" BIGINT;

ALTER TABLE "bookings" ALTER COLUMN "payment_model" DROP DEFAULT;

-- CreateTable
CREATE TABLE "booking_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "fare_quote_stop_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "fare_paise" BIGINT NOT NULL,
    "tax_paise" BIGINT NOT NULL,
    "payable_paise" BIGINT NOT NULL,
    "platform_fee_share_paise" BIGINT NOT NULL,
    "status" "booking_stop_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_booking_stops_quote_stop" ON "booking_stops"("fare_quote_stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_booking_stops_sequence" ON "booking_stops"("booking_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "uq_booking_stops_booking_id" ON "booking_stops"("booking_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bookings_fare_quote" ON "bookings"("fare_quote_id");

-- CreateIndex
CREATE INDEX "idx_bookings_pricing_version" ON "bookings"("pricing_version_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_fare_quote_id_fkey" FOREIGN KEY ("fare_quote_id") REFERENCES "fare_quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pricing_version_id_fkey" FOREIGN KEY ("pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_stops" ADD CONSTRAINT "booking_stops_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_stops" ADD CONSTRAINT "booking_stops_fare_quote_stop_id_fkey" FOREIGN KEY ("fare_quote_stop_id") REFERENCES "fare_quote_stops"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Maximum drops. The business maximum is configuration (FARE_MAX_DROPS, technical default 5;
-- open decision D-29 / N7). The database only enforces a technical ceiling of 25, so a later
-- business change needs no migration.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "fare_quote_stops"
    DROP CONSTRAINT "fare_quote_stops_sequence_range",
    ADD CONSTRAINT "fare_quote_stops_sequence_range" CHECK (sequence BETWEEN 1 AND 25);

-- ---------------------------------------------------------------------------------------------
-- bookings: the snapshot shape, PREPAID retirement, insert guard, immutability.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "bookings"
    -- LEGACY rows carry no quote snapshot; QUOTE_PER_STOP rows carry all of it. Tax stays 0
    -- until a tax rule is approved (open decision L-2), and the fee never exceeds the fare.
    ADD CONSTRAINT "bookings_snapshot_shape" CHECK (
        (payment_model = 'LEGACY_BOOKING_LEVEL'
            AND fare_quote_id IS NULL AND pricing_version_id IS NULL
            AND fare_paise IS NULL AND tax_paise IS NULL AND platform_fee_paise IS NULL)
        OR (payment_model = 'QUOTE_PER_STOP'
            AND fare_quote_id IS NOT NULL AND pricing_version_id IS NOT NULL
            AND fare_paise > 0 AND tax_paise = 0
            AND platform_fee_paise >= 0 AND platform_fee_paise <= fare_paise
            AND final_fare_minor = fare_paise + tax_paise)
    ),
    -- PREPAID_UPI (pay in the app before dispatch) is retired: only historical rows may have it.
    ADD CONSTRAINT "bookings_quote_bookings_not_prepaid" CHECK (
        payment_model <> 'QUOTE_PER_STOP' OR payment_method <> 'PREPAID_UPI'
    );

-- Every new booking is QUOTE_PER_STOP, never PREPAID_UPI, and is an exact copy of a quote that
-- was redeemed for it in the same transaction (redeemed_at = confirmed_at; one booking per quote
-- through uq_bookings_fare_quote). Its pinned fee rule must be in effect for its category at
-- confirmation, and its fee must be that rule's fee: PERCENTAGE rounds HALF_UP to whole paise
-- with integer arithmetic only, exactly like src/common/money.ts; FIXED is the value in paise.
CREATE OR REPLACE FUNCTION guard_booking_insert() RETURNS trigger AS $$
DECLARE
    q RECORD;
    r RECORD;
    v_scaled NUMERIC;
    v_fee NUMERIC;
BEGIN
    IF NEW.payment_method = 'PREPAID_UPI' THEN
        RAISE EXCEPTION 'PREPAID_UPI is no longer offered: new bookings pay at pickup or at delivery'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.payment_model IS DISTINCT FROM 'QUOTE_PER_STOP' THEN
        RAISE EXCEPTION 'New bookings must be priced from a fare quote (QUOTE_PER_STOP)'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT customer_id, pricing_version_id, vehicle_category, fare_paise, tax_paise,
           payable_paise, expires_at, redeemed_at
      INTO q
      FROM fare_quotes WHERE id = NEW.fare_quote_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fare quote % does not exist', NEW.fare_quote_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF q.customer_id <> NEW.customer_id
       OR q.pricing_version_id <> NEW.pricing_version_id
       OR NEW.vehicle_category IS DISTINCT FROM q.vehicle_category
       OR q.fare_paise <> NEW.fare_paise
       OR q.tax_paise <> NEW.tax_paise
       OR q.payable_paise <> NEW.final_fare_minor
       OR q.payable_paise <> NEW.fare_estimate_minor THEN
        RAISE EXCEPTION 'A booking must copy the customer, pricing version, category and amounts of its fare quote'
            USING ERRCODE = 'check_violation';
    END IF;
    IF q.redeemed_at IS NULL OR q.redeemed_at <> NEW.confirmed_at OR q.expires_at <= NEW.confirmed_at THEN
        RAISE EXCEPTION 'The fare quote must be redeemed, unexpired, for this booking at its confirmation'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT rule_type, value, category, active, effective_from, effective_to
      INTO r
      FROM fee_rules WHERE id = NEW.fee_rule_id;
    IF NOT FOUND
       OR NOT r.active
       OR r.effective_from > NEW.confirmed_at
       OR (r.effective_to IS NOT NULL AND r.effective_to <= NEW.confirmed_at)
       OR (r.category IS NOT NULL AND r.category IS DISTINCT FROM NEW.vehicle_category) THEN
        RAISE EXCEPTION 'The pinned fee rule is not in effect for this booking'
            USING ERRCODE = 'check_violation';
    END IF;
    v_scaled := r.value * 10000;
    IF r.rule_type = 'FIXED' THEN
        v_fee := div(v_scaled, 10000);
    ELSE
        -- HALF_UP: floor((2 x fare x scaled + 10^6) / (2 x 10^6)).
        v_fee := div(2 * NEW.fare_paise::numeric * v_scaled + 1000000, 2000000);
    END IF;
    IF v_fee <> NEW.platform_fee_paise THEN
        RAISE EXCEPTION 'The platform fee must be the pinned rule''s fee for this fare'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bookings_insert_guard BEFORE INSERT ON "bookings"
    FOR EACH ROW EXECUTE FUNCTION guard_booking_insert();

-- Same rules as before, plus the snapshot columns: none of them ever changes.
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

-- ---------------------------------------------------------------------------------------------
-- booking_stops: frozen per-drop amounts and fee shares.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "booking_stops"
    ADD CONSTRAINT "booking_stops_sequence_range" CHECK (sequence BETWEEN 1 AND 25),
    ADD CONSTRAINT "booking_stops_amounts_valid" CHECK (
        fare_paise > 0 AND tax_paise = 0 AND payable_paise = fare_paise + tax_paise
    ),
    ADD CONSTRAINT "booking_stops_fee_share_valid" CHECK (
        platform_fee_share_paise >= 0 AND platform_fee_share_paise <= fare_paise
    );

-- A stop belongs to a QUOTE_PER_STOP booking and copies its quoted drop exactly. It starts PENDING.
CREATE OR REPLACE FUNCTION guard_booking_stop_insert() RETURNS trigger AS $$
DECLARE
    b RECORD;
    qs RECORD;
BEGIN
    SELECT payment_model, fare_quote_id INTO b FROM bookings WHERE id = NEW.booking_id;
    IF NOT FOUND OR b.payment_model <> 'QUOTE_PER_STOP' THEN
        RAISE EXCEPTION 'Stops exist only for bookings priced from a fare quote'
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT quote_id, sequence, fare_paise, tax_paise, payable_paise
      INTO qs
      FROM fare_quote_stops WHERE id = NEW.fare_quote_stop_id;
    IF NOT FOUND
       OR qs.quote_id <> b.fare_quote_id
       OR qs.sequence <> NEW.sequence
       OR qs.fare_paise <> NEW.fare_paise
       OR qs.tax_paise <> NEW.tax_paise
       OR qs.payable_paise <> NEW.payable_paise THEN
        RAISE EXCEPTION 'A booking stop must copy its quoted drop exactly'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'PENDING' THEN
        RAISE EXCEPTION 'A booking stop starts PENDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Until the stop lifecycle is enabled (a later migration replaces this function with the
-- transition guard), nothing about a stop may change. Its amounts never change at all.
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

-- At commit, for a QUOTE_PER_STOP booking: one stop per quoted drop, numbered 1..n, adding up
-- exactly to the booking's fare, tax, payable amount and platform fee. Each fee share is the
-- proportional share of the fee rounded down, or one paisa more (largest remainder).
-- The booking id is resolved in the body: a DECLARE initializer is always evaluated, and
-- NEW.booking_id does not exist when the trigger fires on bookings.
CREATE OR REPLACE FUNCTION check_booking_snapshot() RETURNS trigger AS $$
DECLARE
    v_booking_id UUID;
    b RECORD;
    s RECORD;
    v_quoted INTEGER;
    v_out_of_range INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'bookings' THEN
        v_booking_id := NEW.id;
    ELSE
        v_booking_id := NEW.booking_id;
    END IF;

    SELECT payment_model, fare_quote_id, fare_paise, tax_paise, final_fare_minor, platform_fee_paise
      INTO b
      FROM bookings WHERE id = v_booking_id;
    IF NOT FOUND OR b.payment_model <> 'QUOTE_PER_STOP' THEN
        RETURN NULL;
    END IF;

    SELECT count(*) AS n, min(sequence) AS first_seq, max(sequence) AS last_seq,
           COALESCE(sum(fare_paise), 0) AS fare, COALESCE(sum(tax_paise), 0) AS tax,
           COALESCE(sum(payable_paise), 0) AS payable,
           COALESCE(sum(platform_fee_share_paise), 0) AS fee
      INTO s
      FROM booking_stops WHERE booking_id = v_booking_id;
    SELECT count(*) INTO v_quoted FROM fare_quote_stops WHERE quote_id = b.fare_quote_id;

    IF s.n = 0 OR s.n <> v_quoted OR s.first_seq <> 1 OR s.last_seq <> s.n THEN
        RAISE EXCEPTION 'Booking % must have one stop per quoted drop, numbered 1..n', v_booking_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF s.fare <> b.fare_paise OR s.tax <> b.tax_paise OR s.payable <> b.final_fare_minor
       OR s.fee <> b.platform_fee_paise THEN
        RAISE EXCEPTION 'Booking % stops do not add up to its snapshot', v_booking_id
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(*) INTO v_out_of_range
      FROM booking_stops
     WHERE booking_id = v_booking_id
       AND (platform_fee_share_paise < (b.platform_fee_paise * fare_paise) / b.fare_paise
            OR platform_fee_share_paise > (b.platform_fee_paise * fare_paise) / b.fare_paise + 1);
    IF v_out_of_range > 0 THEN
        RAISE EXCEPTION 'Booking % fee shares are not a largest-remainder split of its fee', v_booking_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_booking_stops_insert_guard BEFORE INSERT ON "booking_stops"
    FOR EACH ROW EXECUTE FUNCTION guard_booking_stop_insert();
CREATE TRIGGER trg_booking_stops_guard BEFORE UPDATE ON "booking_stops"
    FOR EACH ROW EXECUTE FUNCTION guard_booking_stop_update();
CREATE CONSTRAINT TRIGGER trg_bookings_snapshot AFTER INSERT ON "bookings"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_snapshot();
CREATE CONSTRAINT TRIGGER trg_booking_stops_snapshot AFTER INSERT ON "booking_stops"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_snapshot();
CREATE TRIGGER trg_booking_stops_no_delete BEFORE DELETE ON "booking_stops"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_booking_stops_no_truncate BEFORE TRUNCATE ON "booking_stops"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();

-- ---------------------------------------------------------------------------------------------
-- In-app booking payments (Razorpay Checkout) exist only for historical PREPAID_UPI bookings.
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_booking_payment_insert() RETURNS trigger AS $$
DECLARE
    b RECORD;
BEGIN
    IF NEW.purpose <> 'BOOKING' THEN
        RETURN NEW;
    END IF;
    SELECT payment_method, payment_model INTO b FROM bookings WHERE id = NEW.booking_id;
    IF NOT FOUND OR b.payment_method <> 'PREPAID_UPI' OR b.payment_model <> 'LEGACY_BOOKING_LEVEL' THEN
        RAISE EXCEPTION 'In-app booking payments exist only for historical PREPAID_UPI bookings'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_booking_insert_guard BEFORE INSERT ON "payments"
    FOR EACH ROW EXECUTE FUNCTION guard_booking_payment_insert();

-- ---------------------------------------------------------------------------------------------
-- Collections: the stage matches the booking's payment method, and the amount is the booking's
-- obligation. Per-drop collections for QUOTE_PER_STOP pay-at-delivery bookings are enabled by a
-- later migration, which replaces this function; until then they are refused.
-- ---------------------------------------------------------------------------------------------

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

CREATE TRIGGER trg_collections_insert_guard BEFORE INSERT ON "payment_collections"
    FOR EACH ROW EXECUTE FUNCTION guard_collection_insert();

COMMENT ON COLUMN "bookings"."payment_model" IS 'LEGACY_BOOKING_LEVEL: registered before fare quotes, keeps the booking-level rules. QUOTE_PER_STOP: priced from a redeemed quote, with stops.';
COMMENT ON COLUMN "bookings"."platform_fee_paise" IS 'QUOTE_PER_STOP: platform fee under the pinned rule, frozen at registration and split across booking_stops.';
COMMENT ON TABLE "booking_stops" IS 'One drop of a QUOTE_PER_STOP booking: amounts frozen from its quoted drop and its share of the platform fee.';
