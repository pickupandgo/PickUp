-- GuardDuty Malware Protection for S3 produces at-least-once, version-specific scan events.
-- Persist the immutable uploaded S3 version and an append-only event audit; no existing migration
-- is altered.
ALTER TABLE kyc_documents
  ADD COLUMN storage_version_id VARCHAR(1024),
  ADD COLUMN storage_etag VARCHAR(128),
  ADD COLUMN guardduty_scan_event_id VARCHAR(150);

ALTER TABLE vehicle_documents
  ADD COLUMN storage_version_id VARCHAR(1024),
  ADD COLUMN storage_etag VARCHAR(128),
  ADD COLUMN guardduty_scan_event_id VARCHAR(150);

CREATE INDEX idx_kyc_documents_storage_version
  ON kyc_documents(storage_key, storage_version_id);
CREATE INDEX idx_vehicle_documents_storage_version
  ON vehicle_documents(storage_key, storage_version_id);

CREATE TABLE document_scan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(150) NOT NULL,
  source VARCHAR(40) NOT NULL,
  aws_account_id CHAR(12) NOT NULL,
  region VARCHAR(80) NOT NULL,
  bucket VARCHAR(255) NOT NULL,
  object_key VARCHAR(500) NOT NULL,
  object_version_id VARCHAR(1024) NOT NULL,
  object_etag VARCHAR(128) NOT NULL,
  scan_status VARCHAR(40) NOT NULL,
  scan_result VARCHAR(40) NOT NULL,
  document_kind VARCHAR(20),
  document_id UUID,
  outcome VARCHAR(40) NOT NULL,
  detail JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_document_scan_events_event_id UNIQUE(event_id)
);
CREATE INDEX idx_document_scan_events_object_version
  ON document_scan_events(object_key, object_version_id);
CREATE INDEX idx_document_scan_events_document
  ON document_scan_events(document_kind, document_id, received_at DESC);
