-- Driver self-registration (POST /v1/drivers/me and POST /v1/drivers/register).
--
-- The API role still has no INSERT on users, auth_identities or drivers. Its only way to create
-- a driver account is this function, which:
--   - creates a DRIVER user with status ACTIVE;
--   - sets driver approval_status to 'PENDING';
--   - sets legal_name from verified registration inputs;
--   - ensures an initial driver_wallets row with balance 0 is created;
--   - takes the phone from the caller's verified token or verified input;
--   - never links a phone that already belongs to another account;
--   - never overwrites an existing driver account; repeating returns the existing driver;
--   - settles concurrent calls for the same sign-in to one account (unique indexes + retry).
--
-- SECURITY DEFINER runs with the owner's rights (the migrator role, which owns the tables).
-- The search_path is pinned so a caller cannot substitute objects.

CREATE FUNCTION register_driver(p_provider TEXT, p_subject TEXT, p_phone TEXT, p_legal_name TEXT DEFAULT NULL)
RETURNS TABLE (outcome TEXT, registered_user_id UUID, registered_driver_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_role user_role;
    v_status user_status;
    v_driver_id UUID;
BEGIN
    IF p_provider IS NULL OR p_provider !~ '^[a-z][a-z0-9_.:-]{0,29}$' THEN
        RAISE EXCEPTION 'register_driver: invalid provider' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_subject IS NULL OR p_subject !~ '^[A-Za-z0-9_-]{1,128}$' THEN
        RAISE EXCEPTION 'register_driver: invalid subject' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
        RAISE EXCEPTION 'register_driver: invalid phone' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    FOR attempt IN 1..3 LOOP
        SELECT u.id, u.role, u.status, d.id
          INTO v_user_id, v_role, v_status, v_driver_id
          FROM auth_identities ai
          JOIN users u ON u.id = ai.user_id
          LEFT JOIN drivers d ON d.user_id = u.id
         WHERE ai.provider = p_provider AND ai.subject = p_subject;

        IF FOUND THEN
            IF v_role <> 'DRIVER' THEN
                RETURN QUERY SELECT 'ROLE_CONFLICT'::TEXT, v_user_id, NULL::UUID;
                RETURN;
            END IF;
            IF v_status <> 'ACTIVE' THEN
                RETURN QUERY SELECT 'DISABLED'::TEXT, v_user_id, v_driver_id;
                RETURN;
            END IF;
            IF v_driver_id IS NULL THEN
                INSERT INTO drivers (user_id, approval_status, legal_name)
                     VALUES (v_user_id, 'PENDING', p_legal_name)
                ON CONFLICT (user_id) DO NOTHING;
                SELECT d.id INTO v_driver_id FROM drivers d WHERE d.user_id = v_user_id;
            END IF;
            -- Ensure wallet exists
            INSERT INTO driver_wallets (driver_id)
                 VALUES (v_driver_id)
            ON CONFLICT (driver_id) DO NOTHING;
            RETURN QUERY SELECT 'EXISTING'::TEXT, v_user_id, v_driver_id;
            RETURN;
        END IF;

        IF EXISTS (SELECT 1 FROM users u WHERE u.phone = p_phone) THEN
            RETURN QUERY SELECT 'PHONE_TAKEN'::TEXT, NULL::UUID, NULL::UUID;
            RETURN;
        END IF;

        BEGIN
            INSERT INTO users (phone, role) VALUES (p_phone, 'DRIVER') RETURNING id INTO v_user_id;
            INSERT INTO auth_identities (user_id, provider, subject)
                 VALUES (v_user_id, p_provider, p_subject);
            INSERT INTO drivers (user_id, approval_status, legal_name)
                 VALUES (v_user_id, 'PENDING', p_legal_name)
            RETURNING id INTO v_driver_id;
            INSERT INTO driver_wallets (driver_id)
                 VALUES (v_driver_id)
            ON CONFLICT (driver_id) DO NOTHING;
            RETURN QUERY SELECT 'CREATED'::TEXT, v_user_id, v_driver_id;
            RETURN;
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;
    END LOOP;

    RAISE EXCEPTION 'register_driver: concurrent registrations did not settle'
        USING ERRCODE = 'serialization_failure';
END;
$$;

REVOKE ALL ON FUNCTION register_driver(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

COMMENT ON FUNCTION register_driver(TEXT, TEXT, TEXT, TEXT) IS
    'Creates a DRIVER account with PENDING status and wallet for a verified sign-in, or returns the existing one.';
