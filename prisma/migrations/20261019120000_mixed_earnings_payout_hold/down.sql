-- Manual rollback of 20261019120000_mixed_earnings_payout_hold. Prisma never runs this file.
--
-- It drops no data the previous rules can't rebuild: the earning split and each link's net
-- amount are derived from the earning and its collections. It refuses once an earning funded by
-- several collections has been made payable or carried by a payout, or a settlement finding has
-- been recorded: the previous rules can't explain those. It restores the earnings guard
-- (20261007120100), the earning sources check (20261018120100), the payout item guard
-- (20261006120000) and the settled-before-payable CHECK exactly as they were.
--
-- Rolling back puts back the automatic re-queue of a failed payout's earnings, so roll the
-- backend back to the previous release at the same time. Earnings already ON_HOLD after a failed
-- payout stay ON_HOLD until an admin releases them. Then remove the migration's row from
-- _prisma_migrations, so `prisma migrate deploy` can apply it again:
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261019120000_mixed_earnings_payout_hold';
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM driver_earnings
                WHERE payment_id IS NULL AND collection_id IS NULL
                  AND status IN ('PAYABLE', 'IN_PAYOUT', 'PAID')) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261019120000: earnings funded by several collections have been made payable';
    END IF;
    IF EXISTS (SELECT 1 FROM payout_items i JOIN driver_earnings e ON e.id = i.earning_id
                WHERE e.payment_id IS NULL AND e.collection_id IS NULL) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261019120000: payouts carry earnings funded by several collections';
    END IF;
    IF EXISTS (SELECT 1 FROM settlement_findings) THEN
        RAISE EXCEPTION 'Refusing to roll back 20261019120000: settlement findings are recorded';
    END IF;
END;
$$;

DROP TABLE "settlement_findings";
DROP FUNCTION IF EXISTS guard_settlement_finding_update();

DROP TRIGGER IF EXISTS trg_earnings_settled ON "driver_earnings";
DROP FUNCTION IF EXISTS check_earning_settled();

ALTER TABLE "earning_collections"
    DROP CONSTRAINT "earning_collections_net_is_amount_minus_fee",
    DROP COLUMN "net_amount_paise";

ALTER TABLE "driver_earnings"
    DROP CONSTRAINT "earnings_split_nonnegative",
    DROP CONSTRAINT "earnings_split_adds_up",
    DROP CONSTRAINT "earnings_split_follows_settlement",
    DROP CONSTRAINT "earnings_settlement_link_single_source",
    DROP CONSTRAINT "earnings_online_settled_before_payable",
    ADD CONSTRAINT "earnings_online_settled_before_payable"
        CHECK (settlement NOT IN ('ONLINE', 'MIXED') OR status NOT IN ('PAYABLE', 'IN_PAYOUT', 'PAID')
               OR payment_settlement_id IS NOT NULL);

-- The payout item guard of 20261006120000.
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
              AND e.settlement = 'ONLINE'
              AND e.driver_id = p.driver_id
              AND e.net_amount_paise = NEW.amount_paise
        ) THEN
            RAISE EXCEPTION 'Payout item must carry the full net amount of one of the driver''s online earnings'
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

-- The earning sources check of 20261018120100.
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

-- The earnings guard of 20261007120100.
CREATE OR REPLACE FUNCTION guard_earning_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.settlement = 'ONLINE' AND NEW.status NOT IN ('AWAITING_SETTLEMENT', 'PAYABLE', 'ON_HOLD') THEN
            RAISE EXCEPTION 'An online earning starts AWAITING_SETTLEMENT, PAYABLE or ON_HOLD'
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
        OR (OLD.status = 'IN_PAYOUT' AND NEW.status IN ('PAID', 'PAYABLE', 'ON_HOLD'))
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

ALTER TABLE "driver_earnings"
    DROP COLUMN "cash_collected_paise",
    DROP COLUMN "online_collected_paise",
    DROP COLUMN "cash_fee_paise",
    DROP COLUMN "online_fee_paise",
    DROP COLUMN "payout_amount_paise";
COMMIT;
