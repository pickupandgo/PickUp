-- Bank-account changes need a step-up re-authentication (OPEN_DECISIONS D-61, third set).
--
--   driver requests a change (normal session)
--     -> phone OTP re-authentication AFTER the request (fresh Firebase ID token: auth_time,
--        phone_number = the driver's registered phone)
--     -> new bank account, PENDING_VERIFICATION (the old VERIFIED one is suspended in the same
--        transaction)
--     -> bank validation -> admin approval -> VERIFIED, the only payout-eligible status
--
-- The database refuses any new bank account that is not bound to a step-up verified change
-- request of the same driver, so a stolen session alone can never add or redirect a payout
-- destination. Times come from the database clock only.

-- ============================================================================
-- bank_account_change_requests
-- ============================================================================
CREATE TABLE "bank_account_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING_STEP_UP',
    "step_up_method" VARCHAR(30) NOT NULL DEFAULT 'FIREBASE_PHONE_REAUTH',
    "step_up_auth_time" TIMESTAMPTZ(6),
    "step_up_phone" VARCHAR(20),
    "step_up_verified_at" TIMESTAMPTZ(6),
    "close_reason" VARCHAR(40),
    "expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT (clock_timestamp() + '00:10:00'::interval),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_account_change_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_bank_change_requests_driver_created" ON "bank_account_change_requests"("driver_id", "created_at" DESC);
-- At most one open request per driver.
CREATE UNIQUE INDEX "uq_bank_change_requests_driver_open" ON "bank_account_change_requests"("driver_id") WHERE ((status)::text = ANY (ARRAY[('PENDING_STEP_UP'::character varying)::text, ('STEP_UP_VERIFIED'::character varying)::text]));
ALTER TABLE "bank_account_change_requests" ADD CONSTRAINT "bank_account_change_requests_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "bank_account_change_requests"
    ADD CONSTRAINT "bank_change_requests_status_valid"
        CHECK (status IN ('PENDING_STEP_UP', 'STEP_UP_VERIFIED', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
    ADD CONSTRAINT "bank_change_requests_method_valid"
        CHECK (step_up_method IN ('FIREBASE_PHONE_REAUTH')),
    -- The step-up window is at most 10 minutes.
    ADD CONSTRAINT "bank_change_requests_window"
        CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
    ADD CONSTRAINT "bank_change_requests_close_reason_valid"
        CHECK (close_reason IS NULL OR close_reason IN ('DRIVER_CANCELLED', 'SUPERSEDED')),
    ADD CONSTRAINT "bank_change_requests_cancelled_has_reason"
        CHECK (status <> 'CANCELLED' OR close_reason IS NOT NULL),
    -- No step-up evidence before verification (or on a request that never got it).
    ADD CONSTRAINT "bank_change_requests_unverified_shape"
        CHECK (status NOT IN ('PENDING_STEP_UP', 'CANCELLED', 'EXPIRED')
               OR (step_up_auth_time IS NULL AND step_up_phone IS NULL AND step_up_verified_at IS NULL)),
    -- Verified: a sign-in that happened AFTER the request was created, recorded before it expired.
    ADD CONSTRAINT "bank_change_requests_verified_shape"
        CHECK (status NOT IN ('STEP_UP_VERIFIED', 'COMPLETED')
               OR (step_up_auth_time IS NOT NULL AND step_up_phone IS NOT NULL
                   AND step_up_verified_at IS NOT NULL
                   AND step_up_auth_time > created_at
                   AND step_up_verified_at <= expires_at)),
    ADD CONSTRAINT "bank_change_requests_closed_shape"
        CHECK ((status IN ('PENDING_STEP_UP', 'STEP_UP_VERIFIED')) = (closed_at IS NULL));

--   PENDING_STEP_UP  -> STEP_UP_VERIFIED (before expiry, with valid evidence)
--                    -> CANCELLED (by the driver, or superseded by a newer request)
--                    -> EXPIRED (only after expiry)
--   STEP_UP_VERIFIED -> COMPLETED (only with the bank account it added)
-- STEP_UP_VERIFIED never survives a transaction (deferred check below): the request is verified,
-- the account added and the request completed in one transaction. Closed requests are final.
CREATE OR REPLACE FUNCTION guard_bank_change_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    registered_phone VARCHAR(20);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING_STEP_UP' THEN
            RAISE EXCEPTION 'A bank-account change request starts PENDING_STEP_UP'
                USING ERRCODE = 'restrict_violation';
        END IF;
        -- The step-up window comes from the database clock: it can't be backdated or extended.
        NEW.created_at := clock_timestamp();
        NEW.expires_at := NEW.created_at + interval '10 minutes';
        NEW.closed_at := NULL;
        RETURN NEW;
    END IF;

    IF NEW.id <> OLD.id
       OR NEW.driver_id <> OLD.driver_id
       OR NEW.step_up_method <> OLD.step_up_method
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'A bank-account change request''s owner and method are immutable'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status IN ('COMPLETED', 'CANCELLED', 'EXPIRED') THEN
        RAISE EXCEPTION 'A closed bank-account change request is final'
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- A pending request's expiry may only be brought forward, never extended.
    IF NEW.expires_at > OLD.expires_at
       OR (OLD.status <> 'PENDING_STEP_UP' AND NEW.expires_at <> OLD.expires_at) THEN
        RAISE EXCEPTION 'A bank-account change request''s expiry can never be extended'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = OLD.status THEN
        IF NEW.step_up_auth_time IS DISTINCT FROM OLD.step_up_auth_time
           OR NEW.step_up_phone IS DISTINCT FROM OLD.step_up_phone
           OR NEW.step_up_verified_at IS DISTINCT FROM OLD.step_up_verified_at
           OR NEW.close_reason IS DISTINCT FROM OLD.close_reason
           OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
            RAISE EXCEPTION 'Step-up evidence is recorded once, when the request is verified'
                USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status = 'PENDING_STEP_UP' AND NEW.status = 'STEP_UP_VERIFIED' THEN
        IF OLD.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'This bank-account change request has expired'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.step_up_auth_time IS NULL
           OR NEW.step_up_auth_time <= OLD.created_at
           OR NEW.step_up_auth_time > clock_timestamp() + interval '5 seconds' THEN
            RAISE EXCEPTION 'Step-up needs a sign-in that happened after the change request was created'
                USING ERRCODE = 'restrict_violation';
        END IF;
        SELECT u.phone INTO registered_phone
        FROM drivers d
        JOIN users u ON u.id = d.user_id
        WHERE d.id = NEW.driver_id;
        IF NEW.step_up_phone IS DISTINCT FROM registered_phone THEN
            RAISE EXCEPTION 'Step-up must verify the driver''s registered phone number'
                USING ERRCODE = 'restrict_violation';
        END IF;
        NEW.step_up_verified_at := clock_timestamp();
        NEW.close_reason := NULL;
        RETURN NEW;
    END IF;

    IF OLD.status = 'PENDING_STEP_UP' AND NEW.status IN ('CANCELLED', 'EXPIRED') THEN
        IF NEW.status = 'EXPIRED' AND OLD.expires_at > clock_timestamp() THEN
            RAISE EXCEPTION 'A bank-account change request expires only after its expiry time'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.status = 'EXPIRED' THEN
            NEW.close_reason := NULL;
        END IF;
        NEW.closed_at := clock_timestamp();
        RETURN NEW;
    END IF;

    IF OLD.status = 'STEP_UP_VERIFIED' AND NEW.status = 'COMPLETED' THEN
        IF NEW.step_up_auth_time IS DISTINCT FROM OLD.step_up_auth_time
           OR NEW.step_up_phone IS DISTINCT FROM OLD.step_up_phone
           OR NEW.step_up_verified_at IS DISTINCT FROM OLD.step_up_verified_at THEN
            RAISE EXCEPTION 'Step-up evidence is recorded once, when the request is verified'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM driver_bank_accounts a
            WHERE a.change_request_id = NEW.id AND a.driver_id = NEW.driver_id
        ) THEN
            RAISE EXCEPTION 'A change request completes only with the bank account it added'
                USING ERRCODE = 'restrict_violation';
        END IF;
        NEW.close_reason := NULL;
        NEW.closed_at := clock_timestamp();
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Invalid bank-account change request transition % -> %', OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_bank_change_requests_guard
BEFORE INSERT OR UPDATE ON "bank_account_change_requests"
FOR EACH ROW
EXECUTE FUNCTION guard_bank_change_request();

-- Checked at COMMIT: a verified request that did not add its account is never committed.
CREATE OR REPLACE FUNCTION check_bank_change_request_not_dangling()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM bank_account_change_requests
        WHERE id = NEW.id AND status = 'STEP_UP_VERIFIED'
    ) THEN
        RAISE EXCEPTION 'A step-up verified change request must add its bank account in the same transaction'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_bank_change_requests_not_dangling
AFTER UPDATE ON "bank_account_change_requests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.status = 'STEP_UP_VERIFIED')
EXECUTE FUNCTION check_bank_change_request_not_dangling();

CREATE TRIGGER trg_bank_change_requests_no_delete
BEFORE DELETE ON "bank_account_change_requests"
FOR EACH ROW
EXECUTE FUNCTION prevent_financial_record_delete();

CREATE TRIGGER trg_bank_change_requests_no_truncate
BEFORE TRUNCATE ON "bank_account_change_requests"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_financial_record_delete();

-- ============================================================================
-- driver_bank_accounts: every new account is bound to a step-up verified request
-- ============================================================================
ALTER TABLE "driver_bank_accounts" ADD COLUMN "change_request_id" UUID;
CREATE UNIQUE INDEX "uq_bank_accounts_change_request" ON "driver_bank_accounts"("change_request_id");
ALTER TABLE "driver_bank_accounts" ADD CONSTRAINT "driver_bank_accounts_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "bank_account_change_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- RazorpayX returns the existing contact and fund account when identical details are submitted
-- again (a driver switching back to an earlier account), so only live accounts need a unique
-- fund account. A replaced or rejected row may share it with the new, separately approved one.
DROP INDEX "uq_bank_accounts_fund_account";
CREATE UNIQUE INDEX "uq_bank_accounts_fund_account_live" ON "driver_bank_accounts"("provider", "provider_fund_account_id") WHERE (status = ANY (ARRAY['PENDING_VERIFICATION'::bank_account_status, 'VERIFIED'::bank_account_status]));

-- Accounts still waiting for approval were submitted without a step-up re-authentication: they
-- are suspended (never approvable, see the trigger) and the driver submits them again.
WITH suspended AS (
    UPDATE "driver_bank_accounts"
    SET status = 'SUSPENDED',
        status_reason = 'STEP_UP_REQUIRED: submitted before step-up verification; the driver must submit the account again',
        status_changed_by_user_id = NULL,
        updated_at = now()
    WHERE status = 'PENDING_VERIFICATION' AND change_request_id IS NULL
    RETURNING id
)
INSERT INTO "admin_actions" (actor_user_id, action, target_type, target_id, reason)
SELECT NULL, 'BANK_ACCOUNT_SUSPENDED', 'DRIVER_BANK_ACCOUNT', suspended.id::text,
       'Migration 20261008120000: STEP_UP_REQUIRED (OPEN_DECISIONS D-61)'
FROM suspended;

-- Same rules as before (20261007120100), plus:
--   * INSERT needs a STEP_UP_VERIFIED change request of the same driver;
--   * change_request_id is immutable;
--   * an account that was never approved needs that change request to ever become VERIFIED
--     (accounts added before step-up verification existed can't be approved).
CREATE OR REPLACE FUNCTION guard_bank_account_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    validation RECORD;
    change_request RECORD;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING_VERIFICATION' OR NEW.approved_verification_id IS NOT NULL
           OR NEW.verified_at IS NOT NULL OR NEW.verified_by_user_id IS NOT NULL THEN
            RAISE EXCEPTION 'A bank account starts PENDING_VERIFICATION and is approved by an admin later'
                USING ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.change_request_id IS NULL THEN
            RAISE EXCEPTION 'A bank account is added only through a step-up verified change request'
                USING ERRCODE = 'restrict_violation';
        END IF;
        SELECT r.driver_id, r.status
        INTO change_request
        FROM bank_account_change_requests r
        WHERE r.id = NEW.change_request_id
        FOR SHARE;
        IF NOT FOUND OR change_request.driver_id <> NEW.driver_id
           OR change_request.status <> 'STEP_UP_VERIFIED' THEN
            RAISE EXCEPTION 'A bank account is added only through a step-up verified change request of the same driver'
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
       OR NEW.change_request_id IS DISTINCT FROM OLD.change_request_id
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
        IF NEW.change_request_id IS NULL AND OLD.verified_at IS NULL THEN
            RAISE EXCEPTION 'A bank account submitted without step-up verification can never be approved'
                USING ERRCODE = 'restrict_violation';
        END IF;
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

-- ============================================================================
-- Documentation for anyone reading the database directly
-- ============================================================================
COMMENT ON TABLE "bank_account_change_requests" IS 'Driver requests to add or change the payout bank account. A new account is accepted only after a phone OTP re-authentication that happened after the request (step-up), then bank validation and admin approval.';
COMMENT ON COLUMN "bank_account_change_requests"."step_up_auth_time" IS 'auth_time of the Firebase ID token that proved the step-up; always after created_at.';
COMMENT ON COLUMN "bank_account_change_requests"."step_up_phone" IS 'phone_number of that token; equal to the driver''s registered phone (trigger).';
COMMENT ON COLUMN "driver_bank_accounts"."change_request_id" IS 'The step-up verified change request that added this account. NULL only for accounts added before step-up verification existed (never approvable).';
