-- Financial event log (payment flow Phase 7; docs/PAYMENT_FLOW_FINAL_REVIEW.md C.6).
--
--   financial_events. One row per change of a financial record, written by AFTER triggers on
--   the tables that hold money or its state: bookings, trips, booking_stops, payments,
--   payment_collections, payment_settlements, payment_disputes, payment_refunds,
--   driver_earnings, payout_batches, driver_payouts, payout_items and
--   driver_wallet_transactions, plus admin_actions (the admin decisions about them). A CREATED
--   event carries the new row; an update carries only the columns that changed, before and
--   after; a status change names both statuses.
--
--   Who and why: the service layer sets transaction-local settings when a transaction starts
--   (app.actor_type, app.actor_user_id, app.request_id, app.origin, app.provider_event_id). A
--   change made without them (an operator's SQL, a fixture) is recorded as UNATTRIBUTED, and
--   every event names the database role that made it (session_user).
--
--   Append-only for every role, the table owner included: no UPDATE, DELETE or TRUNCATE, and
--   no INSERT except from record_financial_event() (triggers). The API role can only read it;
--   record_financial_event() is SECURITY DEFINER, so the API role writes events without any
--   privilege on the table. Nothing here changes a financial value or decides anything.
--
-- No existing row changes. Rows that existed before this migration have no CREATED event.
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

CREATE TABLE "financial_events" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "transaction_id" BIGINT NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "status_from" VARCHAR(40),
    "status_to" VARCHAR(40),
    "booking_id" UUID,
    "driver_id" UUID,
    "amount_paise" BIGINT,
    "changes" JSONB NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_user_id" UUID,
    "request_id" VARCHAR(100),
    "origin" VARCHAR(150),
    "provider_event_id" VARCHAR(150),
    "db_role" VARCHAR(63) NOT NULL,

    CONSTRAINT "financial_events_pkey" PRIMARY KEY ("id")
);

-- A booking's money trail, an entity's history, a driver's trail, everything one request or
-- job run did, what one user did, and time ranges.
CREATE INDEX "idx_financial_events_booking" ON "financial_events"("booking_id", "id")
    WHERE booking_id IS NOT NULL;
CREATE INDEX "idx_financial_events_entity" ON "financial_events"("entity_type", "entity_id", "id");
CREATE INDEX "idx_financial_events_driver" ON "financial_events"("driver_id", "id")
    WHERE driver_id IS NOT NULL;
CREATE INDEX "idx_financial_events_request" ON "financial_events"("request_id")
    WHERE request_id IS NOT NULL;
CREATE INDEX "idx_financial_events_actor" ON "financial_events"("actor_user_id", "id")
    WHERE actor_user_id IS NOT NULL;
CREATE INDEX "idx_financial_events_occurred" ON "financial_events"("occurred_at");

ALTER TABLE "financial_events"
    ADD CONSTRAINT "financial_events_entity_type_valid"
        CHECK (entity_type IN ('BOOKING', 'TRIP', 'BOOKING_STOP', 'PAYMENT', 'PAYMENT_COLLECTION',
                               'PAYMENT_SETTLEMENT', 'PAYMENT_DISPUTE', 'PAYMENT_REFUND',
                               'DRIVER_EARNING', 'PAYOUT_BATCH', 'DRIVER_PAYOUT', 'PAYOUT_ITEM',
                               'WALLET_TRANSACTION', 'ADMIN_ACTION')),
    ADD CONSTRAINT "financial_events_action_valid"
        CHECK (action IN ('CREATED', 'STATUS_CHANGED', 'PAYMENT_STATUS_CHANGED', 'UPDATED', 'DELETED')),
    ADD CONSTRAINT "financial_events_actor_type_valid"
        CHECK (actor_type IN ('ADMIN', 'DRIVER', 'CUSTOMER', 'ENGINE', 'PROVIDER', 'SYSTEM',
                              'UNATTRIBUTED')),
    ADD CONSTRAINT "financial_events_changes_object" CHECK (jsonb_typeof(changes) = 'object'),
    ADD CONSTRAINT "financial_events_status_change"
        CHECK (action NOT IN ('STATUS_CHANGED', 'PAYMENT_STATUS_CHANGED')
               OR (status_from IS NOT NULL AND status_to IS NOT NULL AND status_from <> status_to));

-- ---------------------------------------------------------------------------------------------
-- Helpers. Neither ever raises: a context value the trigger can't use is left out, so an event
-- can never make a financial write fail.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION financial_event_uuid(p_value text) RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN p_value::uuid END
$$;

-- A transaction-local setting set by the service layer, trimmed and capped, or NULL.
CREATE OR REPLACE FUNCTION financial_event_setting(p_name text, p_max integer) RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT left(NULLIF(btrim(current_setting(p_name, true)), ''), p_max)
$$;

-- ---------------------------------------------------------------------------------------------
-- The event writer. TG_ARGV[0] is the entity type. Runs as the table owner, so the API role
-- writes events without any privilege on financial_events.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_financial_event() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entity  text := TG_ARGV[0];
    v_row     jsonb;
    v_old     jsonb;
    v_changes jsonb;
    v_action  text;
    v_from    text;
    v_to      text;
    v_booking uuid;
    v_driver  uuid;
    v_amount  text;
    v_actor   text := financial_event_setting('app.actor_type', 20);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_row := to_jsonb(OLD);
        v_changes := v_row;
        v_action := 'DELETED';
        v_from := v_row ->> 'status';
    ELSIF TG_OP = 'UPDATE' THEN
        v_row := to_jsonb(NEW);
        v_old := to_jsonb(OLD);
        SELECT jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
          INTO v_changes
          FROM jsonb_each(v_row) n
          JOIN jsonb_each(v_old) o ON o.key = n.key
         WHERE n.value IS DISTINCT FROM o.value
           AND n.key <> 'updated_at';
        IF v_changes IS NULL THEN
            -- Nothing but updated_at changed: nothing happened to the money.
            RETURN NULL;
        END IF;
        IF v_changes ? 'status' THEN
            v_action := 'STATUS_CHANGED';
            v_from := v_old ->> 'status';
            v_to := v_row ->> 'status';
        ELSIF v_changes ? 'payment_status' THEN
            v_action := 'PAYMENT_STATUS_CHANGED';
            v_from := v_old ->> 'payment_status';
            v_to := v_row ->> 'payment_status';
        ELSE
            v_action := 'UPDATED';
        END IF;
    ELSE
        v_row := to_jsonb(NEW);
        v_changes := v_row;
        v_action := 'CREATED';
        v_to := v_row ->> 'status';
    END IF;

    -- Who the money belongs to, so a booking's or a driver's trail is one index read.
    CASE v_entity
        WHEN 'BOOKING' THEN
            v_booking := financial_event_uuid(v_row ->> 'id');
            v_amount := v_row ->> 'final_fare_minor';
        WHEN 'TRIP' THEN
            v_booking := financial_event_uuid(v_row ->> 'booking_id');
            v_driver := financial_event_uuid(v_row ->> 'driver_id');
        WHEN 'BOOKING_STOP' THEN
            v_booking := financial_event_uuid(v_row ->> 'booking_id');
            v_amount := v_row ->> 'payable_paise';
        WHEN 'PAYMENT' THEN
            v_booking := financial_event_uuid(v_row ->> 'booking_id');
            v_amount := v_row ->> 'amount_paise';
            IF v_row ->> 'purpose' = 'DRIVER_WALLET_TOPUP' THEN
                SELECT d.id INTO v_driver
                  FROM drivers d WHERE d.user_id = financial_event_uuid(v_row ->> 'user_id');
            END IF;
        WHEN 'PAYMENT_COLLECTION' THEN
            v_booking := financial_event_uuid(v_row ->> 'booking_id');
            v_driver := financial_event_uuid(v_row ->> 'collected_by_driver_id');
            v_amount := v_row ->> 'amount_paise';
        WHEN 'PAYMENT_SETTLEMENT', 'PAYMENT_DISPUTE', 'PAYMENT_REFUND' THEN
            v_booking := financial_event_uuid(v_row ->> 'booking_id');
            v_amount := v_row ->> 'amount_paise';
        WHEN 'DRIVER_EARNING' THEN
            v_booking := financial_event_uuid(v_row ->> 'booking_id');
            v_driver := financial_event_uuid(v_row ->> 'driver_id');
            v_amount := v_row ->> 'gross_amount_paise';
        WHEN 'PAYOUT_BATCH' THEN
            v_amount := v_row ->> 'total_amount_paise';
        WHEN 'DRIVER_PAYOUT' THEN
            v_driver := financial_event_uuid(v_row ->> 'driver_id');
            v_amount := v_row ->> 'amount_paise';
        WHEN 'PAYOUT_ITEM' THEN
            SELECT e.booking_id, e.driver_id INTO v_booking, v_driver
              FROM driver_earnings e WHERE e.id = financial_event_uuid(v_row ->> 'earning_id');
            v_amount := v_row ->> 'amount_paise';
        WHEN 'WALLET_TRANSACTION' THEN
            SELECT w.driver_id INTO v_driver
              FROM driver_wallets w WHERE w.id = financial_event_uuid(v_row ->> 'wallet_id');
            v_booking := COALESCE(
                CASE WHEN v_row ->> 'reference_type' = 'BOOKING'
                     THEN financial_event_uuid(v_row ->> 'reference_id') END,
                financial_event_uuid(v_row -> 'metadata' ->> 'bookingId'));
            v_amount := v_row ->> 'amount_paise';
        WHEN 'ADMIN_ACTION' THEN
            v_booking := financial_event_uuid(v_row -> 'details' ->> 'bookingId');
            v_driver := financial_event_uuid(v_row -> 'details' ->> 'driverId');
            IF v_booking IS NULL AND v_row ->> 'target_type' = 'PAYMENT_REFUND' THEN
                SELECT r.booking_id INTO v_booking
                  FROM payment_refunds r WHERE r.id = financial_event_uuid(v_row ->> 'target_id');
            ELSIF v_booking IS NULL AND v_row ->> 'target_type' = 'BOOKING_STOP' THEN
                SELECT s.booking_id INTO v_booking
                  FROM booking_stops s WHERE s.id = financial_event_uuid(v_row ->> 'target_id');
            ELSIF v_row ->> 'target_type' = 'DRIVER_EARNING' THEN
                SELECT COALESCE(v_booking, e.booking_id), COALESCE(v_driver, e.driver_id)
                  INTO v_booking, v_driver
                  FROM driver_earnings e WHERE e.id = financial_event_uuid(v_row ->> 'target_id');
            ELSIF v_driver IS NULL AND v_row ->> 'target_type' = 'DRIVER_PAYOUT' THEN
                SELECT p.driver_id INTO v_driver
                  FROM driver_payouts p WHERE p.id = financial_event_uuid(v_row ->> 'target_id');
            END IF;
            -- The decision itself stays in admin_actions (its details can name people); the event
            -- links to it by id and carries who, what, on which record and why.
            v_changes := v_changes - 'details';
        ELSE
            RAISE EXCEPTION 'record_financial_event: unknown entity type %', v_entity;
    END CASE;

    IF v_actor IS NULL
       OR v_actor NOT IN ('ADMIN', 'DRIVER', 'CUSTOMER', 'ENGINE', 'PROVIDER', 'SYSTEM') THEN
        v_actor := 'UNATTRIBUTED';
    END IF;

    INSERT INTO financial_events (occurred_at, transaction_id, entity_type, entity_id, action,
                                  status_from, status_to, booking_id, driver_id, amount_paise,
                                  changes, actor_type, actor_user_id, request_id, origin,
                                  provider_event_id, db_role)
    VALUES (clock_timestamp(), txid_current(), v_entity, financial_event_uuid(v_row ->> 'id'),
            v_action, left(v_from, 40), left(v_to, 40), v_booking, v_driver,
            CASE WHEN v_amount ~ '^-?[0-9]{1,18}$' THEN v_amount::bigint END,
            v_changes, v_actor,
            financial_event_uuid(financial_event_setting('app.actor_user_id', 36)),
            financial_event_setting('app.request_id', 100),
            financial_event_setting('app.origin', 150),
            financial_event_setting('app.provider_event_id', 150),
            left(session_user::text, 63));
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_bookings_financial_event AFTER INSERT OR UPDATE OR DELETE ON "bookings"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('BOOKING');
CREATE TRIGGER trg_trips_financial_event AFTER INSERT OR UPDATE OR DELETE ON "trips"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('TRIP');
CREATE TRIGGER trg_booking_stops_financial_event AFTER INSERT OR UPDATE OR DELETE ON "booking_stops"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('BOOKING_STOP');
CREATE TRIGGER trg_payments_financial_event AFTER INSERT OR UPDATE OR DELETE ON "payments"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('PAYMENT');
CREATE TRIGGER trg_payment_collections_financial_event AFTER INSERT OR UPDATE OR DELETE ON "payment_collections"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('PAYMENT_COLLECTION');
CREATE TRIGGER trg_payment_settlements_financial_event AFTER INSERT OR UPDATE OR DELETE ON "payment_settlements"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('PAYMENT_SETTLEMENT');
CREATE TRIGGER trg_payment_disputes_financial_event AFTER INSERT OR UPDATE OR DELETE ON "payment_disputes"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('PAYMENT_DISPUTE');
CREATE TRIGGER trg_payment_refunds_financial_event AFTER INSERT OR UPDATE OR DELETE ON "payment_refunds"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('PAYMENT_REFUND');
CREATE TRIGGER trg_driver_earnings_financial_event AFTER INSERT OR UPDATE OR DELETE ON "driver_earnings"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('DRIVER_EARNING');
CREATE TRIGGER trg_payout_batches_financial_event AFTER INSERT OR UPDATE OR DELETE ON "payout_batches"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('PAYOUT_BATCH');
CREATE TRIGGER trg_driver_payouts_financial_event AFTER INSERT OR UPDATE OR DELETE ON "driver_payouts"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('DRIVER_PAYOUT');
CREATE TRIGGER trg_payout_items_financial_event AFTER INSERT OR UPDATE OR DELETE ON "payout_items"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('PAYOUT_ITEM');
CREATE TRIGGER trg_wallet_tx_financial_event AFTER INSERT OR UPDATE OR DELETE ON "driver_wallet_transactions"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('WALLET_TRANSACTION');
CREATE TRIGGER trg_admin_actions_financial_event AFTER INSERT OR UPDATE OR DELETE ON "admin_actions"
    FOR EACH ROW EXECUTE FUNCTION record_financial_event('ADMIN_ACTION');

-- ---------------------------------------------------------------------------------------------
-- Append-only, for every role.
-- ---------------------------------------------------------------------------------------------
-- Only record_financial_event() inserts: it runs inside another table's trigger, so the insert
-- arrives at trigger depth 2 or more. A direct INSERT (depth 1) is refused, the owner's too.
CREATE OR REPLACE FUNCTION guard_financial_event_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'financial_events is written only by the financial record triggers'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_financial_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'financial_events is append-only: events are never changed or removed'
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_financial_events_insert_guard BEFORE INSERT ON "financial_events"
    FOR EACH ROW EXECUTE FUNCTION guard_financial_event_insert();
CREATE TRIGGER trg_financial_events_immutable BEFORE UPDATE OR DELETE ON "financial_events"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_event_mutation();
CREATE TRIGGER trg_financial_events_no_truncate BEFORE TRUNCATE ON "financial_events"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_event_mutation();
