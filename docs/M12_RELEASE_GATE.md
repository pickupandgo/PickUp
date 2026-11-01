# M12 - Network, Android package and release regression gate
2026-11-01. CA-31 / CA-32 / CA-33. Customer-only fixes. Automated checks and internal APK packaging pass; production release acceptance remains OPEN. No backend/engine/driver/admin source or production DB mutation in M12.

## Fixed and verified
- Engine transport: one 15-second default deadline bounds token lookup, headers/body parsing, backoff and read retries. Already-aborted requests never contact the service. Failed auth cannot silently become an anonymous mutation. Automatic transient retries are GET-only; one authenticated 401 refresh remains. Cancelled retry sleeps remove their listeners.
- Backend transport: the same complete default deadline now covers auth-refresh/auto-provisioning recovery. Original UID is preserved across token lookup, recovery and body reads. Account changes produce a non-retryable session_changed error, preventing old-account work from running under a new UID. No default retry of unsafe mutations.
- Address providers/fallback chain: a complete 12-second operation deadline, caller cancellation and no late provider fetch after cancellation. GPS gets a 22-second callback watchdog AFTER the OS permission response. OS permission prompts themselves are not timed out. Concurrent screens still share the native position request; one caller can cancel promptly without cancelling another. Cancellation during reverse geocoding cannot become a successful coordinate fallback. Debug-only diagnostics avoid raw provider errors in release logs.
- Removed the global error override that swallowed release JS failures and logged raw errors. The render ErrorBoundary remains, with error detail logging/display restricted to development.
- Android release/internal manifests: no unused storage/overlay permissions; overlay stays debug-only. Explicit cleartext=false, allowBackup=false and legacy/Android-12 cloud/device-transfer exclusion rules for current app storage. Existing local user data is not erased.
- Production release no longer falls back to the debug signing key. Four private PICKUP_RELEASE_* settings are required. Internal build bundles non-debug JS, uses the debug TEST certificate and a -internal version suffix. It is deliberately not a Play Store release.
- Portable Metro real-root resolution replaces the hardcoded user path. Optional PICKUP_NATIVE_BUILD_DIR plus CMake object-path control makes long Windows source paths buildable using short D-drive staging. Android is the current supported native target; removed the misleading iOS script because no ios project exists.
- Static gate triage: nested navigator containers are not misreported as orphan screens; seven explicit compatibility routes retain documented reasons and are reported separately, not counted as proven real-flow reachability. Unknown targets/new untriaged orphans/dead handlers still fail. Text checker correctly inherits a fragment's Text host, fixing a false-positive space inside Text without wrapping or suppressing real View strings.

## Evidence
- Baseline: 39 suites / 324 tests passed.
- Final: 40 suites / 338 tests passed; customer TypeScript passed.
- Wiring/text scripts pass with the seven compatibility exceptions printed explicitly; 113 TSX files checked for raw text. These static checks are not native navigation certification.
- Installed geolocation Java callback regression passed: duplicate result, overlapping requests, late result after error and null position.
- ARM64 assembleInternal passed (including native lint-vital). Full native build plus final incremental APK refresh completed. Long-path failure was reproduced and resolved through corrected 240-character CMake limit and short external build staging.
- Actual release task graph dry-run correctly refused missing production signing credentials. No production signing key was generated, copied, printed or committed.
- APK signature verified; package is non-debuggable, has bundled JS and ARM64 native libraries. Parsed packaged manifest confirms backup and cleartext disabled and no storage/overlay permissions. Resolved Android resource aliases confirm the backup XMLs are packaged. The packaged JS hash matches the latest Gradle-generated bundle, rather than the ignored legacy source bundle.
- APK: artifacts/PICKUP-M12-internal-arm64.apk, 27.5 MiB. SHA-256: 15dcd791366e8eb87d771b1d7021cb0e08025dfa9c5a31dd62987f24fe855c6a. This is an internal TEST-signed APK, not a production signing artifact.
- Live read-only checks: backend /health/live 200, /health/ready 200; anonymous /v1/customers/me and POST /v1/routes/road returned 401. Engine /rides/recovery first timed out at 15 seconds; later unauthenticated recheck returned 401. No cold-start/DB root cause inferred and no stability certification from these snapshots. No OTP, account token, real booking or payment used by these probes.

## Still required before release closure
| Gate | Status / action |
|---|---|
| Physical/native UI | Pending: no device connected via adb; browser/native computer-use hosts unavailable. Keyboard/map visibility, small display, large fonts, TalkBack, permission denied/restored, background/resume and native share chooser have NOT been visually accepted. |
| Authenticated end-to-end | Pending on controlled/staging customer and eligible driver accounts: login/profile reread, route through multiple drops, quote/booking, assignment timeout, chat, cancellation, payment gate, completion/history. Do not run money-changing fixtures against production by assumption. |
| Google login | Real device Google completion was deferred by the user earlier; retain it as an open release check. M09 live push was confirmed done by the user separately. |
| Server road routing | Route is deployed/protected (anonymous 401), but this does not verify Google provider/key/billing or a signed-in successful polyline from Render. Test it from the new APK. |
| Road-based fare | Backend fare model still HAVERSINE. Map routing changes do not change financial distance. Road-distance fare integration/validation remains separate pending work. |
| Production identity/signing | Owner must supply/manage the actual release keystore privately and configure the real certificate fingerprints with Firebase/Maps/Google sign-in as appropriate. Do not enter signing passwords into customer .env or chat. Previously exposed credentials must be rotated privately. |
| Android toolchain | Existing compile-SDK/AGP compatibility and Gradle deprecation warnings remain. No iOS binary or platform certification claimed. |

## Build/use
For a test phone use android/gradlew assembleInternal -PreactNativeArchitectures=arm64-v8a. JavaScript is bundled; Metro is not needed. On Windows with a long checkout path, set PICKUP_NATIVE_BUILD_DIR to a short private build-cache directory (verified locally with D:/pn12); keep Gradle cache/SDK outside the source tree as configured.

Production assembleRelease/bundleRelease requires PICKUP_RELEASE_STORE_FILE, PICKUP_RELEASE_STORE_PASSWORD, PICKUP_RELEASE_KEY_ALIAS and PICKUP_RELEASE_KEY_PASSWORD in private process environment or ignored android/local.properties. Never put these in the React Native .env file: that file is embedded into the client build. Keep existing production app signing identity; do not replace an existing app's key casually. This milestone intentionally does not create or publish a production-signed release.

Official references: https://developer.android.com/identity/data/autobackup ; https://reactnative.dev/docs/signed-apk-android ; https://developer.android.com/studio/publish/app-signing
