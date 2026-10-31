-- Additive M02 profile fields. Existing accounts retain NULL until the owner supplies values.
ALTER TABLE customers
    ADD COLUMN age INTEGER,
    ADD COLUMN address VARCHAR(500),
    ADD CONSTRAINT chk_customers_age CHECK (age IS NULL OR age BETWEEN 1 AND 120),
    ADD CONSTRAINT chk_customers_address_nonblank CHECK (
        address IS NULL OR address ~ '[^[:space:]]'
    );
