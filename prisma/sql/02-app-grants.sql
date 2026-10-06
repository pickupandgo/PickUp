-- Table privileges for the API role (mr_app). Run as mr_migrator AFTER `prisma migrate deploy`.
-- Re-run (and extend) whenever a migration adds tables or columns the API needs.
--
--   psql "<mr_migrator url>" -f prisma/sql/02-app-grants.sql
--
-- Principles:
--   - No DELETE or TRUNCATE on anything.
--   - The wallet ledger is INSERT-only (the immutability triggers are a second line of defence).
--   - UPDATE is granted per column, so the API can never rewrite amounts, owners or purposes.

\set ON_ERROR_STOP on

-- Identity is read-only for the API (provisioning runs as mr_migrator).
GRANT SELECT ON users, auth_identities, drivers TO mr_app;

-- Wallets: created lazily by the API; only balance/status bookkeeping columns may change.
GRANT SELECT, INSERT ON driver_wallets TO mr_app;
GRANT UPDATE (balance_paise, version, status, updated_at) ON driver_wallets TO mr_app;

-- Ledger: append-only.
GRANT SELECT, INSERT ON driver_wallet_transactions TO mr_app;

-- Payments: amount, owner, purpose and idempotency key are immutable for the API.
GRANT SELECT, INSERT ON payments TO mr_app;
GRANT UPDATE (status, razorpay_order_id, razorpay_payment_id, payment_method, updated_at) ON payments TO mr_app;

-- Webhook events: payload and event id are immutable for the API.
GRANT SELECT, INSERT ON payment_events TO mr_app;
GRANT UPDATE (payment_id, outcome, attempts, processed_at, processing_error) ON payment_events TO mr_app;

-- Customers are provisioned by ops tooling (mr_migrator), like users and drivers.
GRANT SELECT ON customers TO mr_app;

-- Bookings: registered by the trip engine through the API. Fare, payment method, fee rule and
-- customer are immutable (no column grant, and a trigger as a second line of defence).
GRANT SELECT, INSERT ON bookings TO mr_app;
GRANT UPDATE (status, payment_status, completed_at, cancelled_at, cancellation_reason, updated_at)
    ON bookings TO mr_app;

-- Trips: booking and driver are immutable; only lifecycle columns change.
GRANT SELECT, INSERT ON trips TO mr_app;
GRANT UPDATE (status, arrived_at, pickup_verified_at, started_at, delivered_at, payment_confirmed_at,
              completed_at, cancelled_at, updated_at)
    ON trips TO mr_app;

-- Fee rules: versioned. Only the closing / deactivation fields can change.
GRANT SELECT, INSERT ON fee_rules TO mr_app;
GRANT UPDATE (effective_to, active, deactivated_at, deactivated_by_user_id, deactivation_reason)
    ON fee_rules TO mr_app;

-- Collections: amount, method, fee and ledger link are immutable.
GRANT SELECT, INSERT ON payment_collections TO mr_app;
GRANT UPDATE (status, provider_order_id, provider_payment_id, payment_method, completed_at,
              failure_reason, updated_at)
    ON payment_collections TO mr_app;

-- Merchant settlements: append-only facts from Razorpay settlement reconciliation.
GRANT SELECT, INSERT ON payment_settlements TO mr_app;

-- Tax rules: read-only for the API. Versions are added by ops tooling after CA approval, so no
-- API caller can ever create or change a TDS rate.
GRANT SELECT ON tax_rules TO mr_app;

-- Earnings: amounts, deductions and sources are immutable; only the settlement link (set once)
-- and the payout lifecycle columns change.
GRANT SELECT, INSERT ON driver_earnings TO mr_app;
GRANT UPDATE (status, payment_settlement_id, payable_at, hold_reason, held_at, held_by_user_id,
              paid_at, updated_at)
    ON driver_earnings TO mr_app;

-- Bank accounts: the beneficiary details are immutable; only verification state changes.
GRANT SELECT, INSERT ON driver_bank_accounts TO mr_app;
GRANT UPDATE (status, verified_at, verified_by_user_id, verification_reference,
              approved_verification_id, name_match_resolution, status_reason,
              status_changed_by_user_id, updated_at)
    ON driver_bank_accounts TO mr_app;

-- Bank validations: which account, provider id and requester are immutable; the provider's result
-- is written once (a trigger makes finished results final).
GRANT SELECT, INSERT ON bank_account_verifications TO mr_app;
GRANT UPDATE (status, account_status, registered_name, name_match_score, name_match_result,
              compared_name, utr, failure_reason, completed_at, updated_at)
    ON bank_account_verifications TO mr_app;

-- Payout batches, payouts and items: amounts and members are immutable.
GRANT SELECT, INSERT ON payout_batches TO mr_app;
GRANT UPDATE (status, executed_at, completed_at, updated_at) ON payout_batches TO mr_app;

GRANT SELECT, INSERT ON driver_payouts TO mr_app;
GRANT UPDATE (status, provider_payout_id, provider_status, utr, failure_reason, attempts,
              last_attempt_at, submitted_at, processed_at, failed_at, reversed_at, updated_at)
    ON driver_payouts TO mr_app;

GRANT SELECT, INSERT ON payout_items TO mr_app;
GRANT UPDATE (status, updated_at) ON payout_items TO mr_app;

-- Payout webhook events: payload and event id are immutable for the API.
GRANT SELECT, INSERT ON payout_events TO mr_app;
GRANT UPDATE (payout_id, outcome, attempts, processed_at, processing_error) ON payout_events TO mr_app;

-- Disputes: the provider status moves; which payment and booking it is about never changes.
GRANT SELECT, INSERT ON payment_disputes TO mr_app;
GRANT UPDATE (status, amount_paise, reason_code, updated_at) ON payment_disputes TO mr_app;

-- Admin audit trail: append-only (a trigger also blocks UPDATE, DELETE and TRUNCATE).
GRANT SELECT, INSERT ON admin_actions TO mr_app;
