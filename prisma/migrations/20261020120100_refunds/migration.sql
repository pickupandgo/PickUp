-- Refund infrastructure (payment flow Phase 6; docs/PAYMENT_FLOW_FINAL_REVIEW.md C.5).
--
--   payment_refunds. One row per refund an admin requests: a provider refund (Razorpay refunds
--   the customer's online payment) or a cash return (the cash was handed back to the customer).
--   Each names exactly one source: a completed collection or a paid historical prepaid booking
--   payment, of its own booking and drop. The source, amount, reason and the admin's decisions
--   never change. A provider refund moves PENDING -> PROCESSING -> COMPLETED (or FAILED; REFUSED
--   when the provider rejects it; CANCELLED by an admin while it never reached the provider). A
--   cash return is recorded COMPLETED, with the admin's stated platform-fee treatment.
--
--   Integrity, for every role, the table owner included: an active admin requests it; only a
--   cancelled or completed booking is refunded; at most one live (PENDING or PROCESSING) refund
--   per source; refunds of a source never exceed what it collected; a provider refund id is
--   recorded once; a cash fee credited back is exactly the collection's fee, once, written with
--   the cash return that decided it (no silent wallet movement).
--
--   Effects. payment_collections.refunded_paise is the sum of a collection's completed refunds,
--   kept by a trigger. The booking's payment status follows its collections and refunds:
--   REFUND_PENDING while a refund is live, then REFUNDED or PARTIALLY_REFUNDED, or back to what
--   its collections say when a refund fails (booking_money_status, checked at commit).
--
--   Policy stays open (OPEN_DECISIONS L-7 to L-10, L-21): nothing here refunds, debits or
--   recovers anything on its own.
--
-- No existing row changes: the new column defaults to 0 and no refund exists yet.
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

-- ---------------------------------------------------------------------------------------------
-- payment_collections: what has been refunded of each collection.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "payment_collections" ADD COLUMN "refunded_paise" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "payment_collections"
    ADD CONSTRAINT "collections_refunded_within_amount"
        CHECK (refunded_paise >= 0 AND refunded_paise <= amount_paise);

-- ---------------------------------------------------------------------------------------------
-- payment_refunds
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "booking_stop_id" UUID,
    "source_collection_id" UUID,
    "source_payment_id" UUID,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "refund_case" VARCHAR(40) NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "reason" VARCHAR(500) NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(150) NOT NULL,
    "provider" VARCHAR(40),
    "provider_payment_id" VARCHAR(100),
    "provider_refund_id" VARCHAR(100),
    "provider_status" VARCHAR(30),
    "provider_reference" VARCHAR(100),
    "fee_treatment" VARCHAR(30),
    "fee_credit_paise" BIGINT,
    "wallet_transaction_id" UUID,
    "failure_reason" VARCHAR(200),
    "submit_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_submitted_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "cancellation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_refunds_idempotency_key" ON "payment_refunds"("idempotency_key");
CREATE UNIQUE INDEX "uq_refunds_wallet_tx" ON "payment_refunds"("wallet_transaction_id");
-- A provider refund id is recorded once.
CREATE UNIQUE INDEX "uq_refunds_provider_refund" ON "payment_refunds"("provider", "provider_refund_id")
    WHERE provider_refund_id IS NOT NULL;
-- One live refund per source at a time.
CREATE UNIQUE INDEX "uq_refunds_collection_live" ON "payment_refunds"("source_collection_id")
    WHERE source_collection_id IS NOT NULL AND status IN ('PENDING', 'PROCESSING');
CREATE UNIQUE INDEX "uq_refunds_payment_live" ON "payment_refunds"("source_payment_id")
    WHERE source_payment_id IS NOT NULL AND status IN ('PENDING', 'PROCESSING');
CREATE INDEX "idx_refunds_booking" ON "payment_refunds"("booking_id");
CREATE INDEX "idx_refunds_collection" ON "payment_refunds"("source_collection_id");
CREATE INDEX "idx_refunds_payment" ON "payment_refunds"("source_payment_id");
CREATE INDEX "idx_refunds_status_created" ON "payment_refunds"("status", "created_at");

ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_booking_id_booking_stop_id_fkey" FOREIGN KEY ("booking_id", "booking_stop_id") REFERENCES "booking_stops"("booking_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_source_collection_id_fkey" FOREIGN KEY ("source_collection_id") REFERENCES "payment_collections"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_source_payment_id_fkey" FOREIGN KEY ("source_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "driver_wallet_transactions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "payment_refunds"
    ADD CONSTRAINT "refunds_one_source"
        CHECK (num_nonnulls(source_collection_id, source_payment_id) = 1),
    ADD CONSTRAINT "refunds_kind_valid" CHECK (kind IN ('PROVIDER', 'CASH_RETURNED')),
    ADD CONSTRAINT "refunds_status_valid"
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUSED', 'CANCELLED')),
    ADD CONSTRAINT "refunds_case_valid"
        CHECK (refund_case IN ('CANCELLED_BEFORE_HANDOVER', 'CANCELLED_AFTER_HANDOVER',
                               'UNDELIVERED_DROP', 'COMPLETED_BOOKING')),
    ADD CONSTRAINT "refunds_amount_positive" CHECK (amount_paise > 0),
    ADD CONSTRAINT "refunds_currency_inr" CHECK (currency = 'INR'),
    ADD CONSTRAINT "refunds_reason_not_blank" CHECK (length(btrim(reason)) >= 3),
    ADD CONSTRAINT "refunds_idempotency_key_not_blank" CHECK (length(btrim(idempotency_key)) > 0),
    ADD CONSTRAINT "refunds_provider_payment_id_format"
        CHECK (provider_payment_id IS NULL OR provider_payment_id ~ '^pay_[A-Za-z0-9]{6,40}$'),
    ADD CONSTRAINT "refunds_provider_refund_id_format"
        CHECK (provider_refund_id IS NULL OR provider_refund_id ~ '^rfnd_[A-Za-z0-9]{6,40}$'),
    ADD CONSTRAINT "refunds_submit_attempts_nonnegative" CHECK (submit_attempts >= 0),
    -- A provider refund refunds an online payment of ours through Razorpay; a cash return is
    -- recorded as done, from a cash collection, with the admin's fee decision.
    ADD CONSTRAINT "refunds_kind_shape"
        CHECK ((kind = 'PROVIDER' AND provider = 'RAZORPAY' AND provider_payment_id IS NOT NULL
                AND fee_treatment IS NULL)
            OR (kind = 'CASH_RETURNED' AND source_collection_id IS NOT NULL AND provider IS NULL
                AND provider_payment_id IS NULL AND provider_refund_id IS NULL
                AND provider_status IS NULL AND status = 'COMPLETED' AND submit_attempts = 0
                AND fee_treatment IN ('KEPT', 'CREDITED_TO_WALLET'))),
    ADD CONSTRAINT "refunds_fee_credit_shape"
        CHECK ((fee_treatment = 'CREDITED_TO_WALLET' AND fee_credit_paise > 0
                AND wallet_transaction_id IS NOT NULL)
            OR (fee_treatment IS DISTINCT FROM 'CREDITED_TO_WALLET' AND fee_credit_paise IS NULL
                AND wallet_transaction_id IS NULL)),
    -- Each status carries its facts.
    ADD CONSTRAINT "refunds_status_facts"
        CHECK ((status = 'PENDING' AND provider_refund_id IS NULL AND completed_at IS NULL
                AND failed_at IS NULL AND cancelled_at IS NULL)
            OR (status = 'PROCESSING' AND provider_refund_id IS NOT NULL AND completed_at IS NULL
                AND failed_at IS NULL AND cancelled_at IS NULL)
            OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND failed_at IS NULL
                AND cancelled_at IS NULL AND (kind = 'CASH_RETURNED' OR provider_refund_id IS NOT NULL))
            OR (status = 'FAILED' AND failed_at IS NOT NULL AND failure_reason IS NOT NULL
                AND completed_at IS NULL AND cancelled_at IS NULL)
            OR (status = 'REFUSED' AND failed_at IS NOT NULL AND failure_reason IS NOT NULL
                AND provider_refund_id IS NULL AND completed_at IS NULL AND cancelled_at IS NULL)
            OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL
                AND cancellation_reason IS NOT NULL AND length(btrim(cancellation_reason)) >= 3
                AND provider_refund_id IS NULL AND completed_at IS NULL AND failed_at IS NULL));

-- ---------------------------------------------------------------------------------------------
-- The booking's payment status from its money.
-- ---------------------------------------------------------------------------------------------
-- What a booking's money says: REFUND_PENDING while a refund is live; otherwise what its
-- completed collections (or its paid prepaid payment) say, unless refunds completed: then
-- REFUNDED once everything collected was refunded, PARTIALLY_REFUNDED before that.
CREATE OR REPLACE FUNCTION booking_money_status(p_booking_id uuid) RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN live.n > 0 THEN 'REFUND_PENDING'
        WHEN refunded.paise = 0 THEN
            CASE WHEN prepaid.n > 0 THEN 'PAID' ELSE booking_collected_status(p_booking_id) END
        WHEN refunded.paise >= collected.paise THEN 'REFUNDED'
        ELSE 'PARTIALLY_REFUNDED'
    END
      FROM (SELECT count(*) AS n FROM payment_refunds r
             WHERE r.booking_id = p_booking_id AND r.status IN ('PENDING', 'PROCESSING')) live
     CROSS JOIN (SELECT coalesce(sum(r.amount_paise), 0) AS paise FROM payment_refunds r
                  WHERE r.booking_id = p_booking_id AND r.status = 'COMPLETED') refunded
     CROSS JOIN (SELECT count(*) AS n FROM payments p
                  WHERE p.booking_id = p_booking_id AND p.purpose = 'BOOKING'
                    AND p.status::text = 'PAID') prepaid
     CROSS JOIN (SELECT (SELECT coalesce(sum(c.amount_paise), 0) FROM payment_collections c
                          WHERE c.booking_id = p_booking_id AND c.status = 'COMPLETED')
                      + (SELECT coalesce(sum(p.amount_paise), 0) FROM payments p
                          WHERE p.booking_id = p_booking_id AND p.purpose = 'BOOKING'
                            AND p.status::text = 'PAID') AS paise) collected
$$;

-- The booking guard of 20261018120100, plus the refund statuses: a booking moves to or from
-- REFUND_PENDING, PARTIALLY_REFUNDED or REFUNDED only as its collections and refunds say.
CREATE OR REPLACE FUNCTION guard_booking_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_collected text;
    v_money text;
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
    -- Paid money can only move into the refund statuses (a provider refund through REFUND_PENDING,
    -- a cash return straight to REFUNDED or PARTIALLY_REFUNDED), and back from REFUND_PENDING when
    -- a refund fails. Which one, always: what the money says (checked below).
    IF NEW.payment_status <> OLD.payment_status AND NOT (
           (OLD.payment_status = 'UNPAID' AND NEW.payment_status IN ('PARTIALLY_PAID', 'PAID'))
        OR (OLD.payment_status = 'PARTIALLY_PAID' AND NEW.payment_status = 'PAID')
        OR (OLD.payment_status::text IN ('PARTIALLY_PAID', 'PAID', 'REFUND_PENDING',
                                         'PARTIALLY_REFUNDED', 'REFUNDED')
            AND NEW.payment_status::text IN ('REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'))
        OR (OLD.payment_status::text = 'REFUND_PENDING'
            AND NEW.payment_status::text IN ('PARTIALLY_PAID', 'PAID'))
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
    IF NEW.payment_status <> OLD.payment_status
       AND (NEW.payment_status::text IN ('REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED')
            OR OLD.payment_status::text IN ('REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED')) THEN
        v_money := booking_money_status(NEW.id);
        IF NEW.payment_status::text <> v_money THEN
            RAISE EXCEPTION 'A booking''s payment status follows its collections and refunds: they say %', v_money
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- The collection effects check of 20261018120100, plus bookings with refunds: a collection that
-- completes on such a booking (money that arrived late) leaves the status its money says.
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
    ELSE
        v_collected := booking_money_status(NEW.booking_id);
        IF b.payment_status <> v_collected THEN
            RAISE EXCEPTION 'Booking % is % but its collections and refunds say %: the payment status changes with the collection', NEW.booking_id, b.payment_status, v_collected
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

-- The collection guard of 20261016120000, plus refunded_paise: it is always the sum of the
-- collection's completed refunds (kept by trg_refunds_sync_collection).
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
    IF NEW.refunded_paise IS DISTINCT FROM OLD.refunded_paise
       AND NEW.refunded_paise <> (SELECT coalesce(sum(r.amount_paise), 0)
                                    FROM payment_refunds r
                                   WHERE r.source_collection_id = NEW.id
                                     AND r.status = 'COMPLETED') THEN
        RAISE EXCEPTION 'A collection''s refunded amount is the sum of its completed refunds'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- payment_refunds guards
-- ---------------------------------------------------------------------------------------------
-- A refund is requested by an active admin, for a cancelled or completed booking, from one
-- completed collection (or paid prepaid payment) of that booking and drop, by the means the
-- money came in, never for more than is left of it. The source row is locked, so concurrent
-- requests are checked one after the other.
CREATE OR REPLACE FUNCTION guard_refund_insert() RETURNS trigger AS $$
DECLARE
    v_booking_status text;
    c RECORD;
    p RECORD;
    w RECORD;
    v_source_amount bigint;
    v_taken bigint;
    v_completed bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM users u
         WHERE u.id = NEW.requested_by_user_id AND u.role = 'ADMIN' AND u.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Only an active admin requests a refund'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF (NEW.kind = 'PROVIDER' AND NEW.status <> 'PENDING')
       OR (NEW.kind = 'CASH_RETURNED' AND NEW.status <> 'COMPLETED') THEN
        RAISE EXCEPTION 'A provider refund starts PENDING; a cash return is recorded COMPLETED'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.submit_attempts <> 0 OR NEW.last_submitted_at IS NOT NULL
       OR NEW.provider_refund_id IS NOT NULL OR NEW.provider_status IS NOT NULL THEN
        RAISE EXCEPTION 'A refund is recorded before it is sent to the provider'
            USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT status::text INTO v_booking_status FROM bookings WHERE id = NEW.booking_id;
    IF v_booking_status IS NULL OR v_booking_status NOT IN ('CANCELLED', 'COMPLETED') THEN
        RAISE EXCEPTION 'A refund is made only for a cancelled or completed booking'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.source_collection_id IS NOT NULL THEN
        SELECT id, booking_id, booking_stop_id, method, status, provider, provider_payment_id,
               amount_paise, platform_fee_paise, collected_by_driver_id
          INTO c
          FROM payment_collections WHERE id = NEW.source_collection_id
           FOR UPDATE;
        IF NOT FOUND OR c.booking_id <> NEW.booking_id
           OR c.booking_stop_id IS DISTINCT FROM NEW.booking_stop_id THEN
            RAISE EXCEPTION 'A refund names a collection of its own booking and drop'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF c.status <> 'COMPLETED' THEN
            RAISE EXCEPTION 'Only a completed collection is refunded'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.kind = 'PROVIDER'
           AND (c.method <> 'ONLINE_QR' OR c.provider IS DISTINCT FROM 'RAZORPAY'
                OR c.provider_payment_id IS DISTINCT FROM NEW.provider_payment_id) THEN
            RAISE EXCEPTION 'A provider refund refunds the collection''s own online payment'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.kind = 'CASH_RETURNED' AND c.method <> 'CASH' THEN
            RAISE EXCEPTION 'Only money collected in cash is returned in cash'
                USING ERRCODE = 'restrict_violation';
        END IF;
        v_source_amount := c.amount_paise;
        SELECT coalesce(sum(r.amount_paise) FILTER (WHERE r.status IN ('PENDING', 'PROCESSING', 'COMPLETED')), 0),
               coalesce(sum(r.amount_paise) FILTER (WHERE r.status = 'COMPLETED'), 0)
          INTO v_taken, v_completed
          FROM payment_refunds r WHERE r.source_collection_id = NEW.source_collection_id;
    ELSE
        SELECT id, booking_id, purpose, status::text AS status, razorpay_payment_id, amount_paise
          INTO p
          FROM payments WHERE id = NEW.source_payment_id
           FOR UPDATE;
        IF NOT FOUND OR p.booking_id IS DISTINCT FROM NEW.booking_id OR p.purpose <> 'BOOKING'
           OR NEW.booking_stop_id IS NOT NULL THEN
            RAISE EXCEPTION 'A refund names a booking payment of its own booking'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF p.status <> 'PAID' THEN
            RAISE EXCEPTION 'Only a paid booking payment is refunded'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.kind <> 'PROVIDER' OR p.razorpay_payment_id IS DISTINCT FROM NEW.provider_payment_id THEN
            RAISE EXCEPTION 'A prepaid payment is refunded through the provider, for its own payment'
                USING ERRCODE = 'restrict_violation';
        END IF;
        v_source_amount := p.amount_paise;
        SELECT coalesce(sum(r.amount_paise) FILTER (WHERE r.status IN ('PENDING', 'PROCESSING', 'COMPLETED')), 0),
               coalesce(sum(r.amount_paise) FILTER (WHERE r.status = 'COMPLETED'), 0)
          INTO v_taken, v_completed
          FROM payment_refunds r WHERE r.source_payment_id = NEW.source_payment_id;
    END IF;

    IF v_taken + NEW.amount_paise > v_source_amount THEN
        RAISE EXCEPTION 'Refunds never exceed what was collected: % of % paise already refunded or in progress', v_taken, v_source_amount
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.fee_treatment = 'CREDITED_TO_WALLET' THEN
        IF v_completed + NEW.amount_paise <> v_source_amount THEN
            RAISE EXCEPTION 'The cash fee is credited back only with the cash return that completes the collection''s refund'
                USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM payment_refunds r
                    WHERE r.source_collection_id = NEW.source_collection_id
                      AND r.wallet_transaction_id IS NOT NULL) THEN
            RAISE EXCEPTION 'A collection''s cash fee is credited back once'
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT t.type::text AS type, t.direction::text AS direction, t.amount_paise,
               t.reference_type, t.reference_id, dw.driver_id
          INTO w
          FROM driver_wallet_transactions t
          JOIN driver_wallets dw ON dw.id = t.wallet_id
         WHERE t.id = NEW.wallet_transaction_id;
        IF NOT FOUND OR w.type <> 'REFUND_REVERSAL' OR w.direction <> 'CREDIT'
           OR c.platform_fee_paise IS NULL OR w.amount_paise <> c.platform_fee_paise
           OR NEW.fee_credit_paise <> c.platform_fee_paise
           OR w.driver_id <> c.collected_by_driver_id
           OR w.reference_type <> 'REFUND' OR w.reference_id <> NEW.id::text THEN
            RAISE EXCEPTION 'A cash fee credit is the collecting driver''s REFUND_REVERSAL credit of exactly the collection''s fee, for this cash return'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The source, amount, reason and decisions never change; the provider refund id, and each
-- outcome time, is set once; the status moves along the lifecycle; only a pending provider
-- refund is (re)submitted; only an active admin cancels one.
CREATE OR REPLACE FUNCTION guard_refund_update() RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.booking_id <> OLD.booking_id
       OR NEW.booking_stop_id IS DISTINCT FROM OLD.booking_stop_id
       OR NEW.source_collection_id IS DISTINCT FROM OLD.source_collection_id
       OR NEW.source_payment_id IS DISTINCT FROM OLD.source_payment_id
       OR NEW.kind <> OLD.kind
       OR NEW.refund_case <> OLD.refund_case
       OR NEW.amount_paise <> OLD.amount_paise
       OR NEW.currency <> OLD.currency
       OR NEW.reason <> OLD.reason
       OR NEW.requested_by_user_id <> OLD.requested_by_user_id
       OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
       OR NEW.fee_treatment IS DISTINCT FROM OLD.fee_treatment
       OR NEW.fee_credit_paise IS DISTINCT FROM OLD.fee_credit_paise
       OR NEW.wallet_transaction_id IS DISTINCT FROM OLD.wallet_transaction_id
       OR NEW.created_at <> OLD.created_at
       OR (OLD.provider_refund_id IS NOT NULL
           AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id)
       OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
       OR (OLD.failed_at IS NOT NULL AND NEW.failed_at IS DISTINCT FROM OLD.failed_at)
       OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at)
       OR (OLD.cancelled_by_user_id IS NOT NULL
           AND NEW.cancelled_by_user_id IS DISTINCT FROM OLD.cancelled_by_user_id)
       OR NEW.submit_attempts < OLD.submit_attempts THEN
        RAISE EXCEPTION 'A refund''s source, amount, reason and decisions are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF (NEW.submit_attempts <> OLD.submit_attempts
        OR NEW.last_submitted_at IS DISTINCT FROM OLD.last_submitted_at)
       AND (OLD.status <> 'PENDING' OR OLD.kind <> 'PROVIDER') THEN
        RAISE EXCEPTION 'Only a pending provider refund is sent to the provider'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
           (OLD.status = 'PENDING'
            AND NEW.status IN ('PROCESSING', 'COMPLETED', 'FAILED', 'REFUSED', 'CANCELLED'))
        OR (OLD.status = 'PROCESSING' AND NEW.status IN ('COMPLETED', 'FAILED'))
    ) THEN
        RAISE EXCEPTION 'Invalid refund transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' AND NOT EXISTS (
        SELECT 1 FROM users u
         WHERE u.id = NEW.cancelled_by_user_id AND u.role = 'ADMIN' AND u.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Only an active admin cancels a refund'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refunds_insert_guard BEFORE INSERT ON "payment_refunds"
    FOR EACH ROW EXECUTE FUNCTION guard_refund_insert();
CREATE TRIGGER trg_refunds_guard BEFORE UPDATE ON "payment_refunds"
    FOR EACH ROW EXECUTE FUNCTION guard_refund_update();
CREATE TRIGGER trg_refunds_no_delete BEFORE DELETE ON "payment_refunds"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_refunds_no_truncate BEFORE TRUNCATE ON "payment_refunds"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();

-- refunded_paise follows the completed refunds. Runs as the table owner: the API role has no
-- privilege on refunded_paise, and the collection guard accepts only the right sum.
CREATE OR REPLACE FUNCTION sync_collection_refunded() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_refunded bigint;
BEGIN
    IF NEW.source_collection_id IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN
        RETURN NULL;
    END IF;
    SELECT coalesce(sum(r.amount_paise), 0) INTO v_refunded
      FROM payment_refunds r
     WHERE r.source_collection_id = NEW.source_collection_id AND r.status = 'COMPLETED';
    UPDATE payment_collections
       SET refunded_paise = v_refunded
     WHERE id = NEW.source_collection_id AND refunded_paise <> v_refunded;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_refunds_sync_collection AFTER INSERT OR UPDATE OF status ON "payment_refunds"
    FOR EACH ROW EXECUTE FUNCTION sync_collection_refunded();

-- At commit: the booking's payment status is what its collections and refunds say.
CREATE OR REPLACE FUNCTION check_refund_effects() RETURNS trigger AS $$
DECLARE
    v_status text;
    v_money text;
BEGIN
    SELECT payment_status::text INTO v_status FROM bookings WHERE id = NEW.booking_id;
    v_money := booking_money_status(NEW.booking_id);
    IF v_status IS DISTINCT FROM v_money THEN
        RAISE EXCEPTION 'Booking % is % but its collections and refunds say %: the payment status changes with the refund', NEW.booking_id, v_status, v_money
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_refunds_effects AFTER INSERT OR UPDATE OF status ON "payment_refunds"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION check_refund_effects();

-- ---------------------------------------------------------------------------------------------
-- driver_wallet_transactions: a platform fee credited back on a cash return.
-- ---------------------------------------------------------------------------------------------
-- REFUND_REVERSAL (unused until now) is the credit of a cash ride fee an admin decided to give
-- back with a cash return: always a credit, always audited, always for that cash return.
ALTER TABLE "driver_wallet_transactions"
    ADD CONSTRAINT "wallet_tx_refund_reversal_shape"
        CHECK (type <> 'REFUND_REVERSAL'
               OR (direction = 'CREDIT' AND reference_type = 'REFUND'
                   AND performed_by_user_id IS NOT NULL AND reason IS NOT NULL
                   AND length(btrim(reason)) > 0));

-- At commit: a REFUND_REVERSAL credit exists only with the cash return that decided it.
CREATE OR REPLACE FUNCTION check_refund_reversal_entry() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM payment_refunds r
         WHERE r.wallet_transaction_id = NEW.id AND r.fee_treatment = 'CREDITED_TO_WALLET'
    ) THEN
        RAISE EXCEPTION 'A REFUND_REVERSAL credit is written only with the cash return that decided it'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_wallet_refund_reversal AFTER INSERT ON "driver_wallet_transactions"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW.type = 'REFUND_REVERSAL')
    EXECUTE FUNCTION check_refund_reversal_entry();

-- ---------------------------------------------------------------------------------------------
-- Documentation for anyone reading the database directly.
-- ---------------------------------------------------------------------------------------------
COMMENT ON TABLE "payment_refunds" IS 'Refunds an admin requested: a provider refund of an online payment, or a cash return of a cash collection. Never automatic; policy is open (OPEN_DECISIONS L-7 to L-10, L-21).';
COMMENT ON COLUMN "payment_refunds"."refund_case" IS 'What the booking''s facts show at the request (cancelled before or after the handover, an undelivered drop, a completed booking). Recorded for review; it decides nothing.';
COMMENT ON COLUMN "payment_refunds"."fee_treatment" IS 'Cash returns only: KEPT (the platform fee stays debited) or CREDITED_TO_WALLET (credited back, wallet_transaction_id), as the admin stated.';
COMMENT ON COLUMN "payment_collections"."refunded_paise" IS 'Sum of this collection''s completed refunds, kept by trg_refunds_sync_collection.';
