-- Payment gate and stop lifecycle (payment flow Phase 3).
--
-- The database's own copy of the handover rules, behind the service and API checks, so that no
-- code path and no direct SQL (the table owner included) can hand goods over before they are
-- paid for:
--
--   Pickup gate. A PAY_AT_PICKUP booking must be paid before the pickup handover
--   (DRIVER_ARRIVED -> PICKUP_VERIFIED). This holds for every booking model: historical rows get
--   it too when they next move from DRIVER_ARRIVED (decision N2). A booking priced per drop can
--   also not start (IN_TRANSIT) unpaid.
--
--   Stop lifecycle. The stops of a booking priced per drop follow the approved state machine
--   (docs/PAYMENT_FLOW_FINAL_REVIEW.md, section E). Drops are reached in order, one at a time,
--   while the trip is under way. A drop's payment is confirmed only by a completed collection
--   for that drop. A pay-at-delivery drop is handed over only once that drop is paid, a
--   pay-at-pickup drop only once the booking is paid. A failed attempt is retried, or resolved
--   as undelivered by an admin, with the audit record in the same transaction. Stops are
--   cancelled only with their booking. Each lifecycle fact is written only by the transition
--   that records it.
--
--   Trip and stops. The trip of a booking priced per drop reaches DROP_PROGRESS once a drop has
--   been reached, and DELIVERED only once every drop is finished (delivered, undelivered or
--   cancelled).
--
-- No row is rewritten and no rule is relaxed: both guard functions are replaced with stricter
-- versions of themselves. Historical (LEGACY_BOOKING_LEVEL) bookings keep their rules, except
-- for the pickup gate (N2). Collections are untouched; per-drop collection is Phase 4.
--
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

-- ---------------------------------------------------------------------------------------------
-- trips: the pickup gate, and the drops of a booking priced per drop.
-- ---------------------------------------------------------------------------------------------

-- Same rules as before, plus the pickup gate and, for a booking priced per drop, the stops.
CREATE OR REPLACE FUNCTION guard_trip_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_booking RECORD;
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
    IF NEW.status <> OLD.status
       AND NEW.status IN ('PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS', 'DELIVERED') THEN
        SELECT payment_method, payment_status, payment_model
          INTO v_booking
          FROM bookings WHERE id = NEW.booking_id;
        -- Pickup gate: the goods leave the sender only once a pay-at-pickup booking is paid.
        IF v_booking.payment_method = 'PAY_AT_PICKUP' AND v_booking.payment_status = 'UNPAID'
           AND (NEW.status = 'PICKUP_VERIFIED'
                OR (NEW.status = 'IN_TRANSIT' AND v_booking.payment_model = 'QUOTE_PER_STOP')) THEN
            RAISE EXCEPTION 'Payment is required before the pickup handover'
                USING ERRCODE = 'restrict_violation';
        END IF;
        -- Priced per drop: the drops, not the trip engine, move the trip through delivery.
        IF v_booking.payment_model = 'QUOTE_PER_STOP' THEN
            IF NEW.status = 'DROP_PROGRESS' AND NOT EXISTS (
                SELECT 1 FROM booking_stops s
                 WHERE s.booking_id = NEW.booking_id AND s.status <> 'PENDING'
            ) THEN
                RAISE EXCEPTION 'A trip priced per drop reaches DROP_PROGRESS when its first drop is reached'
                    USING ERRCODE = 'restrict_violation';
            END IF;
            IF NEW.status = 'DELIVERED' AND EXISTS (
                SELECT 1 FROM booking_stops s
                 WHERE s.booking_id = NEW.booking_id
                   AND s.status NOT IN ('DELIVERED', 'UNDELIVERED', 'CANCELLED')
            ) THEN
                RAISE EXCEPTION 'A trip priced per drop is delivered only once every drop is finished'
                    USING ERRCODE = 'restrict_violation';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- booking_stops: the stop lifecycle.
-- ---------------------------------------------------------------------------------------------

-- Amounts and references never change. A stop changes only by moving along the approved state
-- machine, and each lifecycle fact is written by the transition that records it (a retry records
-- a later arrival and keeps the last failure; a second failure replaces it).
CREATE OR REPLACE FUNCTION guard_booking_stop_update() RETURNS trigger AS $$
DECLARE
    v_booking RECORD;
    v_trip_status trip_status;
    v_paid BOOLEAN;
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

    IF NEW.arrived_at IS DISTINCT FROM OLD.arrived_at
       AND NOT (OLD.status IN ('PENDING', 'DELIVERY_FAILED')
                AND NEW.status IN ('ARRIVED', 'PAYMENT_CONFIRMED')) THEN
        RAISE EXCEPTION 'A drop''s arrival is recorded only when the drop is reached or retried'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.payment_confirmed_at IS DISTINCT FROM OLD.payment_confirmed_at
       AND NOT (OLD.payment_confirmed_at IS NULL AND NEW.status = 'PAYMENT_CONFIRMED'
                AND OLD.status IN ('ARRIVED', 'DELIVERY_FAILED')) THEN
        RAISE EXCEPTION 'A drop''s payment is recorded once, only when its payment is confirmed'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
       AND NOT (NEW.status = 'DELIVERED' AND OLD.status <> 'DELIVERED') THEN
        RAISE EXCEPTION 'A drop''s delivery is recorded only when it is delivered'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF (NEW.failed_at IS DISTINCT FROM OLD.failed_at
        OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason)
       AND NOT (NEW.status = 'DELIVERY_FAILED' AND OLD.status <> 'DELIVERY_FAILED') THEN
        RAISE EXCEPTION 'A failed delivery attempt is recorded only when the attempt fails'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       AND NOT (NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED') THEN
        RAISE EXCEPTION 'A drop''s cancellation is recorded only when it is cancelled'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF (NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
        OR NEW.resolved_by_user_id IS DISTINCT FROM OLD.resolved_by_user_id
        OR NEW.resolution_reason IS DISTINCT FROM OLD.resolution_reason)
       AND NOT (NEW.status = 'UNDELIVERED' AND OLD.status <> 'UNDELIVERED') THEN
        RAISE EXCEPTION 'A drop''s resolution is recorded only when it is resolved as undelivered'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = OLD.status THEN
        RAISE EXCEPTION 'A booking stop changes only through a lifecycle transition'
            USING ERRCODE = 'restrict_violation';
    END IF;

    SELECT status, payment_method, payment_status
      INTO v_booking
      FROM bookings WHERE id = NEW.booking_id;
    SELECT status INTO v_trip_status FROM trips WHERE booking_id = NEW.booking_id;

    -- Only the booking's own cancellation cancels its drops, and never a finished one.
    IF NEW.status = 'CANCELLED' THEN
        IF v_booking.status <> 'CANCELLED' OR OLD.status IN ('DELIVERED', 'UNDELIVERED') THEN
            RAISE EXCEPTION 'A drop is cancelled only with its booking, before it is finished'
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF v_booking.status IN ('COMPLETED', 'CANCELLED')
       OR v_trip_status IS NULL OR v_trip_status IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'The drops of a closed or unassigned booking cannot move'
            USING ERRCODE = 'restrict_violation';
    END IF;

    v_paid := EXISTS (
        SELECT 1 FROM payment_collections c
         WHERE c.booking_stop_id = NEW.id AND c.status = 'COMPLETED'
    );

    IF OLD.status = 'PENDING' AND NEW.status = 'ARRIVED' THEN
        IF v_trip_status NOT IN ('IN_TRANSIT', 'DROP_PROGRESS') THEN
            RAISE EXCEPTION 'A drop is reached only while its trip is under way'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF EXISTS (
            SELECT 1 FROM booking_stops s
             WHERE s.booking_id = NEW.booking_id AND s.sequence < NEW.sequence
               AND s.status NOT IN ('DELIVERED', 'UNDELIVERED', 'CANCELLED')
        ) THEN
            RAISE EXCEPTION 'Drops are reached in order: every earlier drop must be finished first'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF OLD.status IN ('ARRIVED', 'DELIVERY_FAILED') AND NEW.status = 'PAYMENT_CONFIRMED' THEN
        IF v_booking.payment_method <> 'PAY_AT_DELIVERY' OR NOT v_paid THEN
            RAISE EXCEPTION 'A drop''s payment is confirmed only by a completed collection for that drop'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF OLD.status = 'ARRIVED' AND NEW.status = 'DELIVERED' THEN
        IF v_booking.payment_method <> 'PAY_AT_PICKUP' OR v_booking.payment_status = 'UNPAID' THEN
            RAISE EXCEPTION 'Payment is required before this drop is handed over'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF OLD.status = 'PAYMENT_CONFIRMED' AND NEW.status = 'DELIVERED' THEN
        IF NOT v_paid THEN
            RAISE EXCEPTION 'Payment is required before this drop is handed over'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF OLD.status IN ('ARRIVED', 'PAYMENT_CONFIRMED') AND NEW.status = 'DELIVERY_FAILED' THEN
        NULL;
    ELSIF OLD.status = 'DELIVERY_FAILED' AND NEW.status = 'ARRIVED' THEN
        IF v_paid THEN
            RAISE EXCEPTION 'A paid drop is retried with its payment confirmed'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF OLD.status = 'DELIVERY_FAILED' AND NEW.status = 'UNDELIVERED' THEN
        IF NOT EXISTS (
            SELECT 1 FROM users u
             WHERE u.id = NEW.resolved_by_user_id AND u.role = 'ADMIN' AND u.status = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'Only an admin resolves a failed drop as undelivered'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid booking stop transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- At commit: a drop resolved as undelivered has its admin audit record (admin_actions,
-- BOOKING_STOP_UNDELIVERED, by the resolving admin, with the same reason) written in the same
-- transaction. A row's xmin is the id of the transaction that inserted it; the audit record is
-- written by the transaction itself, never inside a savepoint.
CREATE OR REPLACE FUNCTION check_booking_stop_resolution_audit() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM admin_actions a
         WHERE a.action = 'BOOKING_STOP_UNDELIVERED'
           AND a.target_type = 'BOOKING_STOP'
           AND a.target_id = NEW.id::text
           AND a.actor_user_id = NEW.resolved_by_user_id
           AND a.reason = NEW.resolution_reason
           AND a.xmin = pg_current_xact_id()::xid
    ) THEN
        RAISE EXCEPTION 'Resolving drop % as undelivered needs its admin audit record in the same transaction', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_booking_stops_resolution_audit AFTER UPDATE ON "booking_stops"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW.status = 'UNDELIVERED' AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION check_booking_stop_resolution_audit();
