-- Fare module: versioned pricing and server-side quotes.
--
-- The customer's price is calculated here, on the server, from a pricing version. A quote
-- freezes the amounts the customer saw (total and per drop, integer paise) for a short time;
-- booking registration copies them into the booking. Apps never send an amount, and no payment
-- code recalculates one. Pricing changes are new versions, so old quotes and bookings keep the
-- numbers they were priced with.

-- CreateTable
CREATE TABLE "pricing_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "model" VARCHAR(40) NOT NULL,
    "config" JSONB NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by_user_id" UUID,
    "deactivation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fare_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "pricing_version_id" UUID NOT NULL,
    "vehicle_category" VARCHAR(50) NOT NULL,
    "weight_grams" INTEGER NOT NULL,
    "pickup_latitude" DECIMAL(9,6) NOT NULL,
    "pickup_longitude" DECIMAL(9,6) NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "fare_paise" BIGINT NOT NULL,
    "tax_paise" BIGINT NOT NULL,
    "payable_paise" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fare_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fare_quote_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "fare_paise" BIGINT NOT NULL,
    "tax_paise" BIGINT NOT NULL,
    "payable_paise" BIGINT NOT NULL,

    CONSTRAINT "fare_quote_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_pricing_versions_code" ON "pricing_versions"("code");

-- CreateIndex
CREATE INDEX "idx_pricing_versions_lookup" ON "pricing_versions"("active", "effective_from" DESC);

-- CreateIndex
CREATE INDEX "idx_fare_quotes_customer_created" ON "fare_quotes"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_fare_quotes_pricing_version" ON "fare_quotes"("pricing_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_fare_quote_stops_sequence" ON "fare_quote_stops"("quote_id", "sequence");

-- AddForeignKey
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_deactivated_by_user_id_fkey" FOREIGN KEY ("deactivated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_pricing_version_id_fkey" FOREIGN KEY ("pricing_version_id") REFERENCES "pricing_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fare_quote_stops" ADD CONSTRAINT "fare_quote_stops_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "fare_quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Pricing versions: same lifecycle as fee rules. Never edited; closed or deactivated only.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "pricing_versions"
    ADD CONSTRAINT "pricing_versions_code_format" CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{1,39}$'),
    ADD CONSTRAINT "pricing_versions_model_valid" CHECK (model IN ('LEG_DISTANCE_V1')),
    ADD CONSTRAINT "pricing_versions_config_object" CHECK (jsonb_typeof(config) = 'object'),
    ADD CONSTRAINT "pricing_versions_window" CHECK (effective_to IS NULL OR effective_to > effective_from),
    ADD CONSTRAINT "pricing_versions_reason_length" CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
    ADD CONSTRAINT "pricing_versions_deactivation_shape" CHECK (
        active
        OR (deactivated_at IS NOT NULL AND deactivation_reason IS NOT NULL
            AND length(btrim(deactivation_reason)) > 0)
    );

CREATE OR REPLACE FUNCTION guard_pricing_version_update() RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.code <> OLD.code
       OR NEW.model <> OLD.model
       OR NEW.config <> OLD.config
       OR NEW.effective_from <> OLD.effective_from
       OR NEW.reason <> OLD.reason
       OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Pricing versions are never edited; create a new version instead'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
        RAISE EXCEPTION 'A closed pricing version cannot be reopened or moved'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT OLD.active AND (NEW.active
                           OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
                           OR NEW.deactivated_by_user_id IS DISTINCT FROM OLD.deactivated_by_user_id
                           OR NEW.deactivation_reason IS DISTINCT FROM OLD.deactivation_reason) THEN
        RAISE EXCEPTION 'A deactivated pricing version cannot be changed'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pricing_versions_guard BEFORE UPDATE ON "pricing_versions"
    FOR EACH ROW EXECUTE FUNCTION guard_pricing_version_update();
CREATE TRIGGER trg_pricing_versions_no_delete BEFORE DELETE ON "pricing_versions"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_pricing_versions_no_truncate BEFORE TRUNCATE ON "pricing_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();

-- ---------------------------------------------------------------------------------------------
-- Quotes: written once by the server. Only redeemed_at changes, once, before expiry.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "fare_quotes"
    ADD CONSTRAINT "fare_quotes_vehicle_category_format" CHECK (vehicle_category ~ '^[A-Z][A-Z0-9_]{0,49}$'),
    ADD CONSTRAINT "fare_quotes_weight_range" CHECK (weight_grams > 0 AND weight_grams <= 100000000),
    ADD CONSTRAINT "fare_quotes_pickup_valid" CHECK (
        pickup_latitude BETWEEN -90 AND 90 AND pickup_longitude BETWEEN -180 AND 180
    ),
    ADD CONSTRAINT "fare_quotes_distance_nonnegative" CHECK (distance_meters >= 0),
    ADD CONSTRAINT "fare_quotes_amounts_valid" CHECK (
        fare_paise > 0 AND tax_paise >= 0 AND payable_paise = fare_paise + tax_paise
    ),
    -- Razorpay's limits for one order: Rs 1 to Rs 5,00,000.
    ADD CONSTRAINT "fare_quotes_payable_range" CHECK (payable_paise BETWEEN 100 AND 50000000),
    ADD CONSTRAINT "fare_quotes_expiry_after_creation" CHECK (expires_at > created_at),
    ADD CONSTRAINT "fare_quotes_redeemed_in_validity" CHECK (
        redeemed_at IS NULL OR (redeemed_at >= created_at AND redeemed_at <= expires_at)
    );

ALTER TABLE "fare_quote_stops"
    ADD CONSTRAINT "fare_quote_stops_sequence_range" CHECK (sequence BETWEEN 1 AND 5),
    ADD CONSTRAINT "fare_quote_stops_location_valid" CHECK (
        latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
    ),
    ADD CONSTRAINT "fare_quote_stops_distance_nonnegative" CHECK (distance_meters >= 0),
    ADD CONSTRAINT "fare_quote_stops_amounts_valid" CHECK (
        fare_paise > 0 AND tax_paise >= 0 AND payable_paise = fare_paise + tax_paise
    );

CREATE OR REPLACE FUNCTION guard_fare_quote_update() RETURNS trigger AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.customer_id <> OLD.customer_id
       OR NEW.pricing_version_id <> OLD.pricing_version_id
       OR NEW.vehicle_category <> OLD.vehicle_category
       OR NEW.weight_grams <> OLD.weight_grams
       OR NEW.pickup_latitude <> OLD.pickup_latitude
       OR NEW.pickup_longitude <> OLD.pickup_longitude
       OR NEW.distance_meters <> OLD.distance_meters
       OR NEW.fare_paise <> OLD.fare_paise
       OR NEW.tax_paise <> OLD.tax_paise
       OR NEW.payable_paise <> OLD.payable_paise
       OR NEW.expires_at <> OLD.expires_at
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Fare quotes are immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.redeemed_at IS NOT NULL AND NEW.redeemed_at IS DISTINCT FROM OLD.redeemed_at THEN
        RAISE EXCEPTION 'A fare quote is redeemed once' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_fare_quote_stop_update() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Fare quote stops are immutable' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- At commit: the stops are numbered 1..n and add up exactly to the quote's totals.
-- The quote id is resolved in the body, not in DECLARE: a variable's initializer is always
-- evaluated, and NEW.quote_id does not exist when the trigger fires on fare_quotes.
CREATE OR REPLACE FUNCTION check_fare_quote_totals() RETURNS trigger AS $$
DECLARE
    v_quote_id UUID;
    q RECORD;
    s RECORD;
BEGIN
    IF TG_TABLE_NAME = 'fare_quotes' THEN
        v_quote_id := NEW.id;
    ELSE
        v_quote_id := NEW.quote_id;
    END IF;
    SELECT fare_paise, tax_paise, payable_paise, distance_meters INTO q
      FROM fare_quotes WHERE id = v_quote_id;
    SELECT count(*) AS n, min(sequence) AS first_seq, max(sequence) AS last_seq,
           COALESCE(sum(fare_paise), 0) AS fare, COALESCE(sum(tax_paise), 0) AS tax,
           COALESCE(sum(payable_paise), 0) AS payable, COALESCE(sum(distance_meters), 0) AS distance
      INTO s
      FROM fare_quote_stops WHERE quote_id = v_quote_id;
    IF s.n = 0 OR s.first_seq <> 1 OR s.last_seq <> s.n THEN
        RAISE EXCEPTION 'Fare quote % must have stops numbered 1..n', v_quote_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF s.fare <> q.fare_paise OR s.tax <> q.tax_paise OR s.payable <> q.payable_paise
       OR s.distance <> q.distance_meters THEN
        RAISE EXCEPTION 'Fare quote % stops do not add up to its totals', v_quote_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fare_quotes_guard BEFORE UPDATE ON "fare_quotes"
    FOR EACH ROW EXECUTE FUNCTION guard_fare_quote_update();
CREATE CONSTRAINT TRIGGER trg_fare_quotes_totals AFTER INSERT ON "fare_quotes"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_fare_quote_totals();
CREATE CONSTRAINT TRIGGER trg_fare_quote_stops_totals AFTER INSERT ON "fare_quote_stops"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_fare_quote_totals();
CREATE TRIGGER trg_fare_quote_stops_immutable BEFORE UPDATE ON "fare_quote_stops"
    FOR EACH ROW EXECUTE FUNCTION prevent_fare_quote_stop_update();
CREATE TRIGGER trg_fare_quotes_no_delete BEFORE DELETE ON "fare_quotes"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_fare_quotes_no_truncate BEFORE TRUNCATE ON "fare_quotes"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_fare_quote_stops_no_delete BEFORE DELETE ON "fare_quote_stops"
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_delete();
CREATE TRIGGER trg_fare_quote_stops_no_truncate BEFORE TRUNCATE ON "fare_quote_stops"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_financial_record_delete();

COMMENT ON TABLE "pricing_versions" IS 'Versioned pricing (Fare module). Config is immutable; a change is a new version.';
COMMENT ON TABLE "fare_quotes" IS 'Server-calculated fare for one route, valid until expires_at, redeemed by at most one booking.';
COMMENT ON COLUMN "fare_quotes"."payable_paise" IS 'fare_paise + tax_paise, in paise: what the sender (or the receivers together) pays.';
COMMENT ON COLUMN "fare_quote_stops"."payable_paise" IS 'What the receiver at this drop pays when receivers pay: fare_paise + tax_paise.';
