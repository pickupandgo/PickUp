# Account documents and private previews

## Delivered UI

The Pro Plan/validity/Manage card is removed only from ProfileScreen. Its space is gone; the Documents section follows the existing profile header/hero. Subscription routes, services, permissions and payment logic remain intact. Language, Settings, Notifications and confirmed Logout actions are preserved.

Account, Identity Documents and Vehicle Documents use saved onboarding records, not a hardcoded list of expected documents. The latest version per actual document type is shown. Supported labels include Driver Photo, Driving Licence, Identity Proof/Aadhaar, RC and Insurance; other saved types use a readable version of the backend type. A missing Aadhaar record is never invented from the overall KYC status. Actual file MIME type is obtained from the authorized preview response.

Each row shows a real first-page thumbnail when retrievable, its actual status, optional backend rejection reason, and View/Retry actions. VERIFIED is green; rejected is red; pending/review states are labelled explicitly. Preview success never changes verification state. PDFs show a first-page thumbnail and page count. No uploads is distinct from unavailable, not ready, expired, unsupported, denied, network failure and loading.

VehicleDocuments accepts an optional vehicleId. It selects that exact owned vehicle, or the authoritative active/sole registration. It never arbitrarily takes the first of multiple vehicles. A vehicle picker allows viewing other registered vehicles; document references always contain the relevant vehicleId. Account shows the vehicle registration beside its associated document rows.

## Verified backend/storage integration

Metadata: authenticated GET `/v1/drivers/me/onboarding`, using existing Firebase identity/token handling and PAYMENTS_API_BASE_URL. Fields: `kyc.documents`, `vehicles[].id`, `vehicles[].documents`, `activeVehicle`; documents use `id`, `version`, `documentType`, `status`, `rejectionReason` and existing timestamps. No storage-key field is sent by the new UI.

Preview: the app's **pre-existing** client contract GET `/v1/drivers/me/onboarding/documents/{KYC|VEHICLE}/{documentId}/preview`, returning `{ url, contentType, expiresInSeconds }`. It is called through DriverOnboardingService, with Firebase authorization. The new service rechecks the document against the authenticated account's metadata and exact vehicle relationship before requesting a grant. Navigation carries document IDs/kind/vehicleId only, never a URL or S3 key.

Important source/deployment difference: `D:/PU/PickUp-raj_backend/src/onboarding/onboarding.controller.ts` is older and contains no driver preview route; it only has administrator downloads. Its storage service signs versioned GetObject requests with `ResponseCacheControl: no-store`, and its documentation requires private S3-compatible storage. **The deployed backend used by the connected phone does implement the existing driver client route:** actual Driver Photo, Driving Licence, Identity Proof, Insurance and RC thumbnails were retrieved, and Driving Licence/RC opened successfully in the new viewer. The app does not use administrator routes. A backend team should reconcile/backport the deployed owner-preview route into that older local backend before deploying it. If absent, the app shows Preview unavailable on 404; it does not substitute public objects or sample files.

No database, AWS credentials, ACL, bucket policy or backend code was changed. No public bucket/URL workaround was introduced. Existing private storage retrieval continues through HTTPS short-lived grants. Live AWS bucket policy settings were not audited. Backend-side ownership/scan policy still must be enforced by the deployed preview route; client membership checks are additional protection, not a replacement for server authorization.

## Viewer and privacy

No new npm/native third-party packages. Android uses its built-in PdfRenderer, BitmapFactory and EXIF orientation handling. The native module downloads only HTTPS grants (no credential-bearing URLs or redirects) into an app-private cache, limits a file to 25 MiB and PDFs to 200 pages, and holds at most eight document files. Handles are opaque random IDs. Source bytes/files and signed URLs never enter AsyncStorage, public storage or an external viewer.

Native files expire within the lesser of the grant lifetime and 60 seconds and are pruned on next module initialization after process death. Logout/account changes or backgrounding clear handles, in-memory state, metadata and native files; logout also clears the decoded image memory cache. Android document screens use FLAG_SECURE to prevent document screenshots/recent-app snapshots. The renderer emits in-memory PNG pages, not file URLs. Full signed URLs/object keys/document contents are not logged. Retry requests fresh ownership metadata and a fresh authorized grant. Screen and page loads have bounded timeout/error states.

The full-screen viewer shows the verified document name and a back action. Images fit with contain sizing; existing files are oriented from EXIF. Pinch zoom (1–4x), pan while zoomed and double-tap (1x/2x) use core React Native responders. Zoom level is announced in the page accessibility label. PDFs render a virtualized vertical page list with per-page zoom/pan and a visible page indicator. Page rendering is sequential and bounded; pages are not all decoded simultaneously.

The private native renderer is Android-specific. On a platform/build without it, the app displays an explicit unavailable state; iOS private rendering/PDF support is not claimed.

## Exact source files changed

- android/app/src/main/java/com/com.pickup.driver/PrivateDocumentsPackage.kt (new)
- android/app/src/main/java/com/com.pickup.driver/MainApplication.kt
- src/services/documents/DocumentPreviewService.ts (new)
- src/services/onboarding/DriverOnboardingService.ts (adds typed HTTP status errors; existing routes preserved)
- src/hooks/useDocumentPreview.ts (new)
- src/hooks/useDriverOnboarding.ts (discards late/unmounted/previous-identity responses; clears metadata on failed refresh)
- src/components/documents/DocumentCard.tsx (new)
- src/components/documents/ZoomableDocumentPage.tsx (new)
- src/screens/account/DocumentPreviewScreen.tsx (new)
- src/screens/account/ProfileScreen.tsx
- src/screens/account/KYCDocumentsScreen.tsx
- src/screens/account/VehicleDocumentsScreen.tsx
- src/navigation/stacks/AccountStack.tsx
- src/types/navigation.ts
- __tests__/documentPreviews.test.ts (new)
- __tests__/accountDocumentScreens.test.tsx (new)
- __tests__/App.test.tsx (unmounts the renderer so startup timers do not outlive the test)
- docs/ACCOUNT_DOCUMENT_PREVIEWS.md (this report)

## Verification

TypeScript checks pass. Changed-file ESLint has no errors and one existing no-void style warning in ProfileScreen.

Full existing suite: `npx --no-install jest --runInBand --testTimeout=30000` — **28 suites, 318 tests passed**. The longer test timeout accommodates cold React Native module loading during native compilation; no assertions were disabled. App.test now cleans up its mounted renderer/timers. Test log: `document-preview-tests.log`.

New tests exercise actual-record mapping, latest versions, private image thumbnails, vehicle scoping, unowned references, signed-out access, 401/403/404/409/network errors, HTTPS/MIME validation, expired-grant renewal, logout/account-switch invalidation, real status/rejection handling, Pro Plan removal, retained account actions, document-route parameters, contain sizing, PDF page-list/page-indicator wiring and back navigation. PDF/native rendering is mocked in these JS tests, not represented as a live PDF test.

Android debug/release builds succeed using the existing signing configuration. APK locations: `android/app/build/outputs/apk/debug/app-debug.apk`, `android/app/build/outputs/apk/release/app-release.apk`. Build log: `android-document-preview-build.log`. Release retains the project's existing debug-key signing; this is a verification APK, not a newly production-signed release.

Physical device: connected realme RMX3870. Pro Plan removal and actual document thumbnails verified. Saved Driving Licence, RC and Insurance Certificate opened; Driving Licence double-tap zoom reached 2x, pan gesture and back navigation were exercised, and an expired grant produced a clear state followed by a successful authorized Retry. The account has an Identity Proof record rather than a separately typed Aadhaar record; no Aadhaar record was invented. No synthetic documents or public images were injected into the account. Native PDF/multi-page display and pinch zoom have not been physically verified; the available tested documents are images. Unauthorized/account-switch tests are automated service tests, not attempts to access another person's live private files.
