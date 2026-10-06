-- Approved V1 money decisions, second set (docs/OPEN_DECISIONS.md D-44, D-45, D-48, D-49, D-57):
--   * platform fees always round HALF_UP to whole paise;
--   * an ONLINE earning becomes PAYABLE only after Razorpay confirms the merchant settlement of
--     its customer payment (payment_settlements), never at capture or trip completion;
--   * bank accounts are validated with the bank (bank_account_verifications) and approved by an
--     admin; DISABLED is renamed SUSPENDED;
--   * TDS-ready amounts on earnings and payouts (other deductions, TDS, policy snapshot), with
--     the policy DISABLED and no tax rule until a CA confirms the rule.
--
-- Hand-written: Prisma would rebuild the bank_account_status type instead of renaming a value,
-- and cannot express CHECK constraints, triggers or the data corrections below.

-- ============================================================================
-- Preconditions: stop with a clear message instead of silently reinterpreting money records.
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM fee_rules WHERE rounding_mode <> 'HALF_UP') THEN
        RAISE EXCEPTION 'fee_rules contains rules that do not round HALF_UP. Review them before applying this migration (OPEN_DECISIONS D-44).';
    END IF;
    IF EXISTS (
        SELECT 1 FROM driver_earnings
        WHERE settlement = 'ONLINE' AND status IN ('IN_PAYOUT', 'PAID')
    ) THEN
        RAISE EXCEPTION 'Online earnings were paid out before merchant settlement tracking existed. Reconcile them with Razorpay settlements before applying this migration (OPEN_DECISIONS D-45).';
    END IF;
END;
$$;

-- ============================================================================
-- fee_rules: HALF_UP only
-- ============================================================================
ALTER TABLE "fee_rules" ALTER COLUMN "rounding_mode" SET DEFAULT 'HALF_UP';
ALTER TABLE "fee_rules"
    DROP CONSTRAINT "fee_rules_rounding_mode_valid",
    ADD CONSTRAINT "fee_rules_rounding_mode_half_up" CHECK (rounding_mode = 'HALF_UP');

-- ============================================================================
-- drivers: KYC legal name (written by ops tooling only; the API role has no UPDATE on drivers)
-- ============================================================================
ALTER TABLE "drivers" ADD COLUMN "legal_name" VARCHAR(120);
ALTER TABLE "drivers"
    ADD CONSTRAINT "drivers_legal_name_valid"
        CHECK (legal_name IS NULL OR length(btrim(legal_name)) >= 3);

-- ============================================================================
-- tax_rules: versioned, empty until a CA-approved rule exists
-- ============================================================================
CREATE TABLE "tax_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL,
    "applies_to" VARCHAR(20) NOT NULL,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "approval_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_tax_rules_code_version" ON "tax_rules"("code", "version");

ALTER TABLE "tax_rules"
    ADD CONSTRAINT "tax_rules_code_format" CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
    ADD CONSTRAINT "tax_rules_version_positive" CHECK (version > 0),
    ADD CONSTRAINT "tax_rules_applies_to_valid" CHECK (applies_to IN ('EARNING', 'PAYOUT')),
    ADD CONSTRAINT "tax_rules_rate_valid" CHECK (rate_percent >= 0 AND rate_percent < 100),
    ADD CONSTRAINT "tax_rules_window_valid" CHECK (effective_to IS NULL OR effective_to > effective_from),
    ADD CONSTRAINT "tax_rules_approval_not_blank" CHECK (length(btrim(approval_reference)) > 0);

-- A version is never edited; it can only be closed once.
CREATE OR REPLACE FUNCTION guard_tax_rule_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.code <> OLD.code
       OR NEW.version <> OLD.version
       OR NEW.applies_to <> OLD.applies_to
       OR NEW.rate_percent <> OLD.rate_percent
       OR NEW.effective_from <> OLD.effective_from
       OR NEW.approval_reference <> OLD.approval_reference
       OR NEW.created_at <> OLD.created_at
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to) THEN
        RAISE EXCEPTION 'Tax rules are versioned, never edited; add a new version instead'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tax_rules_versioned
BEFORE UPDATE ON "tax_rules"
FOR EACH ROW
EXECUTE FUNCTION guard_tax_rule_update();

CREATE TRIGGER trg_tax_rules_no_delete
BEFORE DELETE ON "tax_rules"
FOR EACH ROW
EXECUTE FUNCTION prevent_financial_record_delete();

CREATE TRIGGER trg_tax_rules_no_truncate
BEFORE TRUNCATE ON "tax_rules"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_financial_record_delete();

-- ============================================================================
-- payment_settlements: merchant settlement of one customer payment (immutable)
-- ============================================================================
CREATE TABLE "payment_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(40) NOT NULL DEFAULT 'RAZORPAY',
    "provider_payment_id" VARCHAR(100) NOT NULL,
    "provider_settlement_id" VARCHAR(100) NOT NULL,
    "settlement_utr" VARCHAR(100),
    "settled_at" TIMESTAMPTZ(6) NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "fee_paise" BIGINT NOT NULL DEFAULT 0,
    "tax_paise" BIGINT NOT NULL DEFAULT 0,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID,
    "collection_id" UUID,
    "source" VARCHAR(20) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "payment_settlements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_settlements_payment" ON "payment_settlements"("payment_id");
CREATE UNIQUE INDEX "uq_settlements_collection" ON "payment_settlements"("collection_id");
CREATE INDEX "idx_settlements_booking" ON "payment_settlements"("booking_id");
CREATE INDEX "idx_settlements_provider_settlement" ON "payment_settlements"("provider_settlement_id");
CREATE INDEX "idx_settlements_settled_at" ON "payment_settlements"("settled_at");
CREATE UNIQUE INDEX "uq_settlements_provider_payment" ON "payment_settlements"("provider", "provider_payment_id");

ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "payment_collections"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "payment_settlements"
    ADD CONSTRAINT "settlements_single_source" CHECK ((payment_id IS NULL) <> (collection_id IS NULL)),
    ADD CONSTRAINT "settlements_source_valid" CHECK (source IN ('RAZORPAY_RECON', 'SIMULATED')),
    ADD CONSTRAINT "settlements_amount_positive" CHECK (amount_paise > 0),
    ADD CONSTRAINT "settlements_fee_tax_nonnegative" CHECK (fee_paise >= 0 AND tax_paise >= 0),
    ADD CONSTRAINT "settlements_payment_id_format" CHECK (provider_payment_id ~ '^pay_[A-Za-z0-9]{6,40}$'),
    ADD CONSTRAINT "settlements_settlement_id_format" CHECK (provider_settlement_id ~ '^setl_[A-Za-z0-9]{6,40}$'),
    ADD CONSTRAINT "settlements_details_object" CHECK (jsonb_typeof(details) = 'object');

-- A settlement must describe exactly the customer payment it is linked to: same provider payment
-- id, same amount, same booking. A mismatch is never recorded (the sync reports it instead).
CREATE OR REPLACE FUNCTION guard_payment_settlement_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.payment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.id = NEW.payment_id
          AND p.purpose = 'BOOKING'
          AND p.booking_id = NEW.booking_id
          AND p.razorpay_payment_id = NEW.provider_payment_id
          AND p.amount_paise = NEW.amount_paise
    ) THEN
        RAISE EXCEPTION 'Settlement does not match its booking payment (payment id, amount or booking)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.collection_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM payment_collections c
        WHERE c.id = NEW.collection_id
          AND c.method = 'ONLINE_QR'
          AND c.booking_id = NEW.booking_id
          AND c.provider_payment_id = NEW.provider_payment_id
          AND c.amount_paise = NEW.amount_paise
    ) THEN
        RAISE EXCEPTION 'Settlement does not match its online collection (payment id, amount or booking)'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlements_match_source
BEFORE INSERT ON "payment_settlements"
FOR EACH ROW
EXECUTE FUNCTION guard_payment_settlement_insert();

CREATE OR REPLACE FUNCTION prevent_settlement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'payment_settlements is append-only'
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_settlements_immutable
BEFORE UPDATE OR DELETE ON "payment_settlements"
FOR EACH ROW
EXECUTE FUNCTION prevent_settlement_mutation();

CREATE TRIGGER trg_settlements_no_truncate
BEFORE TRUNCATE ON "payment_settlements"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_settlement_mutation();

-- ============================================================================
-- driver_earnings: settlement gating and TDS-ready amounts
-- ============================================================================
ALTER TABLE "driver_earnings"
    ADD COLUMN "other_deductions_paise" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "payment_settlement_id" UUID,
    ADD COLUMN "tax_rule_id" UUID,
    ADD COLUMN "tds_amount_paise" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "tds_policy" VARCHAR(20) NOT NULL DEFAULT 'DISABLED';
CREATE UNIQUE INDEX "uq_earnings_payment_settlement" ON "driver_earnings"("payment_settlement_id");
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_tax_rule_id_fkey" FOREIGN KEY ("tax_rule_id") REFERENCES "tax_rules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_payment_settlement_id_fkey" FOREIGN KEY ("payment_settlement_id") REFERENCES "payment_settlements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Existing ONLINE earnings were made payable at trip completion. Payouts now wait for the
-- merchant settlement, so they go back to waiting for it, each with an audit entry. (The trigger
-- would refuse this one-off correction, so it is disabled for this statement only.)
ALTER TABLE "driver_earnings" DISABLE TRIGGER "trg_earnings_guard";
WITH gated AS (
    UPDATE "driver_earnings"
    SET status = CASE WHEN status = 'PAYABLE' THEN 'AWAITING_SETTLEMENT'::earning_status ELSE status END,
        payable_at = NULL,
        updated_at = now()
    WHERE settlement = 'ONLINE'
      AND status IN ('PAYABLE', 'ON_HOLD')
      AND payment_settlement_id IS NULL
    RETURNING id, status
)
INSERT INTO "admin_actions" (actor_user_id, action, target_type, target_id, reason, details)
SELECT NULL, 'EARNING_SETTLEMENT_GATED', 'DRIVER_EARNING', gated.id::text,
       'Migration 20261007120100: online earnings wait for the merchant settlement (OPEN_DECISIONS D-45)',
       jsonb_build_object('status', gated.status::text)
FROM gated;
ALTER TABLE "driver_earnings" ENABLE TRIGGER "trg_earnings_guard";

ALTER TABLE "driver_earnings"
    DROP CONSTRAINT "earnings_net_is_gross_minus_fee",
    DROP CONSTRAINT "earnings_online_has_payable_at",
    ADD CONSTRAINT "earnings_deductions_nonnegative"
        CHECK (other_deductions_paise >= 0 AND tds_amount_paise >= 0 AND net_amount_paise >= 0),
    ADD CONSTRAINT "earnings_net_is_gross_minus_deductions"
        CHECK (net_amount_paise = gross_amount_paise - platform_fee_paise - other_deductions_paise - tds_amount_paise),
    -- TDS is never applied without a versioned, CA-approved tax rule.
    ADD CONSTRAINT "earnings_tds_policy_valid" CHECK (
        (tds_policy = 'DISABLED' AND tds_amount_paise = 0 AND tax_rule_id IS NULL)
        OR (tds_policy = 'TAX_RULE' AND tax_rule_id IS NOT NULL)),
    ADD CONSTRAINT "earnings_payable_has_payable_at"
        CHECK (status NOT IN ('PAYABLE', 'IN_PAYOUT', 'PAID') OR payable_at IS NOT NULL),
    -- No payout is ever built on unsettled merchant funds.
    ADD CONSTRAINT "earnings_online_settled_before_payable"
        CHECK (settlement <> 'ONLINE' OR status NOT IN ('PAYABLE', 'IN_PAYOUT', 'PAID')
               OR payment_settlement_id IS NOT NULL),
    ADD CONSTRAINT "earnings_awaiting_settlement_shape"
        CHECK (status <> 'AWAITING_SETTLEMENT'
               OR (settlement = 'ONLINE' AND payment_settlement_id IS NULL AND payable_at IS NULL)),
    ADD CONSTRAINT "earnings_cash_has_no_settlement_link"
        CHECK (settlement <> 'CASH' OR (payment_settlement_id IS NULL AND payable_at IS NULL));

-- Amounts, deductions and sources are immutable. The settlement link and payable_at are each set
-- once; the status moves along the documented lifecycle; payout items keep the payout states in
-- step, so a paid earning can never become payable again.
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

-- ============================================================================
-- bank_account_verifications: bank validation results (penny drop)
-- ============================================================================
CREATE TABLE "bank_account_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bank_account_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_validation_id" VARCHAR(100) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CREATED',
    "account_status" VARCHAR(20),
    "registered_name" VARCHAR(200),
    "name_match_score" INTEGER,
    "name_match_result" VARCHAR(20),
    "compared_name" VARCHAR(120),
    "utr" VARCHAR(100),
    "failure_reason" VARCHAR(300),
    "requested_by_user_id" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_account_verifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_bank_validations_account_created" ON "bank_account_verifications"("bank_account_id", "created_at" DESC);
CREATE INDEX "idx_bank_validations_status_created" ON "bank_account_verifications"("status", "created_at");
CREATE UNIQUE INDEX "uq_bank_validations_provider_validation" ON "bank_account_verifications"("provider", "provider_validation_id");

ALTER TABLE "bank_account_verifications" ADD CONSTRAINT "bank_account_verifications_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "driver_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "bank_account_verifications" ADD CONSTRAINT "bank_account_verifications_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "bank_account_verifications"
    ADD CONSTRAINT "bank_validations_method_valid" CHECK (method IN ('PENNY_DROP')),
    ADD CONSTRAINT "bank_validations_status_valid" CHECK (status IN ('CREATED', 'COMPLETED', 'FAILED')),
    ADD CONSTRAINT "bank_validations_id_not_blank" CHECK (length(btrim(provider_validation_id)) > 0),
    ADD CONSTRAINT "bank_validations_account_status_valid"
        CHECK (account_status IS NULL OR account_status IN ('ACTIVE', 'INVALID')),
    ADD CONSTRAINT "bank_validations_name_match_valid"
        CHECK (name_match_result IS NULL OR name_match_result IN ('MATCH', 'PARTIAL', 'MISMATCH', 'UNAVAILABLE')),
    ADD CONSTRAINT "bank_validations_score_range"
        CHECK (name_match_score IS NULL OR name_match_score BETWEEN 0 AND 100),
    ADD CONSTRAINT "bank_validations_created_shape"
        CHECK (status <> 'CREATED' OR (completed_at IS NULL AND account_status IS NULL AND name_match_result IS NULL)),
    ADD CONSTRAINT "bank_validations_completed_shape"
        CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND account_status IS NOT NULL
                                         AND name_match_result IS NOT NULL)),
    ADD CONSTRAINT "bank_validations_failed_shape"
        CHECK (status <> 'FAILED' OR (completed_at IS NOT NULL AND failure_reason IS NOT NULL));

-- Who asked and which account it is about never change; a finished result is final.
CREATE OR REPLACE FUNCTION guard_bank_validation_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.bank_account_id <> OLD.bank_account_id
       OR NEW.provider <> OLD.provider
       OR NEW.provider_validation_id <> OLD.provider_validation_id
       OR NEW.method <> OLD.method
       OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Bank validation references are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'CREATED' AND (
           NEW.status <> OLD.status
        OR NEW.account_status IS DISTINCT FROM OLD.account_status
        OR NEW.registered_name IS DISTINCT FROM OLD.registered_name
        OR NEW.name_match_score IS DISTINCT FROM OLD.name_match_score
        OR NEW.name_match_result IS DISTINCT FROM OLD.name_match_result
        OR NEW.compared_name IS DISTINCT FROM OLD.compared_name
        OR NEW.utr IS DISTINCT FROM OLD.utr
        OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason
        OR NEW.completed_at IS DISTINCT FROM OLD.completed_at) THEN
        RAISE EXCEPTION 'A finished bank validation is immutable; start a new one instead'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bank_validations_guard
BEFORE UPDATE ON "bank_account_verifications"
FOR EACH ROW
EXECUTE FUNCTION guard_bank_validation_update();

CREATE TRIGGER trg_bank_validations_no_delete
BEFORE DELETE ON "bank_account_verifications"
FOR EACH ROW
EXECUTE FUNCTION prevent_financial_record_delete();

CREATE TRIGGER trg_bank_validations_no_truncate
BEFORE TRUNCATE ON "bank_account_verifications"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_financial_record_delete();

-- ============================================================================
-- driver_bank_accounts: DISABLED -> SUSPENDED, approval tied to a bank validation
-- ============================================================================
-- RENAME VALUE keeps every row, index and constraint; the enum value keeps its identity.
ALTER TYPE "bank_account_status" RENAME VALUE 'DISABLED' TO 'SUSPENDED';

ALTER TABLE "driver_bank_accounts"
    ADD COLUMN "approved_verification_id" UUID,
    ADD COLUMN "name_match_resolution" VARCHAR(500);
CREATE UNIQUE INDEX "uq_bank_accounts_approved_verification" ON "driver_bank_accounts"("approved_verification_id");
ALTER TABLE "driver_bank_accounts" ADD CONSTRAINT "driver_bank_accounts_approved_verification_id_fkey" FOREIGN KEY ("approved_verification_id") REFERENCES "bank_account_verifications"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The old guard is replaced by one that also covers INSERT (see below).
DROP TRIGGER "trg_bank_accounts_guard" ON "driver_bank_accounts";
DROP FUNCTION guard_bank_account_update();

-- Accounts verified before bank validation existed have no validation evidence: suspend them
-- (payouts stop) until an admin approves them on a fresh validation.
WITH suspended AS (
    UPDATE "driver_bank_accounts"
    SET status = 'SUSPENDED',
        status_reason = 'REVALIDATION_REQUIRED: verified before bank validation was introduced',
        status_changed_by_user_id = NULL,
        updated_at = now()
    WHERE status = 'VERIFIED' AND approved_verification_id IS NULL
    RETURNING id
)
INSERT INTO "admin_actions" (actor_user_id, action, target_type, target_id, reason)
SELECT NULL, 'BANK_ACCOUNT_SUSPENDED', 'DRIVER_BANK_ACCOUNT', suspended.id::text,
       'Migration 20261007120100: REVALIDATION_REQUIRED (OPEN_DECISIONS D-49)'
FROM suspended;

ALTER TABLE "driver_bank_accounts"
    DROP CONSTRAINT "bank_accounts_closed_has_reason",
    ADD CONSTRAINT "bank_accounts_closed_has_reason"
        CHECK (status NOT IN ('REJECTED', 'SUSPENDED')
               OR (status_reason IS NOT NULL AND length(btrim(status_reason)) > 0)),
    ADD CONSTRAINT "bank_accounts_verified_has_validation"
        CHECK (status <> 'VERIFIED' OR approved_verification_id IS NOT NULL),
    ADD CONSTRAINT "bank_accounts_resolution_not_blank"
        CHECK (name_match_resolution IS NULL OR length(btrim(name_match_resolution)) > 0);

-- Accounts start PENDING_VERIFICATION. Approval (into VERIFIED) needs a completed, ACTIVE bank
-- validation of this very account, a recorded resolution when the bank's name was not an exact
-- KYC match, and, when reinstating a SUSPENDED account, a newer validation than the one it was
-- approved on before. REJECTED is final.
CREATE OR REPLACE FUNCTION guard_bank_account_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    validation RECORD;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING_VERIFICATION' OR NEW.approved_verification_id IS NOT NULL
           OR NEW.verified_at IS NOT NULL OR NEW.verified_by_user_id IS NOT NULL THEN
            RAISE EXCEPTION 'A bank account starts PENDING_VERIFICATION and is approved by an admin later'
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.id <> OLD.id
       OR NEW.driver_id <> OLD.driver_id
       OR NEW.account_holder_name <> OLD.account_holder_name
       OR NEW.ifsc <> OLD.ifsc
       OR NEW.account_number_last4 <> OLD.account_number_last4
       OR NEW.provider <> OLD.provider
       OR NEW.provider_contact_id <> OLD.provider_contact_id
       OR NEW.provider_fund_account_id <> OLD.provider_fund_account_id
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Bank account details are immutable; add a new account instead'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status <> OLD.status AND NOT (
           (OLD.status = 'PENDING_VERIFICATION' AND NEW.status IN ('VERIFIED', 'REJECTED', 'SUSPENDED'))
        OR (OLD.status = 'VERIFIED' AND NEW.status = 'SUSPENDED')
        OR (OLD.status = 'SUSPENDED' AND NEW.status = 'VERIFIED')
    ) THEN
        RAISE EXCEPTION 'Invalid bank account transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = 'VERIFIED' AND OLD.status <> 'VERIFIED' THEN
        SELECT v.status, v.account_status, v.name_match_result
        INTO validation
        FROM bank_account_verifications v
        WHERE v.id = NEW.approved_verification_id AND v.bank_account_id = NEW.id;
        IF NOT FOUND OR validation.status <> 'COMPLETED' OR validation.account_status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'An account is approved only on a completed, active bank validation of that account'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF validation.name_match_result <> 'MATCH' AND NEW.name_match_resolution IS NULL THEN
            RAISE EXCEPTION 'A bank name that is not an exact KYC match needs a recorded resolution'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF OLD.status = 'SUSPENDED'
           AND NEW.approved_verification_id IS NOT DISTINCT FROM OLD.approved_verification_id THEN
            RAISE EXCEPTION 'Reinstating a suspended account needs a new bank validation'
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSIF NEW.approved_verification_id IS DISTINCT FROM OLD.approved_verification_id
          OR NEW.name_match_resolution IS DISTINCT FROM OLD.name_match_resolution THEN
        RAISE EXCEPTION 'The approval evidence changes only when an admin approves the account'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bank_accounts_guard
BEFORE INSERT OR UPDATE ON "driver_bank_accounts"
FOR EACH ROW
EXECUTE FUNCTION guard_bank_account_change();

-- ============================================================================
-- driver_payouts: TDS-ready amounts, verified beneficiary
-- ============================================================================
ALTER TABLE "driver_payouts"
    ADD COLUMN "gross_amount_paise" BIGINT,
    ADD COLUMN "other_deductions_paise" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "tax_rule_id" UUID,
    ADD COLUMN "tds_amount_paise" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "tds_policy" VARCHAR(20) NOT NULL DEFAULT 'DISABLED';
-- Every existing payout transferred exactly its items (no deductions existed).
UPDATE "driver_payouts" SET "gross_amount_paise" = "amount_paise";
ALTER TABLE "driver_payouts" ALTER COLUMN "gross_amount_paise" SET NOT NULL;
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_tax_rule_id_fkey" FOREIGN KEY ("tax_rule_id") REFERENCES "tax_rules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "driver_payouts"
    ADD CONSTRAINT "payouts_deductions_nonnegative"
        CHECK (tds_amount_paise >= 0 AND other_deductions_paise >= 0),
    ADD CONSTRAINT "payouts_amount_is_gross_minus_deductions"
        CHECK (amount_paise = gross_amount_paise - tds_amount_paise - other_deductions_paise),
    ADD CONSTRAINT "payouts_tds_policy_valid" CHECK (
        (tds_policy = 'DISABLED' AND tds_amount_paise = 0 AND tax_rule_id IS NULL)
        OR (tds_policy = 'TAX_RULE' AND tax_rule_id IS NOT NULL));

DROP TRIGGER "trg_payouts_guard" ON "driver_payouts";
DROP FUNCTION guard_payout_update();

-- A payout is only ever created for the driver's own VERIFIED bank account. Amounts, deductions,
-- beneficiary and provider reference are immutable afterwards.
CREATE OR REPLACE FUNCTION guard_payout_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PREPARED' THEN
            RAISE EXCEPTION 'A payout starts PREPARED' USING ERRCODE = 'restrict_violation';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM driver_bank_accounts a
            WHERE a.id = NEW.bank_account_id
              AND a.driver_id = NEW.driver_id
              AND a.status = 'VERIFIED'
        ) THEN
            RAISE EXCEPTION 'A payout goes only to the driver''s own VERIFIED bank account'
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.id <> OLD.id
       OR NEW.batch_id <> OLD.batch_id
       OR NEW.driver_id <> OLD.driver_id
       OR NEW.bank_account_id <> OLD.bank_account_id
       OR NEW.gross_amount_paise <> OLD.gross_amount_paise
       OR NEW.tds_amount_paise <> OLD.tds_amount_paise
       OR NEW.other_deductions_paise <> OLD.other_deductions_paise
       OR NEW.tds_policy <> OLD.tds_policy
       OR NEW.tax_rule_id IS DISTINCT FROM OLD.tax_rule_id
       OR NEW.amount_paise <> OLD.amount_paise
       OR NEW.currency <> OLD.currency
       OR NEW.mode <> OLD.mode
       OR NEW.provider <> OLD.provider
       OR NEW.created_at <> OLD.created_at
       OR (OLD.provider_payout_id IS NOT NULL
           AND NEW.provider_payout_id IS DISTINCT FROM OLD.provider_payout_id) THEN
        RAISE EXCEPTION 'Payout amounts, deductions, beneficiary and provider reference are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
           (OLD.status = 'PREPARED' AND NEW.status IN ('SUBMITTING', 'FAILED'))
        OR (OLD.status = 'SUBMITTING' AND NEW.status IN ('SUBMITTED', 'PROCESSED', 'FAILED', 'REVERSED'))
        OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('PROCESSED', 'FAILED', 'REVERSED'))
        OR (OLD.status = 'PROCESSED' AND NEW.status = 'REVERSED')
    ) THEN
        RAISE EXCEPTION 'Invalid payout transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payouts_guard
BEFORE INSERT OR UPDATE ON "driver_payouts"
FOR EACH ROW
EXECUTE FUNCTION guard_payout_change();

-- A payout's gross is exactly the sum of its items: checked at COMMIT, after the items exist.
CREATE OR REPLACE FUNCTION check_payout_matches_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    item_total BIGINT;
BEGIN
    SELECT COALESCE(SUM(amount_paise), 0) INTO item_total
    FROM payout_items
    WHERE payout_id = NEW.id;
    IF item_total <> NEW.gross_amount_paise THEN
        RAISE EXCEPTION 'Payout % gross % does not equal its items (%)', NEW.id, NEW.gross_amount_paise, item_total
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

-- ============================================================================
-- Documentation for anyone reading the database directly
-- ============================================================================
COMMENT ON TABLE "payment_settlements" IS 'Merchant settlement of one customer payment, from Razorpay settlement reconciliation (or the non-production simulator). Append-only. Required before an ONLINE earning is PAYABLE.';
COMMENT ON TABLE "tax_rules" IS 'Versioned TDS rules. Empty until a CA confirms the rule (OPEN_DECISIONS D-57). Written by ops tooling only; never edited except to close a version.';
COMMENT ON TABLE "bank_account_verifications" IS 'Bank validations (RazorpayX penny drop) of driver bank accounts: account status and the bank''s registered holder name. Evidence for admin approval; finished results are immutable.';
COMMENT ON COLUMN "drivers"."legal_name" IS 'Name on the approved KYC documents, set by ops tooling. Compared with the bank''s registered name.';
COMMENT ON COLUMN "driver_earnings"."payment_settlement_id" IS 'Merchant settlement of the customer payment. Required before an ONLINE earning can be PAYABLE (CHECK).';
COMMENT ON COLUMN "driver_earnings"."payable_at" IS 'When the earning first became PAYABLE: the later of trip completion and merchant settlement. Set once.';
COMMENT ON COLUMN "driver_earnings"."net_amount_paise" IS 'gross - platform fee - other deductions - TDS. ONLINE: owed to the driver through a weekly payout. CASH: already kept by the driver.';
COMMENT ON COLUMN "driver_payouts"."amount_paise" IS 'Amount transferred: gross_amount_paise - tds_amount_paise - other_deductions_paise.';
COMMENT ON COLUMN "driver_bank_accounts"."approved_verification_id" IS 'The completed, active bank validation the admin approved this account on. Required for VERIFIED.';
