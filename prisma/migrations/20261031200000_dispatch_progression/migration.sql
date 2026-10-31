ALTER TABLE "engine_bookings" ADD COLUMN "search_exhausted_at" TIMESTAMPTZ(6);
CREATE INDEX "idx_engine_dispatch_pending" ON "engine_bookings" ("updated_at", "id")
  WHERE status = 'OPEN'::engine_booking_status AND search_exhausted_at IS NULL;
