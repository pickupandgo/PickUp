CREATE TABLE delivery_proofs (
  id UUID PRIMARY KEY,
  payment_trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  engine_trip_id UUID NOT NULL,
  engine_stop_id UUID NOT NULL,
  sequence SMALLINT NOT NULL CHECK (sequence > 0),
  owner_subject VARCHAR(128) NOT NULL,
  key VARCHAR(500) NOT NULL UNIQUE,
  content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  checksum_sha256 VARCHAR(64),
  storage_version_id VARCHAR(1024),
  storage_etag VARCHAR(200),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ(6),
  CHECK (verified_at IS NULL OR (checksum_sha256 IS NOT NULL AND storage_version_id IS NOT NULL AND storage_etag IS NOT NULL))
);
CREATE INDEX delivery_proofs_payment_trip_id_sequence_idx ON delivery_proofs(payment_trip_id, sequence);
