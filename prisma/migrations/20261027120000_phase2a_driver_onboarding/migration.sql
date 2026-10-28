CREATE TYPE kyc_application_status AS ENUM ('PENDING','IN_REVIEW','VERIFIED','REJECTED','NEEDS_CORRECTION','EXPIRED','PROVIDER_UNAVAILABLE');
CREATE TYPE vehicle_verification_status AS ENUM ('DRAFT','SUBMITTED','IN_REVIEW','VERIFIED','REJECTED','INACTIVE');
CREATE TYPE vehicle_document_status AS ENUM ('QUARANTINED','VERIFIED','REJECTED','STORAGE_UNAVAILABLE');
CREATE TYPE vehicle_change_status AS ENUM ('PENDING','APPROVED','REJECTED','CANCELLED');

CREATE TABLE kyc_applications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
 provider VARCHAR(40) NOT NULL, provider_reference VARCHAR(150) UNIQUE, status kyc_application_status NOT NULL DEFAULT 'PENDING',
 rejection_reason TEXT, expires_at TIMESTAMPTZ, verified_at TIMESTAMPTZ, last_provider_payload JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kyc_driver_created ON kyc_applications(driver_id, created_at DESC);
CREATE TABLE kyc_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL REFERENCES kyc_applications(id) ON DELETE RESTRICT,
 provider_event_id VARCHAR(150) NOT NULL UNIQUE, event_type VARCHAR(80) NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
 payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE vehicles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
 category VARCHAR(30) NOT NULL CHECK (category IN ('TWO_WHEELER','THREE_WHEELER','FOUR_WHEELER','MINI_TRUCK','PICKUP_TRUCK')),
 registration_number VARCHAR(30) NOT NULL, make_model VARCHAR(100) NOT NULL,
 status vehicle_verification_status NOT NULL DEFAULT 'DRAFT', active BOOLEAN NOT NULL DEFAULT false,
 verified_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ, reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
 rejection_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT uq_vehicles_driver_registration UNIQUE(driver_id, registration_number)
);
CREATE UNIQUE INDEX uq_vehicles_one_active_per_driver ON vehicles(driver_id) WHERE active;
CREATE INDEX idx_vehicles_driver_active ON vehicles(driver_id, active);
CREATE TABLE vehicle_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
 document_type VARCHAR(40) NOT NULL, storage_key VARCHAR(500), content_type VARCHAR(100), size_bytes INTEGER,
 status vehicle_document_status NOT NULL DEFAULT 'STORAGE_UNAVAILABLE', rejection_reason TEXT,
 reviewed_at TIMESTAMPTZ, reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((storage_key IS NULL) = (content_type IS NULL)), CHECK (size_bytes IS NULL OR size_bytes > 0)
);
CREATE INDEX idx_vehicle_documents_vehicle_type ON vehicle_documents(vehicle_id, document_type);
CREATE TABLE vehicle_change_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
 current_vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT, replacement_vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
 status vehicle_change_status NOT NULL DEFAULT 'PENDING', reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ,
 CHECK (current_vehicle_id <> replacement_vehicle_id)
);
CREATE UNIQUE INDEX uq_vehicle_change_one_pending_per_driver ON vehicle_change_requests(driver_id) WHERE status = 'PENDING';
CREATE INDEX idx_vehicle_changes_driver_status ON vehicle_change_requests(driver_id,status);
