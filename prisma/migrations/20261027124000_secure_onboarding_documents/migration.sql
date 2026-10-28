ALTER TABLE kyc_applications
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN policy_version VARCHAR(50),
  ADD COLUMN verification_checklist JSONB;

ALTER TABLE drivers ADD COLUMN profile_name VARCHAR(120);

CREATE TABLE kyc_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL REFERENCES kyc_applications(id) ON DELETE RESTRICT,
 document_type VARCHAR(40) NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 storage_key VARCHAR(500) NOT NULL UNIQUE, content_type VARCHAR(100) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes > 0), checksum_sha256 VARCHAR(64) CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$'),
 status vehicle_document_status NOT NULL DEFAULT 'UPLOADING', rejection_reason TEXT,
 uploaded_at TIMESTAMPTZ, scanned_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ,
 reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT uq_kyc_document_version UNIQUE(application_id,document_type,version)
);
CREATE INDEX idx_kyc_documents_application_type ON kyc_documents(application_id,document_type);

ALTER TABLE vehicle_documents
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN checksum_sha256 VARCHAR(64),
  ADD COLUMN uploaded_at TIMESTAMPTZ,
  ADD COLUMN scanned_at TIMESTAMPTZ,
  ADD CONSTRAINT uq_vehicle_documents_storage_key UNIQUE(storage_key),
  ADD CONSTRAINT uq_vehicle_document_version UNIQUE(vehicle_id,document_type,version),
  ADD CONSTRAINT ck_vehicle_document_checksum CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$');
