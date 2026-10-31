-- Additive informational fields; no money/identity/OTP changes.
ALTER TABLE "engine_bookings" ADD COLUMN "metadata" JSONB;
ALTER TABLE "engine_stops" ADD COLUMN "instructions" VARCHAR(1000);
