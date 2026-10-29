# Admin API — Batch 1: identity and secure onboarding

This document is the integration contract for the first admin-backend batch. It describes only
implemented endpoints in the backend branch that contains it. It does not enable Manual KYC,
create an administrator, or grant access by itself.

## Authentication contract

The admin web application must authenticate with the same Firebase project as MultipleRide's
mobile applications. For every protected request it obtains a current Firebase ID token and sends:

```http
Authorization: Bearer <Firebase ID token>
```

The backend verifies the token's signature, issuer, audience and expiry. It then resolves the
configured Firebase provider and subject through `auth_identities`, loads the PostgreSQL user,
requires `users.status = ACTIVE`, and requires `users.role = ADMIN` for every endpoint below.
The backend never accepts an admin role, backend user ID, Firebase subject, or document ownership
claim from the request body or query string.

Use `401` for a missing/malformed/invalid token and `403` for a valid identity that is unregistered,
disabled, or not an administrator. Do not call internal endpoints or send `X-Internal-Api-Key`
from the browser.

## Admin session

### `GET /v1/admin/session`

Requires `ADMIN`. This is the frontend's authoritative post-Firebase sign-in check. It neither
creates an account nor creates a server-side login session.

Successful response:

```json
{
  "userId": "uuid",
  "role": "ADMIN",
  "authenticatedAt": "2026-10-28T10:00:00.000Z",
  "signInProvider": "phone"
}
```

`authenticatedAt` and `signInProvider` may be `null`. The response intentionally excludes phone
numbers, Firebase subjects, identity-provider email, and database status fields.

## Manual KYC and vehicle review

All routes in this section require `ADMIN`. They are implemented by the existing onboarding state
machine and must be called in this order:

1. Read the review queue: `GET /v1/admin/onboarding/drivers?approvalStatus=<status>&limit=<1..100>`.
2. Read one driver and all reviewable evidence: `GET /v1/admin/onboarding/drivers/:driverId`.
3. Obtain a short-lived evidence URL only when necessary:
   `GET /v1/admin/onboarding/documents/KYC/:documentId/download` or
   `GET /v1/admin/onboarding/documents/VEHICLE/:documentId/download`.
4. Review each required clean document:
   `PATCH /v1/admin/onboarding/documents/:kind/:documentId/review` with
   `{ "decision": "VERIFIED" | "REJECTED", "reason": "3-1000 characters" }`.
5. Either request KYC correction/reject it:
   `PATCH /v1/admin/onboarding/kyc/:applicationId/review` with
   `{ "decision": "REJECTED" | "NEEDS_CORRECTION", "reason": "3-1000 characters" }`,
   or verify it after every required document is verified:
   `PATCH /v1/admin/onboarding/kyc/:applicationId/verify` with
   `{ "legalName": "3-120 characters", "reason": "3-1000 characters", "checklist": { "<configured item>": true } }`.
6. Review the vehicle only after its required documents are verified:
   `PATCH /v1/admin/onboarding/vehicles/:vehicleId/review` with
   `{ "decision": "IN_REVIEW" | "VERIFIED" | "REJECTED", "reason": "3-1000 characters" }`.
7. Make the final driver decision only after backend eligibility prerequisites hold:
   `PATCH /v1/admin/onboarding/drivers/:driverId/decision` with
   `{ "decision": "APPROVE" | "REJECT" | "CORRECTION" | "SUSPEND", "reason": "3-1000 characters" }`.

The backend returns `409` for invalid or stale state transitions, `404` for an unavailable document
or absent resource, and standard validation errors for malformed DTOs. It records administrative
decisions in `admin_actions` inside the relevant transaction.

### Evidence and GuardDuty rules

The web client must never construct S3 object URLs. A download response has a temporary URL and an
`expiresInSeconds` value. It is available only for the exact stored object version after the backend
has recorded a trusted clean scan. The browser must not cache, persist, or share that URL.

`QUARANTINED` plus a recorded scan is the state in which evidence becomes reviewable; it is not an
identity-verification decision. `VERIFIED` evidence, the configured KYC checklist, the configured
policy version, and a separate authorized KYC decision are all required. Final driver approval is a
separate backend decision after verified KYC, vehicle, documents, profile, active user account, and
no blocking compliance state.

The EventBridge/GuardDuty callback is not an admin endpoint and must never be called by the admin
panel. Its shared delivery secret is runtime-only.

## Manual-KYC staging configuration

Keep `MANUAL_KYC_ENABLED=false` until all of the following have been reviewed and tested in staging:

- An approved `MANUAL_KYC_POLICY_VERSION` matching `^[A-Za-z0-9._-]{1,50}$`.
- Non-empty, unique uppercase identifiers (`^[A-Z][A-Z0-9_]{1,39}$`) in
  `MANUAL_KYC_REQUIRED_DOCUMENTS`, `MANUAL_KYC_CHECKLIST`, and `VEHICLE_REQUIRED_DOCUMENTS`.
- Private versioned S3-compatible storage and `DOCUMENT_STORAGE_*` runtime secrets.
- An enabled scanner: GuardDuty needs `DOCUMENT_SCANNER_PROVIDER=guardduty`, matching storage and
  GuardDuty region, account ID, and the EventBridge delivery token. The token is not a browser
  configuration value.
- Bucket privacy, encryption, least-privilege IAM, GuardDuty Malware Protection for S3, EventBridge
  delivery, and a tested failure/DLQ path as documented in `AWS_GUARDDUTY_S3.md`.

Configuration validation fails closed when manual KYC is enabled without the policy, private storage,
or scanning. Document labels are policy identifiers; this repository does not define a legal document
policy for the business.

## Administrator provisioning and revocation

There is no public administrator-registration API. The only supported path is the privileged,
audited ops CLI using an owner/migrator database connection from an approved operator environment.
Never place that connection string in the web application or runtime API role.

Before provisioning, obtain explicit business authorization and independently verify the intended
person's Firebase subject and E.164 phone through the identity-management process. Record the
approval/ticket reference as the required reason. The CLI is idempotent only when the exact active
ADMIN user already has the exact configured-provider subject; it never re-links identities or
promotes an existing customer or driver.

```text
npm run build
npm run provision -- create-admin --phone <E.164> --subject <Firebase UID> --reason "<approved ticket>"
```

This records `ADMIN_PROVISIONED` in `admin_actions`. Do not execute it for a live identity without
separate explicit authorization.

To revoke backend access after an approved incident/change decision:

```text
npm run provision -- suspend-admin --phone <E.164> --reason "<approved ticket>"
```

This records `ADMIN_SUSPENDED` and sets `users.status = SUSPENDED`. `PrincipalService` checks that
status on every authenticated request, so a previously minted Firebase token no longer authorizes
backend operations. Repeating either completed provisioning or suspension is safe and does not
create a duplicate account or audit action. Reactivation is deliberately not provided by this CLI;
it requires a separate reviewed access-restoration process.

## OpenAPI and frontend use

When `SWAGGER_ENABLED=true` in a non-production secured environment, the generated specification is
available at `/docs/openapi.json` and UI at `/docs`. Production Swagger should remain disabled unless
its exposure has been separately approved. Admin endpoints are tagged `admin`.

The frontend needs only the backend base URL and its Firebase public configuration. It must not use
database credentials, AWS credentials, GuardDuty delivery secrets, or backend internal API keys.

## Frontend coordination required

The current mock admin-panel login contract is not compatible with this backend. The backend does
not implement, and must not be given, an email/password admin-login endpoint or a custom backend
JWT. The frontend must use Firebase Web Auth, obtain a current Firebase ID token, and call
`GET /v1/admin/session` before rendering protected admin functionality. The session response does
not contain a backend token, email, display name, phone number, or Firebase subject.

The existing mock UI must also map its display statuses to backend enums rather than submit its
lowercase mock values. In particular, the onboarding API uses KYC application statuses
`PENDING`, `IN_REVIEW`, `VERIFIED`, `REJECTED`, `NEEDS_CORRECTION`, `EXPIRED`, and
`PROVIDER_UNAVAILABLE`; vehicle statuses `DRAFT`, `SUBMITTED`, `IN_REVIEW`, `VERIFIED`,
`REJECTED`, and `INACTIVE`; and final driver decisions `APPROVE`, `REJECT`, `CORRECTION`, and
`SUSPEND`. The admin panel must treat backend responses as authoritative and display unsupported
states rather than fabricate a local result.

## Unsupported in Batch 1

- Customer/driver/vehicle general list APIs outside the onboarding review queue.
- Booking administration beyond the existing failed-stop resolution API.
- Live engine operations, reports, dashboard aggregates, audit-log browsing, and driver-instruction
  management.
- Any public or browser-driven admin provisioning, reactivation, or direct database access.
