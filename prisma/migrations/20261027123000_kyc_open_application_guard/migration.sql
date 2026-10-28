-- Corrective additive migration. The original Phase 2A migration may already be applied in a
-- persistent environment, so its history is deliberately left immutable.
CREATE UNIQUE INDEX uq_kyc_one_open_per_driver
  ON kyc_applications(driver_id)
  WHERE status IN ('PENDING', 'IN_REVIEW', 'PROVIDER_UNAVAILABLE');
