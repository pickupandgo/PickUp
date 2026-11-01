-- Latest GPS fix only: no location history or financial data. Shared by Engine instances.
CREATE TABLE engine_driver_positions (
  subject VARCHAR(128) PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy DOUBLE PRECISION NOT NULL CHECK (accuracy BETWEEN 0 AND 100),
  captured_at BIGINT NOT NULL CHECK (captured_at > 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_engine_driver_positions_captured ON engine_driver_positions(captured_at);
