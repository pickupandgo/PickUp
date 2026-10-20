-- Earnings funded by several collections, made payable collection by collection, and failed
-- payouts held for an admin (payment flow Phase 5; docs/PAYMENT_FLOW_FINAL_REVIEW.md C.4, N10).
--
--   The split. Every earning records what was collected in cash and online, the platform fee on
--   each, and its payout amount: what Nikhil Enterprises owes the driver through a payout. CASH
--   pays out 0 (the driver kept the cash), ONLINE its net, MIXED the online part net of its fee
--   (the cash part is already in the driver's hand). Existing earnings are filled from their own
--   source; no existing value changes. The split never changes and, for a new earning, is checked
--   against its collections at commit.
--
--   Settlement per collection. An earning funded by several collections becomes PAYABLE only once
--   every online collection funding it has its merchant settlement (checked at commit). An earning
--   with a single source keeps its one settlement link, as before.
--
--   Payout amount. A payout item carries exactly the payout amount of a PAYABLE online or mixed
--   earning of the payout's driver.
--
--   Failed payouts (N10). A failed payout puts its earnings ON_HOLD for an admin; an earning in a
--   payout can no longer go back to PAYABLE on its own.
--
--   Settlement findings. Settled payments the backend could not match to one of its payments (an
--   unknown payment, or a different amount) are recorded for review instead of only being logged.
--
-- Rollback: down.sql in this folder (manual; Prisma ignores it).

-- ---------------------------------------------------------------------------------------------
-- driver_earnings: the cash / online split and the payout amount.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "driver_earnings"
    ADD COLUMN "cash_collected_paise" BIGINT,
    ADD COLUMN "online_collected_paise" BIGINT,
    ADD COLUMN "cash_fee_paise" BIGINT,
    ADD COLUMN "online_fee_paise" BIGINT,
    ADD COLUMN "payout_amount_paise" BIGINT;

-- Existing earnings, from their linked collections (recorded since 20261018120100) or from their
-- single source: a CASH earning was all cash, an ONLINE one all online. Only the new columns are
-- written; the earnings guard keeps every other value as it is.
UPDATE "driver_earnings" e
   SET cash_collected_paise = s.cash,
       online_collected_paise = s.online,
       cash_fee_paise = s.cash_fee,
       online_fee_paise = s.online_fee,
       payout_amount_paise = CASE e.settlement
           WHEN 'CASH' THEN 0
           WHEN 'ONLINE' THEN e.net_amount_paise
           ELSE s.online - s.online_fee
       END
  FROM (
        SELECT e2.id,
               CASE WHEN l.n > 0 THEN l.cash
                    WHEN e2.settlement = 'CASH' THEN e2.gross_amount_paise ELSE 0 END AS cash,
               CASE WHEN l.n > 0 THEN l.online
                    WHEN e2.settlement = 'CASH' THEN 0 ELSE e2.gross_amount_paise END AS online,
               CASE WHEN l.n > 0 THEN l.cash_fee
                    WHEN e2.settlement = 'CASH' THEN e2.platform_fee_paise ELSE 0 END AS cash_fee,
               CASE WHEN l.n > 0 THEN l.online_fee
                    WHEN e2.settlement = 'CASH' THEN 0 ELSE e2.platform_fee_paise END AS online_fee
          FROM driver_earnings e2
          CROSS JOIN LATERAL (
                SELECT count(*) AS n,
                       coalesce(sum(amount_paise) FILTER (WHERE method = 'CASH'), 0) AS cash,
                       coalesce(sum(amount_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online,
                       coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'CASH'), 0) AS cash_fee,
                       coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online_fee
                  FROM earning_collections
                 WHERE earning_id = e2.id
          ) l
       ) s
 WHERE s.id = e.id;

-- Every existing earning must add up before the rules below are added.
DO $$
DECLARE
    v_bad bigint;
BEGIN
    SELECT count(*) INTO v_bad
      FROM driver_earnings
     WHERE cash_collected_paise IS NULL OR online_collected_paise IS NULL
        OR cash_fee_paise IS NULL OR online_fee_paise IS NULL OR payout_amount_paise IS NULL
        OR cash_collected_paise + online_collected_paise <> gross_amount_paise
        OR cash_fee_paise + online_fee_paise <> platform_fee_paise
        OR cash_fee_paise > cash_collected_paise
        OR online_fee_paise > online_collected_paise
        OR payout_amount_paise < 0;
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'Refusing to migrate: % existing earnings do not add up to their own amounts', v_bad;
    END IF;
END;
$$;

ALTER TABLE "driver_earnings"
    ALTER COLUMN "cash_collected_paise" SET NOT NULL,
    ALTER COLUMN "online_collected_paise" SET NOT NULL,
    ALTER COLUMN "cash_fee_paise" SET NOT NULL,
    ALTER COLUMN "online_fee_paise" SET NOT NULL,
    ALTER COLUMN "payout_amount_paise" SET NOT NULL,
    ADD CONSTRAINT "earnings_split_nonnegative"
        CHECK (cash_collected_paise >= 0 AND online_collected_paise >= 0
               AND cash_fee_paise >= 0 AND online_fee_paise >= 0 AND payout_amount_paise >= 0),
    ADD CONSTRAINT "earnings_split_adds_up"
        CHECK (cash_collected_paise + online_collected_paise = gross_amount_paise
               AND cash_fee_paise + online_fee_paise = platform_fee_paise
               AND cash_fee_paise <= cash_collected_paise
               AND online_fee_paise <= online_collected_paise),
    -- CASH pays out nothing; ONLINE pays out its net; MIXED pays out its online part net of the
    -- online fee. No deduction rule exists for a mixed earning (D-57), so it has none.
    ADD CONSTRAINT "earnings_split_follows_settlement"
        CHECK ((settlement = 'CASH' AND online_collected_paise = 0 AND online_fee_paise = 0
                AND payout_amount_paise = 0)
            OR (settlement = 'ONLINE' AND cash_collected_paise = 0 AND cash_fee_paise = 0
                AND payout_amount_paise = net_amount_paise)
            OR (settlement = 'MIXED' AND cash_collected_paise > 0 AND online_collected_paise > 0
                AND other_deductions_paise = 0 AND tds_amount_paise = 0
                AND payout_amount_paise = online_collected_paise - online_fee_paise)),
    -- An earning funded by several collections has a settlement per online collection, never one
    -- link of its own.
    ADD CONSTRAINT "earnings_settlement_link_single_source"
        CHECK (payment_settlement_id IS NULL OR payment_id IS NOT NULL OR collection_id IS NOT NULL),
    DROP CONSTRAINT "earnings_online_settled_before_payable",
    -- A single-source earning needs its settlement link; one funded by several collections is
    -- checked at commit instead (every online collection settled, trg_earnings_settled).
    ADD CONSTRAINT "earnings_online_settled_before_payable"
        CHECK (settlement NOT IN ('ONLINE', 'MIXED') OR status NOT IN ('PAYABLE', 'IN_PAYOUT', 'PAID')
               OR payment_settlement_id IS NOT NULL
               OR (payment_id IS NULL AND collection_id IS NULL));

-- Amounts, the split, deductions and sources are immutable. The settlement link and payable_at
-- are each set once; the status moves along the documented lifecycle; payout items keep the
-- payout states in step, so a paid earning can never become payable again. An earning in a
-- payout leaves it PAID, or ON_HOLD when the payout fails or is returned (N10): never straight
-- back to PAYABLE.
CREATE OR REPLACE FUNCTION guard_earning_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.settlement IN ('ONLINE', 'MIXED')
           AND NEW.status NOT IN ('AWAITING_SETTLEMENT', 'PAYABLE', 'ON_HOLD') THEN
            RAISE EXCEPTION 'An online or mixed earning starts AWAITING_SETTLEMENT, PAYABLE or ON_HOLD'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSE
        IF NEW.id <> OLD.id
           OR NEW.booking_id <> OLD.booking_id
           OR NEW.trip_id <> OLD.trip_id
           OR NEW.driver_id <> OLD.driver_id
           OR NEW.settlement <> OLD.settlement
           OR NEW.gross_amount_paise <> OLD.gross_amount_paise
           OR NEW.platform_fee_paise <> OLD.platform_fee_paise
           OR NEW.other_deductions_paise <> OLD.other_deductions_paise
           OR NEW.tds_amount_paise <> OLD.tds_amount_paise
           OR NEW.net_amount_paise <> OLD.net_amount_paise
           OR NEW.cash_collected_paise <> OLD.cash_collected_paise
           OR NEW.online_collected_paise <> OLD.online_collected_paise
           OR NEW.cash_fee_paise <> OLD.cash_fee_paise
           OR NEW.online_fee_paise <> OLD.online_fee_paise
           OR NEW.payout_amount_paise <> OLD.payout_amount_paise
           OR NEW.tds_policy <> OLD.tds_policy
           OR NEW.tax_rule_id IS DISTINCT FROM OLD.tax_rule_id
           OR NEW.fee_rule_id <> OLD.fee_rule_id
           OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
           OR NEW.collection_id IS DISTINCT FROM OLD.collection_id
           OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'Earning amounts, deductions and sources are immutable'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF OLD.payment_settlement_id IS NOT NULL
           AND NEW.payment_settlement_id IS DISTINCT FROM OLD.payment_settlement_id THEN
            RAISE EXCEPTION 'An earning''s merchant settlement is recorded once'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF OLD.payable_at IS NOT NULL AND NEW.payable_at IS DISTINCT FROM OLD.payable_at THEN
            RAISE EXCEPTION 'payable_at is set once'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF OLD.payable_at IS NULL AND NEW.payable_at IS NOT NULL AND NEW.status <> 'PAYABLE' THEN
            RAISE EXCEPTION 'payable_at is set when the earning becomes PAYABLE'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    -- The settlement must be the merchant settlement of this earning's own customer payment.
    IF NEW.payment_settlement_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.payment_settlement_id IS NULL)
       AND NOT EXISTS (
            SELECT 1 FROM payment_settlements s
            WHERE s.id = NEW.payment_settlement_id
              AND s.booking_id = NEW.booking_id
              AND s.payment_id IS NOT DISTINCT FROM NEW.payment_id
              AND s.collection_id IS NOT DISTINCT FROM NEW.collection_id
       ) THEN
        RAISE EXCEPTION 'The merchant settlement does not belong to this earning''s customer payment'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF TG_OP = 'INSERT' OR NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF NOT (
           (OLD.status = 'AWAITING_SETTLEMENT' AND NEW.status IN ('PAYABLE', 'ON_HOLD'))
        OR (OLD.status = 'PAYABLE' AND NEW.status IN ('ON_HOLD', 'IN_PAYOUT'))
        OR (OLD.status = 'ON_HOLD' AND NEW.status IN ('PAYABLE', 'AWAITING_SETTLEMENT'))
        OR (OLD.status = 'IN_PAYOUT' AND NEW.status IN ('PAID', 'ON_HOLD'))
        OR (OLD.status = 'PAID' AND NEW.status = 'ON_HOLD')
    ) THEN
        RAISE EXCEPTION 'Invalid earning transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'IN_PAYOUT' AND NOT EXISTS (
        SELECT 1 FROM payout_items i WHERE i.earning_id = NEW.id AND i.status = 'INCLUDED'
    ) THEN
        RAISE EXCEPTION 'An earning moves to IN_PAYOUT only with an included payout item'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'PAID' AND NOT EXISTS (
        SELECT 1 FROM payout_items i WHERE i.earning_id = NEW.id AND i.status = 'PAID'
    ) THEN
        RAISE EXCEPTION 'An earning is PAID only through a paid payout item'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IN ('AWAITING_SETTLEMENT', 'PAYABLE', 'ON_HOLD') AND EXISTS (
        SELECT 1 FROM payout_items i WHERE i.earning_id = NEW.id AND i.status IN ('INCLUDED', 'PAID')
    ) THEN
        RAISE EXCEPTION 'Earning % is still carried by a payout', NEW.id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- At commit: an earning matches its sources. A prepaid earning is all online; one funded by one
-- collection links exactly that collection, and its split follows the collection's method; one
-- funded by several collections adds up to them, by method, and its settlement follows them.
CREATE OR REPLACE FUNCTION check_earning_sources() RETURNS trigger AS $$
DECLARE
    e RECORD;
    l RECORD;
    v_method text;
    v_settlement text;
BEGIN
    SELECT payment_id, collection_id, settlement::text AS settlement, gross_amount_paise,
           platform_fee_paise, cash_collected_paise, online_collected_paise, cash_fee_paise,
           online_fee_paise
      INTO e
      FROM driver_earnings WHERE id = NEW.id;
    SELECT count(*) AS n,
           coalesce(sum(amount_paise), 0) AS amount,
           coalesce(sum(platform_fee_paise), 0) AS fee,
           count(*) FILTER (WHERE method = 'CASH') AS cash,
           count(*) FILTER (WHERE method = 'ONLINE_QR') AS online,
           coalesce(sum(amount_paise) FILTER (WHERE method = 'CASH'), 0) AS cash_amount,
           coalesce(sum(amount_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online_amount,
           coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'CASH'), 0) AS cash_fee,
           coalesce(sum(platform_fee_paise) FILTER (WHERE method = 'ONLINE_QR'), 0) AS online_fee,
           count(*) FILTER (WHERE collection_id = e.collection_id) AS direct
      INTO l
      FROM earning_collections WHERE earning_id = NEW.id;
    IF e.payment_id IS NOT NULL THEN
        IF l.n > 0 THEN
            RAISE EXCEPTION 'Earning %: a prepaid earning is funded by its customer payment, not by collections', NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
        IF e.cash_collected_paise <> 0 OR e.online_collected_paise <> e.gross_amount_paise THEN
            RAISE EXCEPTION 'Earning %: a prepaid earning is collected online in full', NEW.id
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
        SELECT method INTO v_method FROM payment_collections WHERE id = e.collection_id;
        IF (v_method = 'CASH' AND e.cash_collected_paise <> e.gross_amount_paise)
           OR (v_method <> 'CASH' AND e.online_collected_paise <> e.gross_amount_paise) THEN
            RAISE EXCEPTION 'Earning %: its cash and online amounts follow its collection (%)', NEW.id, v_method
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
    IF l.cash_amount <> e.cash_collected_paise OR l.online_amount <> e.online_collected_paise
       OR l.cash_fee <> e.cash_fee_paise OR l.online_fee <> e.online_fee_paise THEN
        RAISE EXCEPTION 'Earning %: its cash and online amounts and fees are not those of its collections', NEW.id
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

-- At commit: an earning funded by several collections is PAYABLE (or in a payout, or paid) only
-- once every online collection funding it has its merchant settlement. One online collection
-- settling never makes it payable while another is still unsettled.
CREATE OR REPLACE FUNCTION check_earning_settled() RETURNS trigger AS $$
DECLARE
    e RECORD;
    v_unsettled bigint;
BEGIN
    SELECT status::text AS status, settlement::text AS settlement, payment_id, collection_id
      INTO e
      FROM driver_earnings WHERE id = NEW.id;
    IF e.status NOT IN ('PAYABLE', 'IN_PAYOUT', 'PAID') OR e.settlement = 'CASH'
       OR e.payment_id IS NOT NULL OR e.collection_id IS NOT NULL THEN
        RETURN NULL;
    END IF;
    SELECT count(*) INTO v_unsettled
      FROM earning_collections l
     WHERE l.earning_id = NEW.id
       AND l.method = 'ONLINE_QR'
       AND NOT EXISTS (SELECT 1 FROM payment_settlements s WHERE s.collection_id = l.collection_id);
    IF v_unsettled > 0 THEN
        RAISE EXCEPTION 'Earning % is %, but % of its online collections have no merchant settlement yet', NEW.id, e.status, v_unsettled
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_earnings_settled AFTER INSERT OR UPDATE OF status ON "driver_earnings"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW.status IN ('PAYABLE', 'IN_PAYOUT', 'PAID'))
    EXECUTE FUNCTION check_earning_settled();

-- ---------------------------------------------------------------------------------------------
-- earning_collections: what each collection contributes to its earning (amount minus its fee).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "earning_collections" ADD COLUMN "net_amount_paise" BIGINT;
-- Links are immutable; only this new column is filled for the links that already exist.
ALTER TABLE "earning_collections" DISABLE TRIGGER "trg_earning_collections_immutable";
UPDATE "earning_collections" SET net_amount_paise = amount_paise - platform_fee_paise;
ALTER TABLE "earning_collections" ENABLE TRIGGER "trg_earning_collections_immutable";
ALTER TABLE "earning_collections"
    ALTER COLUMN "net_amount_paise" SET NOT NULL,
    ADD CONSTRAINT "earning_collections_net_is_amount_minus_fee"
        CHECK (net_amount_paise = amount_paise - platform_fee_paise);

-- ---------------------------------------------------------------------------------------------
-- payout_items: exactly the earning's payout amount, of a PAYABLE online or mixed earning.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_payout_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'INCLUDED' THEN
            RAISE EXCEPTION 'A payout item starts INCLUDED' USING ERRCODE = 'restrict_violation';
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM driver_earnings e
            JOIN driver_payouts p ON p.id = NEW.payout_id
            WHERE e.id = NEW.earning_id
              AND e.settlement IN ('ONLINE', 'MIXED')
              AND e.status = 'PAYABLE'
              AND e.driver_id = p.driver_id
              AND e.payout_amount_paise = NEW.amount_paise
        ) THEN
            RAISE EXCEPTION 'Payout item must carry the payout amount of one of the driver''s payable online or mixed earnings'
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.id <> OLD.id OR NEW.payout_id <> OLD.payout_id OR NEW.earning_id <> OLD.earning_id
       OR NEW.amount_paise <> OLD.amount_paise OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Payout items are immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
           (OLD.status = 'INCLUDED' AND NEW.status IN ('PAID', 'RELEASED', 'REVERSED'))
        OR (OLD.status = 'PAID' AND NEW.status = 'REVERSED')
    ) THEN
        RAISE EXCEPTION 'Invalid payout item transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- settlement_findings: settled payments that could not be matched, kept for review.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "settlement_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(40) NOT NULL DEFAULT 'RAZORPAY',
    "kind" VARCHAR(30) NOT NULL,
    "provider_payment_id" VARCHAR(100) NOT NULL,
    "provider_settlement_id" VARCHAR(100) NOT NULL,
    "settled_at" TIMESTAMPTZ(6) NOT NULL,
    "settled_amount_paise" BIGINT NOT NULL,
    "expected_amount_paise" BIGINT,
    "booking_id" UUID,
    "payment_id" UUID,
    "collection_id" UUID,
    "source" VARCHAR(20) NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "settlement_findings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_settlement_findings_item"
    ON "settlement_findings"("provider", "provider_payment_id", "provider_settlement_id", "kind");
CREATE INDEX "idx_settlement_findings_last_seen" ON "settlement_findings"("last_seen_at");
ALTER TABLE "settlement_findings" ADD CONSTRAINT "settlement_findings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_findings" ADD CONSTRAINT "settlement_findings_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_findings" ADD CONSTRAINT "settlement_findings_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "payment_collections"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "settlement_findings"
    ADD CONSTRAINT "settlement_findings_kind_valid" CHECK (kind IN ('UNKNOWN_PAYMENT', 'AMOUNT_MISMATCH')),
    ADD CONSTRAINT "settlement_findings_payment_id_format"
        CHECK (provider_payment_id ~ '^pay_[A-Za-z0-9]{6,40}$'),
    ADD CONSTRAINT "settlement_findings_settlement_id_format"
        CHECK (provider_settlement_id ~ '^setl_[A-Za-z0-9]{6,40}$'),
    ADD CONSTRAINT "settlement_findings_source_valid" CHECK (source IN ('RAZORPAY_RECON', 'SIMULATED')),
    ADD CONSTRAINT "settlement_findings_amount_positive" CHECK (settled_amount_paise > 0),
    -- An unknown payment matches nothing of ours; a mismatch names our payment or collection, and
    -- the amount we expected.
    ADD CONSTRAINT "settlement_findings_shape"
        CHECK ((kind = 'UNKNOWN_PAYMENT' AND expected_amount_paise IS NULL AND booking_id IS NULL
                AND payment_id IS NULL AND collection_id IS NULL)
            OR (kind = 'AMOUNT_MISMATCH' AND expected_amount_paise IS NOT NULL
                AND expected_amount_paise <> settled_amount_paise AND booking_id IS NOT NULL
                AND ((payment_id IS NULL) <> (collection_id IS NULL)))),
    ADD CONSTRAINT "settlement_findings_seen"
        CHECK (occurrences >= 1 AND last_seen_at >= first_seen_at);

-- A finding is recorded once; seeing it again only counts it. Nothing else ever changes.
CREATE OR REPLACE FUNCTION guard_settlement_finding_update() RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.provider <> OLD.provider
       OR NEW.kind <> OLD.kind
       OR NEW.provider_payment_id <> OLD.provider_payment_id
       OR NEW.provider_settlement_id <> OLD.provider_settlement_id
       OR NEW.settled_at <> OLD.settled_at
       OR NEW.settled_amount_paise <> OLD.settled_amount_paise
       OR NEW.expected_amount_paise IS DISTINCT FROM OLD.expected_amount_paise
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
       OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
       OR NEW.collection_id IS DISTINCT FROM OLD.collection_id
       OR NEW.source <> OLD.source
       OR NEW.first_seen_at <> OLD.first_seen_at
       OR NEW.occurrences < OLD.occurrences
       OR NEW.last_seen_at < OLD.last_seen_at THEN
        RAISE EXCEPTION 'A settlement finding is recorded once; seeing it again only counts it'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_settlement_findings_guard BEFORE UPDATE ON "settlement_findings"
    FOR EACH ROW EXECUTE FUNCTION guard_settlement_finding_update();
CREATE TRIGGER trg_settlement_findings_no_delete BEFORE DELETE ON "settlement_findings"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_settlement_findings_no_truncate BEFORE TRUNCATE ON "settlement_findings"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();

-- ---------------------------------------------------------------------------------------------
-- Documentation for anyone reading the database directly.
-- ---------------------------------------------------------------------------------------------
COMMENT ON COLUMN "driver_earnings"."cash_collected_paise" IS 'Collected in cash for this trip: already in the driver''s hand.';
COMMENT ON COLUMN "driver_earnings"."online_collected_paise" IS 'Collected online for this trip (prepaid or QR): received by Nikhil Enterprises.';
COMMENT ON COLUMN "driver_earnings"."cash_fee_paise" IS 'Platform fee on the cash part, debited from the driver wallet when the cash was recorded.';
COMMENT ON COLUMN "driver_earnings"."online_fee_paise" IS 'Platform fee on the online part, kept from the payout.';
COMMENT ON COLUMN "driver_earnings"."payout_amount_paise" IS 'What a payout carries for this earning: 0 for CASH, the net for ONLINE, the online part net of its fee for MIXED. Payable only once every online collection is settled.';
COMMENT ON COLUMN "earning_collections"."net_amount_paise" IS 'What this collection contributes to the earning: its amount minus its platform fee.';
COMMENT ON TABLE "settlement_findings" IS 'Settled payments from Razorpay settlement reconciliation that matched none of our payments, or matched one with a different amount. Never applied to an earning; listed for review. Recorded once per payment, settlement and kind; seeing it again only counts it.';
