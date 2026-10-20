-- Settlement-gated driver earnings (OPEN_DECISIONS D-45): an ONLINE earning now waits for
-- Razorpay's merchant settlement to Nikhil Enterprises before it becomes PAYABLE.
--
-- This migration only adds the enum value. PostgreSQL cannot use a value added by
-- ALTER TYPE ... ADD VALUE inside the transaction that added it, and the next migration
-- (20261007120100) uses it in CHECK constraints, triggers and a data correction.
ALTER TYPE "earning_status" ADD VALUE IF NOT EXISTS 'AWAITING_SETTLEMENT' BEFORE 'PAYABLE';
