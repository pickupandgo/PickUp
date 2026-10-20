-- Driver Registration Details & Vehicle Information (POST /v1/drivers/me)
--
-- Extends the drivers table with personal email, vehicle details and licence details:
--   - email (VARCHAR 255)
--   - vehicle_type (VARCHAR 30)
--   - vehicle_make_model (VARCHAR 100)
--   - vehicle_registration_number (VARCHAR 30)
--   - driving_license_number (VARCHAR 50)
--
-- Updates register_driver() SECURITY DEFINER function to accept these details and persist
-- them during driver registration, or update missing fields on incomplete profiles.

ALTER TABLE drivers
    ADD COLUMN IF NOT EXISTS email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(30),
    ADD COLUMN IF NOT EXISTS vehicle_make_model VARCHAR(100),
    ADD COLUMN IF NOT EXISTS vehicle_registration_number VARCHAR(30),
    ADD COLUMN IF NOT EXISTS driving_license_number VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_drivers_vehicle_registration ON drivers (vehicle_registration_number);

-- Drop previous 4-argument overload so there is no ambiguity
DROP FUNCTION IF EXISTS register_driver(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION register_driver(
    p_provider TEXT,
    p_subject TEXT,
    p_phone TEXT,
    p_legal_name TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_vehicle_type TEXT DEFAULT NULL,
    p_vehicle_make_model TEXT DEFAULT NULL,
    p_vehicle_registration_number TEXT DEFAULT NULL,
    p_driving_license_number TEXT DEFAULT NULL
)
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
                INSERT INTO drivers (
                    user_id,
                    approval_status,
                    legal_name,
                    email,
                    vehicle_type,
                    vehicle_make_model,
                    vehicle_registration_number,
                    driving_license_number
                ) VALUES (
                    v_user_id,
                    'PENDING',
                    p_legal_name,
                    p_email,
                    p_vehicle_type,
                    p_vehicle_make_model,
                    p_vehicle_registration_number,
                    p_driving_license_number
                )
                ON CONFLICT (user_id) DO NOTHING;
                SELECT d.id INTO v_driver_id FROM drivers d WHERE d.user_id = v_user_id;
            ELSE
                -- Update profile details if provided (resuming incomplete registration)
                UPDATE drivers
                   SET legal_name = COALESCE(p_legal_name, legal_name),
                       email = COALESCE(p_email, email),
                       vehicle_type = COALESCE(p_vehicle_type, vehicle_type),
                       vehicle_make_model = COALESCE(p_vehicle_make_model, vehicle_make_model),
                       vehicle_registration_number = COALESCE(p_vehicle_registration_number, vehicle_registration_number),
                       driving_license_number = COALESCE(p_driving_license_number, driving_license_number),
                       updated_at = NOW()
                 WHERE id = v_driver_id;
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
            INSERT INTO drivers (
                user_id,
                approval_status,
                legal_name,
                email,
                vehicle_type,
                vehicle_make_model,
                vehicle_registration_number,
                driving_license_number
            ) VALUES (
                v_user_id,
                'PENDING',
                p_legal_name,
                p_email,
                p_vehicle_type,
                p_vehicle_make_model,
                p_vehicle_registration_number,
                p_driving_license_number
            )
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

REVOKE ALL ON FUNCTION register_driver(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

COMMENT ON FUNCTION register_driver(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Creates a DRIVER account with PENDING status, vehicle details, licence details and wallet, or updates an existing incomplete profile.';
