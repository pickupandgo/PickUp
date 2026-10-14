-- Customer self-registration (POST /v1/customers/me).
--
-- The API role still has no INSERT on users, auth_identities or customers. Its only way to create
-- an account is this function, which:
--   - creates nothing but a CUSTOMER user (never a driver or an admin);
--   - takes the phone from the caller's verified token (the API checks the claim) and never links
--     a phone that already belongs to another account: a recycled or reassigned number must not
--     inherit someone else's bookings and payments;
--   - never changes an existing account; repeating the call returns the same customer;
--   - settles concurrent calls for the same sign-in to one account (unique indexes + retry).
--
-- SECURITY DEFINER runs with the owner's rights (the migrator role, which owns the tables). The
-- search_path is pinned so a caller can't substitute objects.

CREATE FUNCTION register_customer(p_provider TEXT, p_subject TEXT, p_phone TEXT)
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
                -- A CUSTOMER user without its profile row can only come from manual repair; add it.
                INSERT INTO customers (user_id) VALUES (v_user_id) ON CONFLICT DO NOTHING;
                SELECT c.id INTO v_customer_id FROM customers c WHERE c.user_id = v_user_id;
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
            INSERT INTO customers (user_id) VALUES (v_user_id) RETURNING id INTO v_customer_id;
            RETURN QUERY SELECT 'CREATED'::TEXT, v_user_id, v_customer_id;
            RETURN;
        EXCEPTION WHEN unique_violation THEN
            -- A concurrent registration (same sign-in or same phone) committed first. The inserts
            -- above were rolled back; look again and report what is there now.
            NULL;
        END;
    END LOOP;

    RAISE EXCEPTION 'register_customer: concurrent registrations did not settle'
        USING ERRCODE = 'serialization_failure';
END;
$$;

REVOKE ALL ON FUNCTION register_customer(TEXT, TEXT, TEXT) FROM PUBLIC;

COMMENT ON FUNCTION register_customer(TEXT, TEXT, TEXT) IS
    'Creates a CUSTOMER account for a verified sign-in, or returns the existing one. The only account-creating path open to the API role (EXECUTE grant in prisma/sql/02-app-grants.sql).';
