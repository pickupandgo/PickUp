# M02 Customer Profile API

Firebase supplies identity; PostgreSQL supplies account ownership, role/status and saved profile.

## Contract

- POST /v1/customers/me: existing body-free, verified-phone registration/bootstrap. Repeated
  registration preserves all saved profile fields.
- PATCH /v1/customers/me: Firebase bearer token, ACTIVE registered CUSTOMER only. Accepts only
  name, email, age, address; unknown fields are HTTP 400.
- GET /v1/customers/me: returns the same persisted profile.

All PATCH fields are optional. Omission preserves the value. Empty PATCH is an ownership-checked
no-op. Only age/address accept null, explicitly clearing them.

| Field | Accepted value |
| --- | --- |
| name | Nonblank trimmed string, max 120 characters; null rejected |
| email | Valid trimmed email, max 255 characters; null rejected |
| age | Integer 1–120, or null; numeric strings rejected |
| address | Nonblank trimmed string, max 500 characters, or null |

Example synthetic PATCH:
{"name":"Synthetic Customer","email":"test@example.com","age":29,"address":"Synthetic address"}

Response retains customerId, phone, status, createdAt, name, email and adds age:number|null,
address:string|null. UID, phone, roles, status and ownership cannot be changed.
Unauthenticated requests return 401; non-CUSTOMER/disabled accounts return 403.
Database failures never return a successful save.

**Client coordination:** the published Customer App still uses POST for profile saving.
Its M02 developer must call PATCH for edits and read persisted age/address from GET.
POST remains registration, not profile editing. Customer App source is unchanged by this release.

## Additive migrations

1. 20261030180000_customer_editable_profile: nullable age/address with database checks.
2. 20261030180100_preserve_customer_profile_on_registration: same registration function signature,
   validations, uniqueness, role separation, disabled checks, idempotency, SECURITY DEFINER,
   search_path and existing privileges. Only the existing-profile overwrite is removed.

Existing migrations are unchanged. The future mr_app grants script permits UPDATE on
name/email/age/address/updated_at only. Ownership columns remain protected.
The temporary Render database currently uses its existing owner role; mr_app/mr_migrator do not
exist. Do not execute that grants script there. Owner-level runtime access is a synthetic-staging
exception, not a production permissions design.

## Release and acceptance

Verify live service configuration, database identity, migration history/checksums, permissions and
active Manual KYC/STAGING_KYC_V1. Use focused tests on an isolated disposable database. Review
diff/secrets, make one focused commit, fetch/reconcile and fast-forward push raj_backend.
Keep Auto-Deploy off. Run Prisma migrate status/deploy/status explicitly on verified staging
before deploying the exact commit. Expect 27 applied, zero pending/failed, unchanged existing
records. Never reset/recreate anything; stop on migration failure.

Deploy only existing pickup-backend-engine-v2 and preserve all environment values.
Check health/live, health/ready, live SHA via Render metadata, and unauthenticated PATCH 401.
Authenticated acceptance requires a real Customer Firebase token supplied locally in memory:
PATCH → GET → PostgreSQL read verification → repeated POST → GET.
Without that token, live authenticated acceptance is BLOCKED, not passed.

Focused tests: customer DTO/controller/service, existing registration, customer-profile integration;
Prisma validation/generation, backend typecheck/build and changed-file lint. Integration tests reset
ONLY a disposable database with a name ending _test; never point them at Render.
Restricted-role coverage proves profile-column permissions work and ownership updates fail.
Synthetic signing keys are isolated test fixtures, not a production authentication bypass.
