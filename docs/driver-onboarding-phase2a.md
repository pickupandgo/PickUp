# Driver onboarding Phase 2A

The backend is authoritative for profile completion, KYC, vehicle verification, final approval,
suspension, and dispatch eligibility. Mobile state and AsyncStorage are never verification proof.

## Activation requirements

Manual KYC stays disabled unless all of these are configured:

- `MANUAL_KYC_ENABLED=true`
- an approved `MANUAL_KYC_POLICY_VERSION`
- explicit `MANUAL_KYC_REQUIRED_DOCUMENTS` and `MANUAL_KYC_CHECKLIST` identifiers
- explicit `VEHICLE_REQUIRED_DOCUMENTS`
- a private S3-compatible bucket and credentials (`DOCUMENT_STORAGE_*`)
- either the legacy authenticated HTTP scanner or the configured GuardDuty S3 integration

Production storage and scanner endpoints must use HTTPS. The bucket must block public access,
enforce encryption, restrict the service identity to the onboarding prefix, and have retention and
deletion rules approved by the privacy/compliance owner. Credentials are runtime secrets only.
For GuardDuty activation, follow [`AWS_GUARDDUTY_S3.md`](AWS_GUARDDUTY_S3.md): its event path
only marks the exact version of an object clean after checking GuardDuty's managed tag with AWS
credentials.

The scanner receives an authenticated JSON request containing a short-lived private download URL,
the backend-computed SHA-256, byte size, and declared MIME type. It must return:

```json
{ "result": "CLEAN", "detectedContentType": "image/jpeg", "sha256": "<64 hex>" }
```

`result` is `CLEAN` or `INFECTED`. A missing/mismatched digest or detected content type fails
closed. Documents remain quarantined until a clean result, and remain untrusted until an admin
reviews them.

## API contracts

Driver routes are under `/v1/drivers/me/onboarding`; they derive ownership from the verified
Firebase identity. Admin routes are under `/v1/admin/onboarding` and require an authoritative
`ADMIN` account. Document retrieval returns only short-lived private URLs to admins.

The engine-facing eligibility endpoints are:

```text
GET /v1/internal/drivers/:driverId/eligibility
GET /v1/internal/drivers/by-subject/:firebaseSubject/eligibility
X-Internal-Api-Key: <rotatable internal key>
X-Request-Id: <trace id>
```

Both routes are internal-only. The UUID route is retained for backend-to-backend callers. The
subject route resolves the Firebase identity through `auth_identities` under the configured
provider, returns the authoritative backend `driverId`, echoes the requested `subject`, and then
uses the same eligibility rules. It exists because the engine stores the verified Firebase
subject, not a client-supplied backend driver UUID.

The engine must treat the response as authoritative and fail closed on all errors or malformed
answers. Phase 2B calls the subject route before ONLINE, before an offer, and again under the
booking lock immediately before assignment. No eligibility response is cached; an ineligible
response removes the driver from local future dispatch without cancelling an active trip.

## Compatibility

The normalized `vehicles` and `vehicle_documents` tables are authoritative for onboarding and
eligibility. Legacy vehicle columns on `drivers` remain for compatibility but do not grant
eligibility. Approved identity-critical vehicle fields are database- and service-locked; changes
must use the replacement workflow.

Future providers implement `KycProvider` and normalize their results into the existing KYC state
machine. No unauthenticated provider webhook endpoint is enabled in Phase 2A.
