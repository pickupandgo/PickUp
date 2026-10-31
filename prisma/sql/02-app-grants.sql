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
GRANT UPDATE (profile_name, updated_at) ON drivers TO mr_app;

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

-- Customers: only editable profile columns may change. Self-registration goes through register_customer(), a
-- SECURITY DEFINER function that can only create CUSTOMER accounts and never re-links a phone.
GRANT SELECT ON customers TO mr_app;
GRANT UPDATE (name, email, age, address, updated_at) ON customers TO mr_app;
GRANT EXECUTE ON FUNCTION register_customer(TEXT, TEXT, TEXT, TEXT, TEXT) TO mr_app;

-- Drivers: self-registration goes through register_driver(), a SECURITY DEFINER function
-- that creates a DRIVER user with PENDING approval status, vehicle details, licence details and wallet.
GRANT EXECUTE ON FUNCTION register_driver(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO mr_app;
GRANT EXECUTE ON FUNCTION admin_set_driver_legal_name_after_kyc(UUID, UUID, UUID, TEXT) TO mr_app;
GRANT EXECUTE ON FUNCTION admin_set_driver_status(UUID, TEXT, UUID, TEXT) TO mr_app;

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

-- Bank-account change requests (step-up): owner, method and the step-up window (created_at,
-- expires_at, both set by the database) are never writable; the step-up evidence is written once
-- and checked by a trigger (sign-in after the request, the driver's registered phone).
GRANT SELECT, INSERT ON bank_account_change_requests TO mr_app;
GRANT UPDATE (status, step_up_auth_time, step_up_phone, close_reason, updated_at)
    ON bank_account_change_requests TO mr_app;

-- Bank accounts: the beneficiary details and the change request that added them are immutable;
-- only verification state changes.
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

-- Fare module. Pricing versions are versioned like fee rules: only closing and deactivation
-- fields change. Quotes and their stops are written once by the server; a quote's only change is
-- being redeemed by a booking (set once, triggers check it).
GRANT SELECT, INSERT ON pricing_versions TO mr_app;
GRANT UPDATE (effective_to, active, deactivated_at, deactivated_by_user_id, deactivation_reason)
    ON pricing_versions TO mr_app;
GRANT SELECT, INSERT ON fare_quotes TO mr_app;
GRANT UPDATE (redeemed_at) ON fare_quotes TO mr_app;
GRANT SELECT, INSERT ON fare_quote_stops TO mr_app;

-- Booking stops: written once at registration with amounts copied from the quote (triggers); the
-- amounts never change (no column grant). The stop lifecycle writes the status and the facts of
-- each transition; guard_booking_stop_update checks every move. A drop's payment is confirmed
-- (payment_confirmed_at) only together with a completed collection for that drop (payment flow
-- Phase 4: the stop guard and a deferred check on payment_collections).
GRANT SELECT, INSERT ON booking_stops TO mr_app;
GRANT UPDATE (status, arrived_at, payment_confirmed_at, delivered_at, failed_at, failure_reason,
              cancelled_at, resolved_at, resolved_by_user_id, resolution_reason, updated_at)
    ON booking_stops TO mr_app;

-- Earning collections: the collections that fund each earning, written once with the earning
-- (triggers check them against the collections and the earning); never updated or deleted.
GRANT SELECT, INSERT ON earning_collections TO mr_app;

-- Settlement findings: settled payments that matched nothing of ours, or another amount. Recorded
-- once; seeing one again only counts it (a trigger refuses any other change); never deleted.
GRANT SELECT, INSERT ON settlement_findings TO mr_app;
GRANT UPDATE (occurrences, last_seen_at) ON settlement_findings TO mr_app;

-- Admin audit trail: append-only (a trigger also blocks UPDATE, DELETE and TRUNCATE).
GRANT SELECT, INSERT ON admin_actions TO mr_app;

-- Refunds (payment flow Phase 6): requested by an admin through the API. The booking, source,
-- kind, amount, reason, requester and fee decision are immutable (no column grant, and a trigger
-- as a second line of defence); only the provider lifecycle and an admin's cancellation are
-- written. payment_collections.refunded_paise has no grant: a SECURITY DEFINER trigger keeps it
-- equal to the collection's completed refunds.
GRANT SELECT, INSERT ON payment_refunds TO mr_app;
GRANT UPDATE (status, provider_refund_id, provider_status, provider_reference, failure_reason,
              submit_attempts, last_submitted_at, completed_at, failed_at, cancelled_at,
              cancelled_by_user_id, cancellation_reason, updated_at)
    ON payment_refunds TO mr_app;

-- Phase 2A onboarding records. Identity and reviewer decisions remain immutable by convention;
-- the API may update only lifecycle/review fields.
GRANT SELECT, INSERT ON kyc_applications, kyc_events, kyc_documents, vehicles, vehicle_documents, vehicle_change_requests, document_scan_events TO mr_app;
GRANT UPDATE (status, rejection_reason, expires_at, verified_at, reviewed_at, reviewed_by_user_id, policy_version, verification_checklist, last_provider_payload, updated_at) ON kyc_applications TO mr_app;
GRANT UPDATE (status, rejection_reason, checksum_sha256, storage_version_id, storage_etag, guardduty_scan_event_id, uploaded_at, scanned_at, reviewed_at, reviewed_by_user_id) ON kyc_documents TO mr_app;
GRANT UPDATE (category, registration_number, make_model, status, active, verified_at, reviewed_at, reviewed_by_user_id, rejection_reason, updated_at) ON vehicles TO mr_app;
GRANT UPDATE (status, rejection_reason, checksum_sha256, storage_version_id, storage_etag, guardduty_scan_event_id, uploaded_at, scanned_at, reviewed_at, reviewed_by_user_id) ON vehicle_documents TO mr_app;
GRANT UPDATE (document_kind, document_id, outcome, processed_at) ON document_scan_events TO mr_app;
GRANT UPDATE (status, resolved_at) ON vehicle_change_requests TO mr_app;

-- Driver self-profile. Trusted legal_name/approval fields remain function-only.
GRANT UPDATE (profile_name, profile_version, email, date_of_birth, gender,
  residential_address, city, state, pin_code, selected_vehicle_category,
  driving_license_ciphertext, driving_license_last4, licence_expires_on,
  licence_vehicle_classes, updated_at) ON drivers TO mr_app;

-- Chat and push storage (apply after migration 20261031210000).
GRANT SELECT, INSERT ON chat_messages, device_tokens, notification_preferences TO mr_app;
GRANT UPDATE(status, read_at, updated_at) ON chat_messages TO mr_app;
GRANT UPDATE(token, role, platform, language, is_active, last_seen_at, updated_at) ON device_tokens TO mr_app;
GRANT UPDATE(push_enabled, sound_enabled, language, updated_at) ON notification_preferences TO mr_app;

-- Persisted notification inbox (after 20261031220000).
GRANT SELECT, INSERT ON inbox_notifications TO mr_app;
GRANT UPDATE(read_at) ON inbox_notifications TO mr_app;
