# Dedicated Documents Hub

This report supersedes the Profile/navigation layout in ACCOUNT_DOCUMENT_PREVIEWS.md. Its private retrieval and native-renderer implementation remain in use.

## Final navigation and UI

Profile keeps the existing header, avatar/name, Language, Notifications, Settings and Logout. It has one white rounded Documents row with a folder icon and chevron. No individual thumbnails, document lists, preview requests, refresh controls or Pro Plan card appear on Profile. Subscription services, routes, entitlements and payment functionality remain available elsewhere.

Profile → DocumentsHub (title Documents) → three cards:

| Card | Subtitle | Route |
| --- | --- | --- |
| Vehicle Details | Vehicle registration and insurance documents | VehicleDocuments |
| Personal Documents | Identity and personal verification documents | PersonalDocuments |
| KYC Status | Your identity verification status | KYCStatus |

Hub cards use the existing light/white surfaces, blue icon token, rounded borders, shadows and flexible text columns. They are scrollable and respect the existing bottom tab. Each category is registered once. The obsolete KYCDocuments route/component was renamed to PersonalDocuments, and its Settings link was updated. AccountTab explicitly keeps its stack on blur (`popToTopOnBlur: false`).

VehicleDocuments retains the actual vehicle header, active/explicitly selected vehicle handling and vehicle picker. Actual RC, Insurance and any other existing saved vehicle document types stay scoped to that vehicle; missing records are not invented.

PersonalDocuments reuses the existing authenticated KYC saved-document list and private thumbnails, now without the overall KYC card. It shows actual licence, Aadhaar/Identity Proof and photo records only when present. Aadhaar is not synthesized or inferred from Identity Proof. A KYC document link carries its actual document ID to PersonalDocuments, which scrolls to that saved item.

KYCStatus is a separate metadata overview. Overall approval comes directly from `summary.kyc.status`, never from document count or preview availability. Individual rows combine actual latest records and backend `requiredDocuments.kyc` types. A missing required record is explicitly labelled Not submitted; it is not an uploaded document or a fabricated file. Verified, pending/review and rejection states/reasons remain the server's. Supplied valid reviewedAt/uploadedAt timestamps appear with an accurate Last reviewed/Uploaded label. Links lead to the corresponding personal document or Vehicle Details. Refresh reloads metadata without changing KYC workflow.

The reusable full-screen viewer now includes the document's saved verification status along with its verified name, Back, loading/retry, image/PDF pages and existing zoom controls. Back preserves the category stack. A preview can survive a tab switch; its existing short privacy/URL lifetime still applies and an expired preview can be refreshed.

## Backend and security

No endpoints, dependencies, database schemas, native renderer code, credentials or S3 permissions were added or changed for this reorganization.

- Metadata: GET `/v1/drivers/me/onboarding`, using Firebase authorization.
- Grant: GET `/v1/drivers/me/onboarding/documents/{KYC|VEHICLE}/{documentId}/preview`, through the existing DriverOnboardingService.
- Actual files: existing HTTPS short-lived authorized grant, downloaded into Android's private temporary cache; images/PDF pages are rendered through the existing private module. No public S3 URLs or keys are constructed.
- Document ID, kind and vehicle relationship remain checked against the current authenticated account. Logout/account switch/background clearing and expired-grant Retry remain unchanged. Route parameters never contain a signed URL, object key or sensitive identifier.
- Viewer status is mapped from the same owned saved record used to authorize the preview. No client-provided status or successful image download can approve a document.

No new backend capability is required. The existing source/deployment discrepancy remains: the older backend source under D:/PU/PickUp-raj_backend lacks the driver preview route, while the deployed backend successfully serves it. That older backend needs the route reconciled/backported before being deployed as a replacement. See ACCOUNT_DOCUMENT_PREVIEWS.md for details.

## Exact source changes

1. src/screens/account/ProfileScreen.tsx
2. src/screens/account/DocumentsHubScreen.tsx (new)
3. src/screens/account/KYCDocumentsScreen.tsx → src/screens/account/PersonalDocumentsScreen.tsx (renamed/reorganized)
4. src/screens/account/KYCStatusScreen.tsx (new)
5. src/screens/account/DocumentPreviewScreen.tsx
6. src/components/documents/DocumentCard.tsx
7. src/services/documents/DocumentPreviewService.ts
8. src/navigation/stacks/AccountStack.tsx
9. src/navigation/MainTabNavigator.tsx
10. src/screens/account/SettingsScreen.tsx (route whitelist updated/hoisted; unused imports removed)
11. src/data/mockData.ts (static Settings label/route updated; unused imports removed; no document data added)
12. src/types/navigation.ts
13. __tests__/accountDocumentScreens.test.tsx
14. __tests__/documentPreviews.test.ts
15. docs/DOCUMENTS_HUB_IMPLEMENTATION.md (this report)

## Verification results

- `npm run typecheck`: PASS.
- Changed-file ESLint: 0 errors; 3 existing style warnings (inline tab icon/separator components and no-void in Logout).
- `npx --no-install jest --runInBand --testTimeout=30000`: **28 suites, 325 tests passed**. Log: documents-hub-tests.log.
- Tests cover the sole Documents row/no Profile previews, absent Pro Plan, preserved account actions, the three Hub routes, actual personal/vehicle records, selected/active vehicle scoping, aggregate KYC states and missing/rejected documents, correct personal-document links, supplied review timestamps, viewer status, PDF page indication/back behavior, private authorization and expiry/identity safeguards.
- `assembleDebug assembleRelease`: **BUILD SUCCESSFUL**. Final run: 1m 3s. Log: android-documents-hub-build.log.
- APKs: android/app/build/outputs/apk/debug/app-debug.apk and android/app/build/outputs/apk/release/app-release.apk. Existing signing configuration retained; release uses the project's existing debug signing key.

Connected realme RMX3870 debug verification:

- Profile: one Documents row, zero document thumbnails, no Pro Plan.
- Hub: all three category cards/titles/subtitles present.
- Personal Documents: actual saved Driver Photo, Driving Licence and Identity Proof records.
- A real stored Driving Licence opened through the new hierarchy and displayed Verified plus the rendered image page.
- Switched to Home and back: the open preview was retained. Back returned to Personal Documents.
- KYCStatus displayed actual overall Verified and individual record statuses. Its specific Driving Licence link reached the Personal Documents screen.
- Vehicle Details opened the existing vehicle document screen with actual RC and Insurance records visible.

No sample documents were placed in the account. Native PDF rendering and pinch gestures were not newly physically verified; existing mocked PDF/UI regression coverage and native renderer/build validation remain as documented previously. No other person's live document was accessed to test authorization.
