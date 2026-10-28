-- PostgreSQL requires newly-added enum values to be committed before they are used by
-- subsequent schema statements. Keep this as a separate additive migration.
ALTER TYPE vehicle_document_status ADD VALUE IF NOT EXISTS 'UPLOADING' BEFORE 'QUARANTINED';
ALTER TYPE vehicle_document_status ADD VALUE IF NOT EXISTS 'SCAN_FAILED' AFTER 'QUARANTINED';
