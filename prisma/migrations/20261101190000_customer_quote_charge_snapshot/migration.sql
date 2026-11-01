-- Existing quotes/bookings keep every original amount.
ALTER TABLE fare_quotes ADD COLUMN delivery_fare_paise BIGINT,
 ADD COLUMN customer_platform_fee_paise BIGINT, ADD COLUMN customer_platform_fee_bps INTEGER, ADD COLUMN surge_charge_paise BIGINT;
ALTER TABLE fare_quotes ADD CONSTRAINT chk_customer_quote_charge_snapshot CHECK (
 (delivery_fare_paise IS NULL AND customer_platform_fee_paise IS NULL AND customer_platform_fee_bps IS NULL AND surge_charge_paise IS NULL)
 OR (delivery_fare_paise IS NOT NULL AND customer_platform_fee_paise IS NOT NULL AND customer_platform_fee_bps IS NOT NULL AND surge_charge_paise IS NOT NULL
 AND delivery_fare_paise >= 0 AND customer_platform_fee_paise >= 0 AND customer_platform_fee_bps BETWEEN 0 AND 10000 AND surge_charge_paise >= 0
 AND customer_platform_fee_paise = (delivery_fare_paise * customer_platform_fee_bps + 5000) / 10000
 AND fare_paise = delivery_fare_paise + customer_platform_fee_paise + surge_charge_paise));
CREATE FUNCTION keep_customer_quote_charges_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.delivery_fare_paise,NEW.customer_platform_fee_paise,NEW.customer_platform_fee_bps,NEW.surge_charge_paise)
 IS DISTINCT FROM ROW(OLD.delivery_fare_paise,OLD.customer_platform_fee_paise,OLD.customer_platform_fee_bps,OLD.surge_charge_paise) THEN
 RAISE EXCEPTION 'Quoted customer charges are immutable' USING ERRCODE = 'restrict_violation';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER trg_customer_quote_charges_immutable BEFORE UPDATE ON fare_quotes FOR EACH ROW EXECUTE FUNCTION keep_customer_quote_charges_immutable();
