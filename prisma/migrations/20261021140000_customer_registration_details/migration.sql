-- Customer self-registration enhancement: stores name and email (POST /v1/customers/me).

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "name" VARCHAR(120);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255);

DROP FUNCTION IF EXISTS register_customer(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION register_customer(
    p_provider TEXT,
    p_subject TEXT,
    p_phone TEXT,
    p_name TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL
)
RETURNS TABLE (outcome TEXT, registered_user_id UUID, registered_customer_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_role user_role;
    v_status user_status;
    v_customer_id UUID;
BEGIN
    IF p_provider IS NULL OR p_provider !~ '^[a-z][a-z0-9_.:-]{0,29}$' THEN
        RAISE EXCEPTION 'register_customer: invalid provider' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_subject IS NULL OR p_subject !~ '^[A-Za-z0-9_-]{1,128}$' THEN
        RAISE EXCEPTION 'register_customer: invalid subject' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
        RAISE EXCEPTION 'register_customer: invalid phone' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    FOR attempt IN 1..3 LOOP
        SELECT u.id, u.role, u.status, c.id
          INTO v_user_id, v_role, v_status, v_customer_id
          FROM auth_identities ai
          JOIN users u ON u.id = ai.user_id
          LEFT JOIN customers c ON c.user_id = u.id
         WHERE ai.provider = p_provider AND ai.subject = p_subject;

        IF FOUND THEN
            IF v_role <> 'CUSTOMER' THEN
                RETURN QUERY SELECT 'ROLE_CONFLICT'::TEXT, v_user_id, NULL::UUID;
                RETURN;
            END IF;
            IF v_status <> 'ACTIVE' THEN
                RETURN QUERY SELECT 'DISABLED'::TEXT, v_user_id, v_customer_id;
                RETURN;
            END IF;
            IF v_customer_id IS NULL THEN
                INSERT INTO customers (user_id, name, email)
                     VALUES (v_user_id, p_name, p_email)
                ON CONFLICT DO NOTHING;
                SELECT c.id INTO v_customer_id FROM customers c WHERE c.user_id = v_user_id;
            ELSE
                UPDATE customers
                   SET name = COALESCE(p_name, customers.name),
                       email = COALESCE(p_email, customers.email),
                       updated_at = now()
                 WHERE customers.id = v_customer_id;
            END IF;
            RETURN QUERY SELECT 'EXISTING'::TEXT, v_user_id, v_customer_id;
            RETURN;
        END IF;

        IF EXISTS (SELECT 1 FROM users u WHERE u.phone = p_phone) THEN
            RETURN QUERY SELECT 'PHONE_TAKEN'::TEXT, NULL::UUID, NULL::UUID;
            RETURN;
        END IF;

        BEGIN
            INSERT INTO users (phone, role) VALUES (p_phone, 'CUSTOMER') RETURNING id INTO v_user_id;
            INSERT INTO auth_identities (user_id, provider, subject)
                 VALUES (v_user_id, p_provider, p_subject);
            INSERT INTO customers (user_id, name, email)
                 VALUES (v_user_id, p_name, p_email)
              RETURNING id INTO v_customer_id;
            RETURN QUERY SELECT 'CREATED'::TEXT, v_user_id, v_customer_id;
            RETURN;
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;
    END LOOP;

    RAISE EXCEPTION 'register_customer: concurrent registrations did not settle'
        USING ERRCODE = 'serialization_failure';
END;
$$;

REVOKE ALL ON FUNCTION register_customer(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

COMMENT ON FUNCTION register_customer(TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Creates a CUSTOMER account with optional name and email for a verified sign-in, or returns the existing one.';
