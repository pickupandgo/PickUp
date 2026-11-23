-- Invoker trigger, no elevated function execution. Applied by the schema owner.
-- No data rewrites. Old verification facts may be read but never changed.
CREATE FUNCTION public.guard_delivery_proof_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.checksum_sha256 IS NOT NULL OR NEW.storage_version_id IS NOT NULL
       OR NEW.storage_etag IS NOT NULL OR NEW.verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'Delivery evidence must be inserted unverified' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.payment_trip_id,NEW.engine_trip_id,NEW.engine_stop_id,NEW.sequence,
           NEW.owner_subject,NEW.key,NEW.content_type,NEW.size_bytes,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.payment_trip_id,OLD.engine_trip_id,OLD.engine_stop_id,OLD.sequence,
           OLD.owner_subject,OLD.key,OLD.content_type,OLD.size_bytes,OLD.created_at) THEN
      RAISE EXCEPTION 'Delivery evidence binding is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.verified_at IS NOT NULL AND
       ROW(NEW.checksum_sha256,NEW.storage_version_id,NEW.storage_etag,NEW.verified_at)
       IS DISTINCT FROM
       ROW(OLD.checksum_sha256,OLD.storage_version_id,OLD.storage_etag,OLD.verified_at) THEN
      RAISE EXCEPTION 'Verified delivery evidence is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.verified_at IS NULL AND (NEW.checksum_sha256 IS NOT NULL
      OR NEW.storage_version_id IS NOT NULL OR NEW.storage_etag IS NOT NULL) THEN
    RAISE EXCEPTION 'Partial delivery verification receipt is forbidden' USING ERRCODE='23514';
  END IF;
  IF NEW.verified_at IS NOT NULL AND
     (NEW.checksum_sha256 IS NULL OR NEW.checksum_sha256 !~ '^[a-f0-9]{64}$'
      OR NEW.storage_version_id IS NULL OR length(NEW.storage_version_id)=0
      OR NEW.storage_etag IS NULL OR length(NEW.storage_etag)=0) THEN
    RAISE EXCEPTION 'Complete delivery verification receipt required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_delivery_proof_write() FROM PUBLIC;
CREATE TRIGGER delivery_proof_immutable_binding_and_receipt
BEFORE INSERT OR UPDATE ON public.delivery_proofs
FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_proof_write();
