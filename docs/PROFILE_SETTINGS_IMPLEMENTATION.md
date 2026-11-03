# Profile, Settings and Privacy implementation

Project: `D:\PU\PickUp-raj_driver`  
Verified: 2 November 2026

## Delivered behavior

- Profile and Wallet share a compact `MultipleRide Partner` title-case header. It uses the existing 20sp semibold theme token, a minimum 56dp height, wrapping text and 48dp menu/notification actions. The containing screen supplies safe-area space once. Launcher branding and application identity are unchanged.
- Settings no longer contains Subscription. Help & Support directly precedes Logout, with normal separators and no empty subscription slot. The obsolete mock Settings metadata was removed.
- Profile has an explicit Edit Profile action and an avatar edit entry. Settings → Profile opens the same single editor route. Documents Hub, existing account actions and notification navigation remain available.
- The editor reads actual authenticated profile/account data and persists the supported partner profile name through the existing backend PATCH. There is no optimistic success or local-only profile persistence.
- Settings → Privacy opens its own screen with Privacy Policy, Terms of Service, Data and Permissions, and Privacy Support. Category icons reuse the neutral Documents card treatment.

The previous unscoped `driver.avatarUri` AsyncStorage gallery implementation is no longer read or written. It never uploaded a photo or persisted it to the backend, so it is not presented as a permanent profile change. Existing storage is not globally cleared. Current Firebase profile photos, when supplied over HTTPS, can be displayed; private KYC photos are not repurposed as public avatars.

## Backend inspection and actual API use

Read-only inspection covered the Driver account controller/service/DTO, onboarding controller/service/DTO and driver database fields in `D:\PU\PickUp-raj_backend`. No backend source or database was changed. No Customer App was inspected, modified or built.

| Operation | Existing contract used |
| --- | --- |
| Profile name and onboarding identity | `GET /v1/drivers/me/onboarding` |
| Verified account phone, email, registered name and account status | `GET /v1/drivers/me` |
| Persist partner profile name | `PATCH /v1/drivers/me/onboarding/profile`, body **only** `{name}` |

The backend's `UpdateDriverProfileRequest` supports only `name` with length 2–120. `OnboardingService.updateProfile` normalizes whitespace and writes `Driver.profileName`; it does not update verified `legalName`, licence or KYC records. `assertSubmissionAllowed` enforces active account state and rejects rejected/suspended drivers. All inspected routes are `DriverOnly`; ownership is derived from the authenticated principal with `requireDriver`, not from a supplied partner ID.

The frontend sends the current Firebase bearer token through the configured payments/account base URL. An explicit HTTP 401 refreshes the token and retries once. Network failures and ambiguous mutation results are not automatically retried. Load verifies the two server account IDs agree; save validates that the acknowledged ID matches the loaded driver and that the returned name is valid. No driver ID, phone, KYC, identity-document, vehicle, payment or wallet fields are submitted.

Profile projections discard document/financial fields. Session identity is checked around asynchronous requests, and mounted state clears on logout/account change. Stale reads cannot overwrite an acknowledged save. A synchronous guard blocks repeated submissions. Successful acknowledgement updates the editor, invalidates other focused consumers, and Profile fetches fresh state when returning. A save finishing after leaving the editor still invalidates the newly visible Profile. Nothing is persisted to AsyncStorage or Firebase as a substitute for a successful backend update. Existing authentication and root development-bypass configuration remain unchanged; profile requests still require a real Firebase session.

## Editable versus protected fields

| Field | Implemented behavior |
| --- | --- |
| Full name / partner profile name | Editable through the real name-only PATCH. Required, normalized whitespace, 2–120 characters, at least one Unicode letter, no control characters. Clear validation, saving, failure and confirmed-success states. |
| Verified legal/document name | Protected. A registered legal name may be a display fallback when no profile name exists; saving still updates only `profileName`. |
| Phone | Actual backend verified account phone; read-only. No direct overwrite or new OTP flow. |
| Email | Actual backend account/profile value if present; read-only because the inspected update DTO has no email field. No editable-email validation is simulated. |
| Residential address | Displays actual optional profile address if returned; otherwise unavailable. The inspected backend summary does not supply it and its update DTO does not accept it. Read-only. |
| Profile photo | Displays current HTTPS Firebase profile photo if one exists, otherwise the neutral placeholder. Photo changes are explicitly unavailable; there is no suitable dedicated avatar upload/update contract in the inspected backend. |
| Aadhaar, licence, KYC, vehicle ownership/verification | No editing controls and no update fields. Existing document and verification workflows are preserved. |

Save Changes remains disabled when unchanged, restricted or saving. Back/Cancel are available; Cancel is disabled during an active save. Forms use scrollable, width-constrained content and a name input with minimum height rather than fixed screen coordinates. Tablet and accessibility layout are supported structurally, but no physical tablet test was performed.

## Legal and privacy integration

Approved by the user during this request:

**Privacy Policy:** [https://www.multipleride.com/privacy](https://www.multipleride.com/privacy)

This exact URL is the public default in `src/config/legal.ts`, with an optional `PRIVACY_POLICY_URL` build-time override. A direct HTTPS availability check returned HTTP 200 at the same URL. On the phone, View Privacy Policy opened Chrome with that exact address; Back returned to the Driver policy screen. This is external-link integration, not an embedded policy copy or a legal-content/compliance review.

No approved Partner Terms of Service URL or support/contact URL was supplied or found in the inspected configuration/docs. `TERMS_OF_SERVICE_URL` and `PARTNER_SUPPORT_URL` are optional integration keys documented in `.env.example`. The actual local `.env` was not changed. Missing/invalid links show availability messages; no placeholder URL, email or official legal text is invented. Configured external links must use HTTPS and cannot contain URL credentials. Browser launch failures show a useful error and remain retryable.

Privacy contents:

1. **Privacy Policy:** the supplied published-policy URL, a browser action, and a description pointing readers to the official policy for personal data, documents, location, device data, retention and rights.
2. **Terms of Service:** a dedicated legal screen with a clear missing-approved-terms state until the real URL is configured.
3. **Data and Permissions:** factual app-feature descriptions for location, camera/document selection/upload, and device notification tokens. Open Android app settings uses `Linking.openSettings()`. No permission is changed automatically.
4. **Privacy Support:** a dedicated support destination, a policy link, a missing-contact message, and an explicit statement that this app currently has no account-removal request flow. No deletion request, retention period or compliance promise is fabricated.

## Navigation and preservation

New Account stack routes: `EditProfile`, `Privacy`, `LegalInformation`, `DataPermissions`, `HelpSupport`.

Settings Profile, Privacy, Notifications, Language, Vehicle Details, Personal Documents, Help & Support and Logout all have defined actions. Root Notifications retains the existing implementation. There is one Profile route and one editor; no duplicate profile screen was introduced.

The removed Subscription Settings option was the only external entry into the inspected subscription screen flow. Its three navigator registrations were removed. Legacy screen implementations, their types, subscription/entitlement services and backend tables/APIs were retained; no payment or entitlement behavior was rewritten.

The existing Documents Hub/category/preview routes, KYC and ownership validation, bottom-tab configuration, Firebase/OTP setup, API contracts, Android signing and application ID were not changed. Wallet changes are limited to replacing its duplicate uppercase header with the shared header; wallet/payment behavior is unchanged. Prior uncommitted Trip History changes are preserved, including their earlier edits in the shared mock-data file.

## Verification results

| Check | Result |
| --- | --- |
| TypeScript | `npm run typecheck`: passed. |
| Changed-file lint | ESLint passed with zero errors and zero warnings on all changed/new TS/TSX files for this task. |
| Full regression suite | `npx --no-install jest --runInBand --silent --testTimeout=30000`: **40 suites, 415 tests passed**, 50.975 seconds. Includes 29 new tests for this task. |
| Android debug | `assembleDebug`: passed in the combined build. |
| Android release | `assembleRelease`: passed in the combined build. |
| Combined Android build | `BUILD SUCCESSFUL in 1m 19s`; 1,215 tasks, 34 executed and 1,181 up-to-date. Existing React Native package-export and Gradle deprecation warnings remain. |
| Diff whitespace | `git diff --check`: passed. |

New tests cover header title case/size/wrapping/actions, Settings destinations and Subscription removal, approved/missing/unsafe legal links, browser/settings launch failures, current values, protected fields, name validation, real-contract request/acknowledgement shape, token refresh, authorization errors, no ambiguous mutation retry, duplicate saves, refresh after confirmed updates, navigation during a pending save, logout/account isolation and failed saves without false success. The existing account/document regression test now supplies the new profile hook mock; its document behavior remains tested.

### Connected phone checks

Driver debug app with current JavaScript served through Metro on the connected realme RMX3870, Android 16 / API 36:

- Compact title-case Profile header, menu and actual backend name loading: verified.
- Profile → Edit Profile and Settings → Profile → the same editor: verified.
- Actual existing name and verified phone loaded; email/address read-only labels and unavailable photo-change explanation: verified without printing personal field values in the report.
- Scrolling reaches Save Changes and Cancel; unchanged Save Changes is disabled: verified.
- Settings lists all eight retained rows with no Subscription: verified.
- Settings → Privacy, approved policy screen, Chrome opening the exact URL and Back return: verified.
- Missing Terms and Privacy Support availability states: verified.
- Data and Permissions action reachable by scrolling; Android app-info settings opened and Back returned: verified. No permission changes were made.
- Existing Notifications route and Back return: verified. No notifications were changed or cleared.

No production profile mutation was submitted: the user did not request a particular name change. The live read path was verified; the PATCH integration and save-state behavior were verified against inspected backend contracts and automated tests. A live write/refresh round-trip remains to be exercised with an explicitly chosen test-account change. No live photo update can be verified until the backend supports it. No physical tablet or second account was available.

### APKs, logs and screenshots

- Debug APK: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\debug\app-debug.apk`
- Release APK: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\release\app-release.apk`
- Build log: `D:\PU\PickUp-raj_driver\android-profile-build.log`
- Complete test log: `D:\PU\PickUp-raj_driver\profile-all-tests.log`
- TypeScript/lint logs: `profile-typecheck.log`, `profile-lint.log` in the project root.
- Local screenshots: `artifacts\profile-settings\profile.png`, `settings.png`, `privacy.png`, `privacy-policy.png`.

Build products, logs and screenshots are ignored local artifacts. The debug native APK was up-to-date because no native code/configuration changed; physical checks used the current Metro JavaScript. Release packaging includes the updated JavaScript bundle.

## Remaining integration requirements

1. Approved Partner Terms of Service URL and a published support/contact destination. Configure the documented keys when approved; do not infer a legal email or terms path from the domain.
2. Server-supported editable email/address DTO fields, validation and authorized update behavior before those fields become editable. The current app must not submit unsupported fields or claim local changes are saved.
3. A supported profile-avatar upload/read/update workflow with appropriate access controls. Do not bypass the verified `DRIVER_PHOTO` KYC process to simulate an ordinary avatar change.
4. A verified phone-change workflow integrating Firebase/backend OTP and uniqueness/account-linking checks. The current verified phone remains read-only.
5. An approved and supported data-request/account-removal process before adding a submission or deletion action.
6. A chosen test-account change for a live PATCH verification, plus physical tablet/accessibility checks. Existing authorization and approval restrictions continue to apply.

## Exact files changed for this task

Existing files modified (9):

1. `.env.example`
2. `__tests__/accountDocumentScreens.test.tsx`
3. `src/components/molecules/SettingsRow.tsx`
4. `src/data/mockData.ts` (only obsolete Settings metadata/import removed in this task; prior history removal preserved)
5. `src/navigation/stacks/AccountStack.tsx`
6. `src/screens/account/ProfileScreen.tsx`
7. `src/screens/account/SettingsScreen.tsx`
8. `src/screens/wallet/DriverWalletScreen.tsx` (shared header only)
9. `src/types/navigation.ts`

New files (13):

1. `src/components/molecules/PartnerAppHeader.tsx`
2. `src/config/legal.ts`
3. `src/hooks/usePartnerProfile.ts`
4. `src/services/profile/PartnerProfileService.ts`
5. `src/screens/account/EditProfileScreen.tsx`
6. `src/screens/account/PrivacyScreen.tsx`
7. `src/screens/account/LegalInformationScreen.tsx`
8. `src/screens/account/DataPermissionsScreen.tsx`
9. `src/screens/account/HelpSupportScreen.tsx`
10. `__tests__/partnerProfileService.test.ts`
11. `__tests__/partnerProfileRefresh.test.tsx`
12. `__tests__/profileSettingsScreens.test.tsx`
13. `docs/PROFILE_SETTINGS_IMPLEMENTATION.md`

These 22 source/report files are the scope of this task. They remain uncommitted alongside the preserved earlier work; no Git push or force operation was performed.
