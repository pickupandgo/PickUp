-- Payment flow Phase 4, part 1: the two enum values Phase 4 needs
-- (docs/PAYMENT_FLOW_FINAL_REVIEW.md, migration plan C.2).
--
--   booking_payment_status PARTIALLY_PAID: a booking priced per drop and paid at delivery, with
--   some but not all of its drops paid (UNPAID -> PARTIALLY_PAID -> PAID).
--   earning_settlement MIXED: an earning funded by cash and online collections together.
--
-- This migration only adds the values. PostgreSQL cannot use a value added by
-- ALTER TYPE ... ADD VALUE inside the transaction that added it, and the next migration
-- (20261018120100) uses both in its rules. No row uses them, and no row changes.
--
-- Rollback: down.sql in this folder (manual; Prisma ignores it).
ALTER TYPE "booking_payment_status" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID' AFTER 'UNPAID';
ALTER TYPE "earning_settlement" ADD VALUE IF NOT EXISTS 'MIXED';
