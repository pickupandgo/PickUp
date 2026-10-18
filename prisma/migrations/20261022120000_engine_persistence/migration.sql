-- Trip engine persistence (payment flow Phase 8, engine integration).
--
-- The engine kept everything in memory, with sequential ids (R1, T1) that collided with stored
-- external references after a restart. This migration gives it its own database:
--
--   engine_bookings  one per confirmed booking: the stable external reference registered with
--                    the payment backend, the fare quote it was registered from, and the payment
--                    backend's booking id once registered.
--   engine_stops     the drops of a booking, in the quote's order (coordinates and amounts are
--                    display copies of the quote).
--   engine_offers    offers of a booking to drivers (dispatch).
--   engine_trips     the trip of a booking, with the payment backend's trip id.
--   engine_outbox    every engine -> payment backend call, delivered in order per booking and
--                    retried until the backend gives a definitive answer.
--
-- The payment backend stays the source of truth for money: no amount here is ever sent to it.
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

-- CreateEnum
CREATE TYPE "engine_booking_status" AS ENUM ('PENDING_REGISTRATION', 'REGISTRATION_FAILED', 'OPEN', 'ASSIGNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "engine_payment_method" AS ENUM ('PAY_AT_PICKUP', 'PAY_AT_DELIVERY');

-- CreateEnum
CREATE TYPE "engine_offer_status" AS ENUM ('REQUESTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "engine_trip_status" AS ENUM ('DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "engine_stop_status" AS ENUM ('PENDING', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'DELIVERY_FAILED', 'UNDELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "engine_outbox_kind" AS ENUM ('SEARCHING', 'ASSIGN', 'TRIP_STATUS', 'STOP_STATUS', 'CANCEL');

-- CreateEnum
CREATE TYPE "engine_outbox_mode" AS ENUM ('COMMAND', 'EVENT');

-- CreateEnum
CREATE TYPE "engine_outbox_status" AS ENUM ('PENDING', 'DELIVERED', 'REFUSED');

-- CreateTable
CREATE TABLE "engine_bookings" (
    "id" UUID NOT NULL,
    "external_ref" VARCHAR(100) NOT NULL,
    "quote_id" UUID NOT NULL,
    "customer_subject" VARCHAR(128) NOT NULL,
    "payment_method" "engine_payment_method" NOT NULL,
    "status" "engine_booking_status" NOT NULL DEFAULT 'PENDING_REGISTRATION',
    "payment_booking_id" UUID,
    "registration_error" VARCHAR(60),
    "vehicle_category" VARCHAR(40) NOT NULL,
    "weight_grams" INTEGER NOT NULL,
    "pickup_latitude" DOUBLE PRECISION NOT NULL,
    "pickup_longitude" DOUBLE PRECISION NOT NULL,
    "pickup_address" VARCHAR(300),
    "pickup_otp" VARCHAR(4) NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "payable_paise" BIGINT NOT NULL,
    "quote_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "registered_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(20),
    "cancellation_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_stops" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "address" VARCHAR(300),
    "receiver_name" VARCHAR(100),
    "receiver_phone" VARCHAR(20),
    "distance_meters" INTEGER NOT NULL,
    "payable_paise" BIGINT NOT NULL,
    "status" "engine_stop_status" NOT NULL DEFAULT 'PENDING',
    "otp" VARCHAR(4) NOT NULL,
    "otp_verified" BOOLEAN NOT NULL DEFAULT false,
    "proof_uri" VARCHAR(1000),
    "proof_submitted_at" TIMESTAMPTZ(6),
    "arrived_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "failure_reason" VARCHAR(200),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_offers" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "driver_subject" VARCHAR(128) NOT NULL,
    "status" "engine_offer_status" NOT NULL DEFAULT 'REQUESTED',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),
    "failure_code" VARCHAR(60),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_trips" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "driver_subject" VARCHAR(128) NOT NULL,
    "payment_trip_id" UUID,
    "status" "engine_trip_status" NOT NULL DEFAULT 'DRIVER_ASSIGNED',
    "current_stop_index" INTEGER NOT NULL DEFAULT 0,
    "arrived_at" TIMESTAMPTZ(6),
    "pickup_verified_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "completion_requested_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(20),
    "cancellation_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_outbox" (
    "id" BIGSERIAL NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" "engine_outbox_kind" NOT NULL,
    "mode" "engine_outbox_mode" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "engine_outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "claim_id" UUID,
    "last_http_status" INTEGER,
    "last_error_code" VARCHAR(60),
    "last_error" VARCHAR(500),
    "result" JSONB,
    "alerted_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "refused_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_engine_bookings_external_ref" ON "engine_bookings"("external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "uq_engine_bookings_payment_booking" ON "engine_bookings"("payment_booking_id");

-- CreateIndex
CREATE INDEX "idx_engine_bookings_customer" ON "engine_bookings"("customer_subject", "created_at" DESC);

-- A customer books a quote once (retries reuse the same booking and external reference).
CREATE UNIQUE INDEX "uq_engine_bookings_quote_customer" ON "engine_bookings"("quote_id", "customer_subject");

-- CreateIndex
CREATE UNIQUE INDEX "uq_engine_stops_booking_sequence" ON "engine_stops"("booking_id", "sequence");

-- CreateIndex
CREATE INDEX "idx_engine_offers_driver" ON "engine_offers"("driver_subject", "status");

-- CreateIndex
CREATE INDEX "idx_engine_offers_booking" ON "engine_offers"("booking_id", "created_at");

-- One live offer per booking at a time.
CREATE UNIQUE INDEX "uq_engine_offers_live" ON "engine_offers"("booking_id") WHERE (status = 'REQUESTED'::engine_offer_status);

-- CreateIndex
CREATE UNIQUE INDEX "uq_engine_trips_payment_trip" ON "engine_trips"("payment_trip_id");

-- CreateIndex
CREATE INDEX "idx_engine_trips_driver" ON "engine_trips"("driver_subject", "created_at" DESC);

-- One trip per booking (M6). A trip the payment backend refused to assign stays as CANCELLED.
CREATE UNIQUE INDEX "uq_engine_trips_booking_live" ON "engine_trips"("booking_id") WHERE (status <> 'CANCELLED'::engine_trip_status);

-- A driver runs one trip at a time: two acceptances racing for one driver can't both win.
CREATE UNIQUE INDEX "uq_engine_trips_driver_active" ON "engine_trips"("driver_subject") WHERE (status <> ALL (ARRAY['COMPLETED'::engine_trip_status, 'CANCELLED'::engine_trip_status]));

-- CreateIndex
CREATE INDEX "idx_engine_outbox_booking" ON "engine_outbox"("booking_id", "id");

-- CreateIndex
CREATE INDEX "idx_engine_outbox_due" ON "engine_outbox"("next_attempt_at") WHERE (status = 'PENDING'::engine_outbox_status);

-- AddForeignKey
ALTER TABLE "engine_stops" ADD CONSTRAINT "engine_stops_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "engine_bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "engine_offers" ADD CONSTRAINT "engine_offers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "engine_bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "engine_trips" ADD CONSTRAINT "engine_trips_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "engine_bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "engine_outbox" ADD CONSTRAINT "engine_outbox_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "engine_bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Data rules (the Prisma schema language can't express them).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "engine_bookings"
    ADD CONSTRAINT "engine_bookings_external_ref_format" CHECK (external_ref ~ '^[A-Za-z0-9_.:-]{1,100}$'),
    ADD CONSTRAINT "engine_bookings_pickup_otp_format" CHECK (pickup_otp ~ '^[0-9]{4}$'),
    ADD CONSTRAINT "engine_bookings_amounts" CHECK (payable_paise >= 0 AND distance_meters >= 0 AND weight_grams > 0),
    ADD CONSTRAINT "engine_bookings_pickup_coordinates"
        CHECK (pickup_latitude BETWEEN -90 AND 90 AND pickup_longitude BETWEEN -180 AND 180),
    -- Offered, assigned, completed: always a registered payment booking.
    ADD CONSTRAINT "engine_bookings_registered"
        CHECK (status IN ('PENDING_REGISTRATION', 'REGISTRATION_FAILED', 'CANCELLED')
               OR payment_booking_id IS NOT NULL),
    ADD CONSTRAINT "engine_bookings_registration_error"
        CHECK (status <> 'REGISTRATION_FAILED' OR registration_error IS NOT NULL),
    ADD CONSTRAINT "engine_bookings_cancelled"
        CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL));

ALTER TABLE "engine_stops"
    ADD CONSTRAINT "engine_stops_sequence_range" CHECK (sequence BETWEEN 1 AND 25),
    ADD CONSTRAINT "engine_stops_otp_format" CHECK (otp ~ '^[0-9]{4}$'),
    ADD CONSTRAINT "engine_stops_amounts" CHECK (payable_paise >= 0 AND distance_meters >= 0),
    ADD CONSTRAINT "engine_stops_coordinates"
        CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180),
    ADD CONSTRAINT "engine_stops_delivered"
        CHECK (status <> 'DELIVERED' OR (delivered_at IS NOT NULL AND proof_uri IS NOT NULL)),
    ADD CONSTRAINT "engine_stops_failed"
        CHECK (status <> 'DELIVERY_FAILED' OR (failed_at IS NOT NULL AND failure_reason IS NOT NULL));

ALTER TABLE "engine_trips"
    ADD CONSTRAINT "engine_trips_stop_index" CHECK (current_stop_index >= 0),
    ADD CONSTRAINT "engine_trips_completed" CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
    ADD CONSTRAINT "engine_trips_cancelled"
        CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL));

ALTER TABLE "engine_outbox"
    ADD CONSTRAINT "engine_outbox_attempts" CHECK (attempts >= 0),
    ADD CONSTRAINT "engine_outbox_payload_object" CHECK (jsonb_typeof(payload) = 'object'),
    ADD CONSTRAINT "engine_outbox_delivered" CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL),
    ADD CONSTRAINT "engine_outbox_refused" CHECK (status <> 'REFUSED' OR refused_at IS NOT NULL);

-- No silent event loss: a record that has not reached the payment backend is never deleted.
CREATE OR REPLACE FUNCTION prevent_pending_outbox_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'PENDING' THEN
        RAISE EXCEPTION 'A pending outbox record is never deleted: it has not reached the payment backend'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_engine_outbox_no_pending_delete BEFORE DELETE ON "engine_outbox"
    FOR EACH ROW EXECUTE FUNCTION prevent_pending_outbox_delete();
