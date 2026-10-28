# Private onboarding documents: AWS S3 and GuardDuty

This runbook activates the existing backend integration. It does not authorize creating AWS
resources, enabling GuardDuty, or making a bucket public. Keep `MANUAL_KYC_ENABLED=false` until
every item below is complete and independently verified in staging.

## Backend configuration

Use runtime secrets (a deployment secret store, never git):

```text
DOCUMENT_STORAGE_PROVIDER=s3
DOCUMENT_STORAGE_REGION=<bucket-region>
DOCUMENT_STORAGE_BUCKET=<private-bucket>
DOCUMENT_STORAGE_ACCESS_KEY_ID=<least-privilege-runtime-key>
DOCUMENT_STORAGE_SECRET_ACCESS_KEY=<least-privilege-runtime-secret>
# DOCUMENT_STORAGE_ENDPOINT is blank for AWS S3; set only for a compatible endpoint.
DOCUMENT_STORAGE_FORCE_PATH_STYLE=false
DOCUMENT_SCANNER_PROVIDER=guardduty
GUARDDUTY_EVENT_TOKEN=<random-32+-character-API-destination-secret>
GUARDDUTY_AWS_ACCOUNT_ID=<12-digit-account-id>
GUARDDUTY_REGION=<same-as-DOCUMENT_STORAGE_REGION>
```

The parser refuses incomplete GuardDuty configuration or a region mismatch. AWS S3 uses the SDK
default endpoint when no endpoint is supplied. This implementation requires versioning and
S3-managed encryption (`AES256`).

## S3 and IAM requirements

- Block all public access; do not use public ACLs or permanent URLs.
- Enable bucket versioning and default SSE-S3 encryption.
- Restrict application object access to the `onboarding/` prefix. The backend runtime identity
  needs `s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion`, `s3:GetObjectTagging`, and the
  bucket actions necessary for `HeadObject`. It must not receive `s3:PutObjectTagging` for
  `GuardDutyMalwareScanStatus`.
- Give the GuardDuty Malware Protection service role the AWS-documented permissions to read the
  protected object versions, read/write tags, and manage its S3 notification/EventBridge setup.
  Scope the role to this bucket/prefix.
- Deny `s3:PutObjectTagging` for `GuardDutyMalwareScanStatus` except to GuardDuty's service role.
  Restrict GetObject/GetObjectVersion to backend/admin service identities. Mobile clients receive
  only short-lived, server-authorized URLs.

The backend independently checks the object version, ETag, byte size, document ID metadata,
encryption mode, and GuardDuty tag. An event or tag by itself is never enough.

## GuardDuty and EventBridge

1. Create a Malware Protection plan for this bucket and the `onboarding/` prefix in the bucket
   region. Enable object tagging.
2. Enable Amazon EventBridge delivery for the bucket/plan. GuardDuty result delivery is
   at-least-once; duplicate delivery is expected.
3. On the default EventBridge bus, add a rule matching:

```json
{
  "source": ["aws.guardduty"],
  "detail-type": ["GuardDuty Malware Protection Object Scan Result"],
  "detail": { "s3ObjectDetails": { "bucketName": ["<private-bucket>"] } }
}
```

4. Set its target to this EventBridge API Destination:

```text
POST https://<backend-host>/v1/onboarding/guardduty/events
x-multipleride-guardduty-token: <GUARDDUTY_EVENT_TOKEN>
```

Use an EventBridge Connection/API-key parameter for this header. Configure bounded retries and an
encrypted SQS dead-letter queue; alert on messages in it and on GuardDuty plan status errors. SQS
is the only additional AWS service recommended for durable API Destination failure recovery.

Only a `COMPLETED` / `NO_THREATS_FOUND` event for the exact recorded object version can advance a
document from waiting-for-scan quarantine. `THREATS_FOUND` is rejected. Missing, unsupported,
access-denied, failed, delayed, stale, overwritten, or unrecognized results remain untrusted (or
are recorded as scan failure). Replayed events are idempotent by EventBridge event ID; a competing
event cannot overwrite an already processed document.

## Activation verification

Use a staging-only synthetic PDF/PNG and a controlled malware test file. Verify:

1. Signed PUT requires declared content type, length, SSE header, and document metadata.
2. Backend completion records exact S3 version, ETag, and SHA-256 and leaves the document
   quarantined.
3. A clean GuardDuty event/tag enables submission but not administrator verification.
4. Malicious, missing, failed, unsupported, stale, or duplicate events never enable review.
5. Only a verified `ADMIN` gets a short-lived exact-version download URL; drivers/customers do
   not read documents through application APIs.
6. EventBridge failure reaches the DLQ and does not make a document trusted.

Do not upload real identity evidence for this verification. GuardDuty plan creation, S3 policy
changes, EventBridge rules, API destinations, connections, and SQS queues require separate
approval because they alter AWS account configuration and can incur cost.
