-- Keep identity-critical driver fields outside the API role's direct UPDATE privileges. These
-- narrow functions are the only Phase 2A path for an authenticated admin workflow to set them.
CREATE FUNCTION admin_set_driver_legal_name_after_kyc(
    p_driver_id UUID,
    p_application_id UUID,
    p_actor_user_id UUID,
    p_legal_name TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF length(btrim(p_legal_name)) < 3 OR length(btrim(p_legal_name)) > 120 THEN
        RAISE EXCEPTION 'invalid legal name' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor_user_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'active administrator required' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM kyc_applications
         WHERE id = p_application_id AND driver_id = p_driver_id
           AND status = 'VERIFIED' AND reviewed_by_user_id = p_actor_user_id
    ) THEN
        RAISE EXCEPTION 'verified KYC decision required' USING ERRCODE = '23514';
    END IF;
    UPDATE drivers SET legal_name = btrim(p_legal_name), updated_at = now() WHERE id = p_driver_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'driver not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;

CREATE FUNCTION admin_set_driver_status(
    p_driver_id UUID,
    p_status TEXT,
    p_actor_user_id UUID,
    p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_previous driver_approval_status;
    v_status driver_approval_status;
BEGIN
    IF p_status NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED') THEN
        RAISE EXCEPTION 'invalid driver decision' USING ERRCODE = '23514';
    END IF;
    IF length(btrim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'decision reason required' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor_user_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'active administrator required' USING ERRCODE = '42501';
    END IF;
    SELECT approval_status INTO v_previous FROM drivers WHERE id = p_driver_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'driver not found' USING ERRCODE = 'P0002'; END IF;
    v_status := p_status::driver_approval_status;
    IF v_status = 'APPROVED' AND NOT (
        EXISTS (SELECT 1 FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id=p_driver_id AND u.status='ACTIVE' AND d.profile_name IS NOT NULL)
        AND EXISTS (SELECT 1 FROM kyc_applications k WHERE k.driver_id=p_driver_id AND k.status='VERIFIED' AND (k.expires_at IS NULL OR k.expires_at > now()))
        AND EXISTS (SELECT 1 FROM vehicles v WHERE v.driver_id=p_driver_id AND v.active AND v.status='VERIFIED')
    ) THEN
        RAISE EXCEPTION 'driver approval prerequisites are incomplete' USING ERRCODE = '23514';
    END IF;
    UPDATE drivers SET approval_status=v_status,
        approved_at=CASE WHEN v_status='APPROVED' THEN now() ELSE NULL END,
        approved_by_user_id=CASE WHEN v_status='APPROVED' THEN p_actor_user_id ELSE NULL END,
        updated_at=now()
     WHERE id=p_driver_id;
    INSERT INTO admin_actions(actor_user_id,action,target_type,target_id,reason,details)
    VALUES(p_actor_user_id,'DRIVER_' || CASE p_status WHEN 'PENDING' THEN 'CORRECTION' ELSE p_status END,'DRIVER',p_driver_id::text,btrim(p_reason),jsonb_build_object('previousStatus',v_previous));
END;
$$;

CREATE FUNCTION guard_verified_vehicle_identity() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (NEW.category,NEW.registration_number,NEW.make_model)
       IS DISTINCT FROM (OLD.category,OLD.registration_number,OLD.make_model)
       AND (OLD.active OR OLD.status NOT IN ('DRAFT','REJECTED')) THEN
        RAISE EXCEPTION 'verified vehicle changes require replacement and reverification'
          USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_verified_vehicle_identity
BEFORE UPDATE OF category,registration_number,make_model ON vehicles
FOR EACH ROW EXECUTE FUNCTION guard_verified_vehicle_identity();

REVOKE ALL ON FUNCTION admin_set_driver_legal_name_after_kyc(UUID,UUID,UUID,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_driver_status(UUID,TEXT,UUID,TEXT) FROM PUBLIC;
