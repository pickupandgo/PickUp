-- Obligation-aware collections (payment flow Phase 4).
--
-- The database's own copy of the collection rules, behind the service and API checks, so that no
-- code path and no direct SQL (the table owner included) can collect the wrong obligation, the
-- wrong amount, or mark a booking paid that its collections don't pay for:
--
--   One obligation per collection. A PAY_AT_PICKUP booking is collected once, for the whole
--   booking, at the pickup. A PAY_AT_DELIVERY booking priced per drop is collected drop by drop:
--   only the drop the driver is at (ARRIVED, not paid yet), for that drop's frozen payable amount;
--   in cash, the driver's wallet is debited that drop's share of the platform fee. A cash fee is
--   always the collecting driver's own CASH_RIDE_FEE debit of exactly that fee.
--
--   Payment status follows the money. A booking priced per drop is UNPAID, PARTIALLY_PAID (some
--   drops paid) or PAID (every drop paid), as its completed collections say, and a paid drop's
--   payment is confirmed (PAYMENT_CONFIRMED) in the same transaction (deferred check).
--
--   Earnings know their collections. earning_collections lists every collection that funds an
--   earning, with its method, amount and fee share. An earning funded by several collections
--   (cash, online, or both: MIXED) is checked against them at commit. Making such an earning
--   payable (per-collection settlement and the payout amount) is Phase 5.
--
-- No row is rewritten. Historical (LEGACY_BOOKING_LEVEL) bookings keep their rules: one
-- collection for the whole booking and single-source earnings.
--
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

-- ---------------------------------------------------------------------------------------------
-- What a booking's completed collections say it is paid. Shared by the booking update guard and
-- the collection check below.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking_collected_status(p_booking_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN b.payment_method = 'PAY_AT_DELIVERY' AND b.payment_model = 'QUOTE_PER_STOP' THEN
            CASE
                WHEN paid.n = 0 THEN 'UNPAID'
                WHEN paid.n = stops.n THEN 'PAID'
                ELSE 'PARTIALLY_PAID'
            END
        WHEN EXISTS (
            SELECT 1 FROM payment_collections c
             WHERE c.booking_id = b.id AND c.booking_stop_id IS NULL AND c.status = 'COMPLETED'
        ) THEN 'PAID'
        ELSE 'UNPAID'
    END
      FROM bookings b
      CROSS JOIN LATERAL (
            SELECT count(*) AS n FROM booking_stops s WHERE s.booking_id = b.id
      ) stops
      CROSS JOIN LATERAL (
            SELECT count(DISTINCT c.booking_stop_id) AS n
              FROM payment_collections c
             WHERE c.booking_id = b.id AND c.booking_stop_id IS NOT NULL AND c.status = 'COMPLETED'
      ) paid
     WHERE b.id = p_booking_id
$$;

-- ---------------------------------------------------------------------------------------------
-- bookings: payment status UNPAID -> PARTIALLY_PAID -> PAID, and for bookings priced per drop
-- always what the completed collections say.
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- payment_collections: one obligation per collection.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_collection_insert() RETURNS trigger AS $$
DECLARE
    b RECORD;
    s RECORD;
    t RECORD;
    w RECORD;
BEGIN
    SELECT status, payment_method, payment_model, final_fare_minor, platform_fee_paise
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

    IF b.payment_model = 'QUOTE_PER_STOP' THEN
        IF b.status IN ('CANCELLED', 'COMPLETED') THEN
            RAISE EXCEPTION 'A closed booking is not collected'
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT id, driver_id INTO t FROM trips WHERE booking_id = NEW.booking_id;
        IF NOT FOUND OR t.id <> NEW.trip_id OR t.driver_id <> NEW.collected_by_driver_id THEN
            RAISE EXCEPTION 'A booking is collected on its own trip, by its own driver'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.stage = 'DELIVERY' THEN
            IF NEW.booking_stop_id IS NULL THEN
                RAISE EXCEPTION 'A pay-at-delivery booking priced per drop is collected drop by drop'
                    USING ERRCODE = 'check_violation';
            END IF;
            SELECT status, payable_paise, platform_fee_share_paise
              INTO s
              FROM booking_stops WHERE id = NEW.booking_stop_id AND booking_id = NEW.booking_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Drop % is not a drop of booking %', NEW.booking_stop_id, NEW.booking_id
                    USING ERRCODE = 'foreign_key_violation';
            END IF;
            IF s.status <> 'ARRIVED' THEN
                RAISE EXCEPTION 'Only the drop the driver is at, before it is paid, is collected (the drop is %)', s.status
                    USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.amount_paise <> s.payable_paise THEN
                RAISE EXCEPTION 'A drop is collected for its own payable amount'
                    USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.method = 'CASH' AND NEW.platform_fee_paise IS DISTINCT FROM s.platform_fee_share_paise THEN
                RAISE EXCEPTION 'A cash drop debits that drop''s share of the platform fee'
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSE
            IF NEW.amount_paise <> b.final_fare_minor THEN
                RAISE EXCEPTION 'A collection must be for the booking''s payable amount'
                    USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.method = 'CASH' AND NEW.platform_fee_paise IS DISTINCT FROM b.platform_fee_paise THEN
                RAISE EXCEPTION 'A cash collection must debit the booking''s frozen platform fee'
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSIF NEW.amount_paise <> b.final_fare_minor THEN
        RAISE EXCEPTION 'A collection must be for the booking''s payable amount'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.wallet_transaction_id IS NOT NULL THEN
        SELECT tx.type::text AS type, tx.direction::text AS direction, tx.amount_paise, wl.driver_id
          INTO w
          FROM driver_wallet_transactions tx
          JOIN driver_wallets wl ON wl.id = tx.wallet_id
         WHERE tx.id = NEW.wallet_transaction_id;
        IF NOT FOUND
           OR w.type <> 'CASH_RIDE_FEE' OR w.direction <> 'DEBIT'
           OR w.amount_paise IS DISTINCT FROM NEW.platform_fee_paise
           OR w.driver_id <> NEW.collected_by_driver_id THEN
            RAISE EXCEPTION 'A cash collection''s fee is the collecting driver''s own platform-fee debit, of exactly that fee'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- At commit, for a booking priced per drop: a completed collection has moved the booking's payment
-- status to what its collections say, and a paid drop is no longer waiting for its payment.
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

CREATE CONSTRAINT TRIGGER trg_collections_effects AFTER INSERT OR UPDATE OF status ON "payment_collections"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW.status = 'COMPLETED')
    EXECUTE FUNCTION check_collection_effects();

-- ---------------------------------------------------------------------------------------------
-- earning_collections: the collections that fund each earning.
-- ---------------------------------------------------------------------------------------------
-- CreateTable
CREATE TABLE "earning_collections" (
    "collection_id" UUID NOT NULL,
    "earning_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "platform_fee_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earning_collections_pkey" PRIMARY KEY ("collection_id")
);

-- CreateIndex
CREATE INDEX "idx_earning_collections_earning" ON "earning_collections"("earning_id");

-- CreateIndex
CREATE INDEX "idx_earning_collections_booking" ON "earning_collections"("booking_id");

-- AddForeignKey
ALTER TABLE "earning_collections" ADD CONSTRAINT "earning_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "payment_collections"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "earning_collections" ADD CONSTRAINT "earning_collections_earning_id_fkey" FOREIGN KEY ("earning_id") REFERENCES "driver_earnings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "earning_collections" ADD CONSTRAINT "earning_collections_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "earning_collections"
    ADD CONSTRAINT "earning_collections_method_valid" CHECK (method IN ('CASH', 'ONLINE_QR')),
    ADD CONSTRAINT "earning_collections_amount_positive" CHECK (amount_paise > 0),
    ADD CONSTRAINT "earning_collections_fee_within_amount"
        CHECK (platform_fee_paise >= 0 AND platform_fee_paise <= amount_paise);

-- A link is written with its earning, in the same transaction, for a completed collection of the
-- earning's own booking, with that collection's method, amount and fee.
CREATE OR REPLACE FUNCTION guard_earning_collection_insert() RETURNS trigger AS $$
DECLARE
    c RECORD;
    e RECORD;
    v_fee bigint;
BEGIN
    SELECT booking_id, booking_stop_id, method, status, amount_paise, platform_fee_paise
      INTO c
      FROM payment_collections WHERE id = NEW.collection_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Collection % does not exist', NEW.collection_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    SELECT booking_id, xmin INTO e FROM driver_earnings WHERE id = NEW.earning_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Earning % does not exist', NEW.earning_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF e.xmin <> pg_current_xact_id()::xid THEN
        RAISE EXCEPTION 'An earning''s collections are recorded with the earning, in its transaction'
            USING ERRCODE = 'check_violation';
    END IF;
    IF c.booking_id <> NEW.booking_id OR e.booking_id <> NEW.booking_id THEN
        RAISE EXCEPTION 'An earning is funded only by collections of its own booking'
            USING ERRCODE = 'check_violation';
    END IF;
    IF c.status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'Only a completed collection funds an earning'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.method <> c.method OR NEW.amount_paise <> c.amount_paise THEN
        RAISE EXCEPTION 'An earning''s collection keeps the collection''s method and amount'
            USING ERRCODE = 'check_violation';
    END IF;
    IF c.method = 'CASH' THEN
        v_fee := c.platform_fee_paise;
    ELSIF c.booking_stop_id IS NOT NULL THEN
        SELECT platform_fee_share_paise INTO v_fee FROM booking_stops WHERE id = c.booking_stop_id;
    ELSE
        -- The whole booking online: its frozen fee (a historical booking's fee comes from its
        -- pinned rule, computed by the backend as it always was).
        SELECT platform_fee_paise INTO v_fee FROM bookings WHERE id = NEW.booking_id;
    END IF;
    IF v_fee IS NOT NULL AND NEW.platform_fee_paise <> v_fee THEN
        RAISE EXCEPTION 'An earning''s collection carries the platform fee owed on that collection'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_earning_collection_update() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'An earning''s collections are recorded once and never change'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_earning_collections_insert_guard BEFORE INSERT ON "earning_collections"
    FOR EACH ROW EXECUTE FUNCTION guard_earning_collection_insert();
CREATE TRIGGER trg_earning_collections_immutable BEFORE UPDATE ON "earning_collections"
    FOR EACH ROW EXECUTE FUNCTION guard_earning_collection_update();
CREATE TRIGGER trg_earning_collections_no_delete BEFORE DELETE ON "earning_collections"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_earning_collections_no_truncate BEFORE TRUNCATE ON "earning_collections"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();

-- ---------------------------------------------------------------------------------------------
-- driver_earnings: at most one direct source; an earning with neither is funded by its linked
-- collections (all cash, all online, or MIXED), checked at commit.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "driver_earnings"
    DROP CONSTRAINT "earnings_single_source",
    DROP CONSTRAINT "earnings_cash_from_collection",
    DROP CONSTRAINT "earnings_awaiting_settlement_shape",
    DROP CONSTRAINT "earnings_online_settled_before_payable",
    ADD CONSTRAINT "earnings_single_source" CHECK (payment_id IS NULL OR collection_id IS NULL),
    ADD CONSTRAINT "earnings_cash_from_collection" CHECK (settlement <> 'CASH' OR payment_id IS NULL),
    ADD CONSTRAINT "earnings_mixed_from_collections"
        CHECK (settlement <> 'MIXED' OR (payment_id IS NULL AND collection_id IS NULL)),
    ADD CONSTRAINT "earnings_awaiting_settlement_shape"
        CHECK (status <> 'AWAITING_SETTLEMENT'
               OR (settlement IN ('ONLINE', 'MIXED') AND payment_settlement_id IS NULL AND payable_at IS NULL)),
    ADD CONSTRAINT "earnings_online_settled_before_payable"
        CHECK (settlement NOT IN ('ONLINE', 'MIXED') OR status NOT IN ('PAYABLE', 'IN_PAYOUT', 'PAID')
               OR payment_settlement_id IS NOT NULL);

CREATE OR REPLACE FUNCTION check_earning_sources() RETURNS trigger AS $$
DECLARE
    e RECORD;
    l RECORD;
    v_settlement text;
BEGIN
    SELECT payment_id, collection_id, settlement::text AS settlement, gross_amount_paise, platform_fee_paise
      INTO e
      FROM driver_earnings WHERE id = NEW.id;
    SELECT count(*) AS n,
           coalesce(sum(amount_paise), 0) AS amount,
           coalesce(sum(platform_fee_paise), 0) AS fee,
           count(*) FILTER (WHERE method = 'CASH') AS cash,
           count(*) FILTER (WHERE method = 'ONLINE_QR') AS online,
           count(*) FILTER (WHERE collection_id = e.collection_id) AS direct
      INTO l
      FROM earning_collections WHERE earning_id = NEW.id;
    IF e.payment_id IS NOT NULL THEN
        IF l.n > 0 THEN
            RAISE EXCEPTION 'Earning %: a prepaid earning is funded by its customer payment, not by collections', NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NULL;
    END IF;
    IF e.collection_id IS NOT NULL THEN
        IF l.n > 0 AND (l.n <> 1 OR l.direct <> 1
                        OR l.amount <> e.gross_amount_paise OR l.fee <> e.platform_fee_paise) THEN
            RAISE EXCEPTION 'Earning %: an earning funded by one collection links exactly that collection, for its gross amount and fee', NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NULL;
    END IF;
    IF l.n < 2 THEN
        RAISE EXCEPTION 'Earning % has no payment or collection of its own, so it needs at least two linked collections', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;
    IF l.amount <> e.gross_amount_paise OR l.fee <> e.platform_fee_paise THEN
        RAISE EXCEPTION 'Earning %: its collections add up to % paise and % paise of fees, not its gross amount and fee', NEW.id, l.amount, l.fee
            USING ERRCODE = 'check_violation';
    END IF;
    v_settlement := CASE WHEN l.online = 0 THEN 'CASH' WHEN l.cash = 0 THEN 'ONLINE' ELSE 'MIXED' END;
    IF e.settlement <> v_settlement THEN
        RAISE EXCEPTION 'Earning %: its settlement follows its collections (all cash, all online, or mixed)', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_earnings_sources AFTER INSERT ON "driver_earnings"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION check_earning_sources();

COMMENT ON TABLE "earning_collections" IS 'The collections that fund a driver earning (payment flow Phase 4): one row per collection, with its method, amount and platform fee share. A collection funds at most one earning. Written with the earning; never changed or deleted.';
COMMENT ON COLUMN "earning_collections"."platform_fee_paise" IS 'The platform fee on this collection: the fee debited from the wallet for cash, or the fee share owed on an online collection (the drop''s share, or the booking''s fee).';
COMMENT ON COLUMN "driver_earnings"."collection_id" IS 'The one collection that funds this earning. NULL for a prepaid earning (payment_id) and for an earning funded by several collections (earning_collections).';
