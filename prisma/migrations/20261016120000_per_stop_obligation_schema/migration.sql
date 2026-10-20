-- Per-stop obligation schema (payment flow Phase 2).
--
-- Prepares the schema for collecting a PAY_AT_DELIVERY booking drop by drop. Nothing here
-- enables it: the stop lifecycle arrives with Phase 3 and per-drop collection with Phase 4.
--
--   booking_stops: the facts the stop lifecycle will record (arrival, payment confirmation,
--   delivery, a failed attempt, cancellation, an admin's resolution). CHECKs tie each status to
--   its facts, a stop that hasn't been reached carries none, and at most one stop per booking is
--   current (ARRIVED or PAYMENT_CONFIRMED). Stops still can't change (guard_booking_stop_update).
--
--   payment_collections: a collection can name the drop it is for, and only a drop of its own
--   booking (composite foreign key). "One live collection per booking" becomes one live
--   collection per booking-level obligation (pickup, historical bookings) plus one per drop. All
--   collections of a booking are of one kind (insert guard), so no existing obligation gets a
--   weaker rule.
--
-- Existing rows are not rewritten: the new columns are NULL on them, and every new constraint
-- already holds for them (PostgreSQL checks each one as it is added). Historical
-- (LEGACY_BOOKING_LEVEL) bookings never get stops.
-- See docs/PAYMENT_FLOW_FINAL_REVIEW.md (C.3) and docs/OPEN_DECISIONS.md section I.
--
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

-- AlterTable
ALTER TABLE "booking_stops" ADD COLUMN     "arrived_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "delivered_at" TIMESTAMPTZ(6),
ADD COLUMN     "failed_at" TIMESTAMPTZ(6),
ADD COLUMN     "failure_reason" VARCHAR(200),
ADD COLUMN     "payment_confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "resolution_reason" VARCHAR(200),
ADD COLUMN     "resolved_at" TIMESTAMPTZ(6),
ADD COLUMN     "resolved_by_user_id" UUID;

-- AlterTable
ALTER TABLE "payment_collections" ADD COLUMN     "booking_stop_id" UUID;

-- CreateIndex. The current stop: at most one per booking.
CREATE UNIQUE INDEX "uq_booking_stops_current" ON "booking_stops"("booking_id") WHERE (status = ANY (ARRAY['ARRIVED'::booking_stop_status, 'PAYMENT_CONFIRMED'::booking_stop_status]));

-- CreateIndex. Live (PENDING or COMPLETED) collections: one per booking-level obligation and
-- one per drop. The booking-level index is built before the old one is dropped, so the rule is
-- enforced throughout; for every collection that exists it is the old rule unchanged.
CREATE UNIQUE INDEX "uq_collection_booking_level_active" ON "payment_collections"("booking_id") WHERE ((booking_stop_id IS NULL) AND ((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('COMPLETED'::character varying)::text])));

-- CreateIndex
CREATE UNIQUE INDEX "uq_collection_stop_active" ON "payment_collections"("booking_stop_id") WHERE ((booking_stop_id IS NOT NULL) AND ((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('COMPLETED'::character varying)::text])));

-- DropIndex
DROP INDEX "uq_collection_booking_active";

-- AddForeignKey
ALTER TABLE "booking_stops" ADD CONSTRAINT "booking_stops_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey. A collection can only name a stop of its own booking.
ALTER TABLE "payment_collections" ADD CONSTRAINT "payment_collections_booking_id_booking_stop_id_fkey" FOREIGN KEY ("booking_id", "booking_stop_id") REFERENCES "booking_stops"("booking_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- booking_stops: each status records the facts that led to it.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "booking_stops"
    -- A stop that hasn't been reached carries no lifecycle facts.
    ADD CONSTRAINT "booking_stops_pending_is_untouched" CHECK (
        status <> 'PENDING' OR (
            arrived_at IS NULL AND payment_confirmed_at IS NULL AND delivered_at IS NULL
            AND failed_at IS NULL AND failure_reason IS NULL AND cancelled_at IS NULL
            AND resolved_at IS NULL AND resolved_by_user_id IS NULL AND resolution_reason IS NULL
        )
    ),
    ADD CONSTRAINT "booking_stops_status_facts" CHECK (
        (status <> 'ARRIVED' OR arrived_at IS NOT NULL)
        AND (status <> 'PAYMENT_CONFIRMED' OR (arrived_at IS NOT NULL AND payment_confirmed_at IS NOT NULL))
        AND (status <> 'DELIVERED' OR (arrived_at IS NOT NULL AND delivered_at IS NOT NULL))
        AND (status <> 'DELIVERY_FAILED' OR (arrived_at IS NOT NULL AND failed_at IS NOT NULL))
        AND (status <> 'UNDELIVERED' OR (failed_at IS NOT NULL AND resolved_at IS NOT NULL))
        AND (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
    ),
    -- Payment confirmation, delivery and a failed attempt all happen at the drop.
    ADD CONSTRAINT "booking_stops_facts_follow_arrival" CHECK (
        arrived_at IS NOT NULL
        OR (payment_confirmed_at IS NULL AND delivered_at IS NULL AND failed_at IS NULL)
    ),
    -- A failed attempt always says why.
    ADD CONSTRAINT "booking_stops_failure_complete" CHECK ((failed_at IS NULL) = (failure_reason IS NULL)),
    -- An admin's resolution is recorded whole (who, when, why) and only ever resolves a failure.
    ADD CONSTRAINT "booking_stops_resolution_complete" CHECK (
        (resolved_at IS NULL AND resolved_by_user_id IS NULL AND resolution_reason IS NULL)
        OR (resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL
            AND resolution_reason IS NOT NULL AND failed_at IS NOT NULL)
    ),
    ADD CONSTRAINT "booking_stops_reasons_not_blank" CHECK (
        (failure_reason IS NULL OR length(btrim(failure_reason)) >= 3)
        AND (resolution_reason IS NULL OR length(btrim(resolution_reason)) >= 3)
    );

-- ---------------------------------------------------------------------------------------------
-- payment_collections: a pickup collection is always for the whole booking.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "payment_collections"
    ADD CONSTRAINT "collections_pickup_has_no_stop" CHECK (stage <> 'PICKUP' OR booking_stop_id IS NULL);

-- Same rules as before, plus the stop: only a drop of a pay-at-delivery booking priced per drop
-- names one, so a booking's collections are either all per drop or all for the whole booking.
-- Per-drop collections themselves are still refused; Phase 4 replaces this function with the
-- per-drop rules (current stop, its payable amount and its fee share).
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

-- Same rules as before, plus: the stop a collection is for never changes.
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

COMMENT ON COLUMN "payment_collections"."booking_stop_id" IS 'The drop this collection is for (PAY_AT_DELIVERY priced per drop, Phase 4). NULL for pickup and historical bookings.';
COMMENT ON COLUMN "booking_stops"."resolved_by_user_id" IS 'Admin who resolved a failed delivery (with resolved_at and resolution_reason).';
