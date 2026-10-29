-- Additive only. Existing drivers retain the v1 profile contract until a full save.
ALTER TABLE drivers
  ADD COLUMN profile_version integer NOT NULL DEFAULT 1,
  ADD COLUMN date_of_birth date,
  ADD COLUMN gender varchar(30),
  ADD COLUMN residential_address varchar(500),
  ADD COLUMN city varchar(100),
  ADD COLUMN state varchar(100),
  ADD COLUMN pin_code varchar(6),
  ADD COLUMN selected_vehicle_category varchar(30),
  ADD COLUMN driving_license_ciphertext text,
  ADD COLUMN driving_license_last4 varchar(4),
  ADD COLUMN licence_expires_on date,
  ADD COLUMN licence_vehicle_classes text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT ck_driver_profile_version CHECK (profile_version IN (1, 2)),
  ADD CONSTRAINT ck_driver_pin CHECK (pin_code IS NULL OR pin_code ~ '^[1-9][0-9]{5}$'),
  ADD CONSTRAINT ck_driver_gender CHECK (gender IS NULL OR gender IN ('FEMALE','MALE','OTHER','PREFER_NOT_TO_SAY')),
  ADD CONSTRAINT ck_driver_category_draft CHECK (selected_vehicle_category IS NULL OR selected_vehicle_category IN
    ('TWO_WHEELER','THREE_WHEELER','FOUR_WHEELER','MINI_TRUCK','PICKUP_TRUCK'));

-- Preserve approved historical accounts. Pending/rejected/suspended onboarding must meet v2.
UPDATE drivers SET profile_version = 2 WHERE approval_status <> 'APPROVED';
-- All accounts inserted after rollout require v2 completeness.
ALTER TABLE drivers ALTER COLUMN profile_version SET DEFAULT 2;

-- Verified identity remains protected even when a caller has column-level grants.
CREATE FUNCTION guard_driver_profile_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (ROW(NEW.profile_name, NEW.date_of_birth, NEW.driving_license_ciphertext,
          NEW.licence_expires_on, NEW.licence_vehicle_classes) IS DISTINCT FROM
      ROW(OLD.profile_name, OLD.date_of_birth, OLD.driving_license_ciphertext,
          OLD.licence_expires_on, OLD.licence_vehicle_classes)) AND
     (SELECT status IN ('IN_REVIEW','VERIFIED') FROM kyc_applications
      WHERE driver_id=OLD.id ORDER BY created_at DESC, id DESC LIMIT 1) THEN
    RAISE EXCEPTION 'PROFILE_CHANGE_REQUIRES_REVIEW' USING ERRCODE='23514';
  END IF;
  IF OLD.profile_version=2 AND NEW.profile_version<>2 THEN
    RAISE EXCEPTION 'PROFILE_CONTRACT_DOWNGRADE_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_driver_profile_identity BEFORE UPDATE ON drivers
FOR EACH ROW EXECUTE FUNCTION guard_driver_profile_identity();
