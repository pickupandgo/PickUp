# Driver bottom navigation safe-area fix

Project: `D:\PU\PickUp-raj_driver`
Verified: 2 November 2026.

## Root cause

MainTabNavigator set `tabBarStyle.height = 56` and `paddingBottom = 4`.
The installed React Navigation BottomTabBar applies the app's tabBarStyle after its
own inset-aware style. Its getTabBarHeight also returns a custom numeric height
unchanged, bypassing the default height-plus-inset calculation. Consequently the
fixed app style replaced both the reserved system area and the library's bottom
inset padding. On an edge-to-edge Android window, system buttons could occupy
the same pixels as app icons/labels.

Inspected the Driver manifest, MainActivity, Android styles, app/build.gradle,
gradle.properties, App.tsx, bottom-tab implementation, main tab screens and Go Live/
Go Offline sheet placement. This app already has a root SafeAreaProvider. It uses
React Native 0.87.0, installed safe-area-context 5.9.1 and bottom-tabs 7.18.17.
Target SDK is 36 and edgeToEdgeEnabled is true. Neither missing root insets nor an
absolutely positioned tab bar caused this overlap. No Android opt-out is needed.

## Implementation

- MainTabNavigator reads live useSafeAreaInsets values from the existing provider.
- Total tab-bar height is the original 56dp content height plus insets.bottom.
- The app no longer overrides bar paddingBottom. React Navigation applies the
  system bottom inset once, including changes delivered while the app runs.
- Original 4dp visual spacing moves to tabBarItemStyle.paddingBottom. This spacing
  belongs to the tab items and is independent of the system navigation height.
- tabBarHideOnKeyboard uses React Navigation's keyboard handling: hide the bar
  while the keyboard is visible, then restore it, rather than float it above IME.
- The bar remains in normal navigator layout. Scene space is reserved by React
  Navigation; no absolute offsets or additional root bottom padding were added.
  Existing screen safe-area/content padding was retained.
- Existing sheet overlays live inside DriverHome's scene, above the sibling tab
  bar. No additional sheet offset was necessary; this was checked on the device.

All five tab routes, labels, icons, colours, branding and navigation callbacks are
unchanged. Existing Driver changes, including tracking and notification integration,
remain in place. Native/Firebase/auth/API/backend configuration was not changed.
No Customer App repository, application code, build or UI was inspected or changed
for this task. Android Settings was used only for the requested navigation tests.

Reference: [React Navigation safe-area handling](https://reactnavigation.org/docs/handling-safe-area/).
The installed BottomTabBar source was also inspected to verify custom-style precedence.

## Exact files changed

1. `D:\PU\PickUp-raj_driver\src\navigation\MainTabNavigator.tsx` — production fix.
2. `D:\PU\PickUp-raj_driver\__tests__\bottomTabSafeArea.test.tsx` — new regression tests.
3. `D:\PU\PickUp-raj_driver\docs\BOTTOM_NAVIGATION_SAFE_AREA.md` — this report.

APK files, the build log and screenshot files are generated verification artifacts.

## Automated verification

- `npm run typecheck`: PASS.
- Changed-file ESLint: PASS, zero errors; one existing warning for the unchanged
  inline tabBarIcon renderer (react/no-unstable-nested-components).
- `npx --no-install jest --runInBand --silent --testTimeout=30000 --runTestsByPath
  __tests__/bottomTabSafeArea.test.tsx __tests__/homeDashboardNavigation.test.tsx
  __tests__/accountDocumentScreens.test.tsx`: PASS, 3 suites / 27 tests.
- New tests render the actual React Navigation BottomTabBar, not a substitute tab
  renderer. They check insets 0/8/24/48, a single reserved bottom inset, unchanged
  routes/colours, adequate remaining button height, keyboard hiding/restoration,
  and preservation of the selected Wallet tab across mounted inset changes.
- Layout fixtures include 320x640, 390x844, 800x1280 and 1280x800 logical dimensions.

## Physical Android results

Connected device: realme RMX3870, Android 16 / API 36, 1080x2400, density 480
(3 physical pixels per dp). The Lenovo tablet was not connected.

| Navigation configuration | System area begins | Tab button vertical bounds | Button height |
| --- | --- | --- | --- |
| Gestures, guide visible | y=2352px | y=2187..2340px | 51dp |
| Three buttons | y=2268px | y=2103..2256px | 51dp |
| Gestures, guide hidden (original setting) | y=2400px | y=2235..2388px | 51dp |

Bounds came from Android's window-inset state and UI hierarchy. No system
navigation height was hardcoded into application code.

In BOTH visible-gesture and three-button modes:

- Home, Trips, Earnings, Wallet and Account each opened and selected correctly.
- All five tab targets remained visible, clear of the system navigation area and
  at least 48dp high. Icons/labels were visually checked in captures.
- Trips scrolled to its final records; Profile's final Logout row stayed reachable
  above the bar. No logout was performed.
- Go Live sheet actions stayed above the bar. The sheet was cancelled; live sharing
  was not enabled.
- Recharge's amount field opened the actual Android keyboard, confirmed by IME
  state. Tabs hid while it was open and all five returned when it closed. No amount
  was entered and no payment was submitted.
- In three-button mode, the actual system Back button returned from Notifications
  to Home. Actual Home and Recent Apps buttons opened Android launcher/system UI;
  the Driver app resumed successfully afterward. Other apps were not opened.

Runtime changes were made through Android Settings: hidden gesture guide -> visible
guide -> Buttons -> Gestures -> original hidden guide. The Driver PID remained
31548 across navigation-mode switches. Returning to the app updated the geometry
without reinstalling or force-stopping it. Android may recreate its activity for
configuration changes; this did not require restarting the app process.

At density 240, the connected phone additionally emulated a 720dp-wide tablet-sized
layout. All five tabs opened and retained >=48dp targets with three-button navigation.
This is emulation on the phone, not a test of Lenovo tablet hardware.

Original phone state was restored: density 480 with no override, navigation_mode=2
(gestures), Hide gesture guide bar=On. No other navigation preferences were changed.

## Android build results

`android/gradlew.bat assembleDebug assembleRelease --console=plain`: BUILD SUCCESSFUL
in 1m 16s; 1,215 tasks (34 executed, 1,181 up-to-date). Existing Gradle deprecation
warnings remain. The debug APK was installed and used for the physical checks.

- Debug: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\debug\app-debug.apk`
- Release: `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\release\app-release.apk`
- Build log: `D:\PU\PickUp-raj_driver\android-bottom-insets-build.log`
- Captures: `D:\PU\PickUp-raj_driver\artifacts\bottom-navigation`

## Remaining physical verification

The physical Lenovo tablet, other OEMs/Android versions and tablet landscape system
navigation still need hardware verification. Automated tablet/landscape fixtures and
720dp phone emulation passed, but those do not replace that hardware check. The
result is supported by the connected phone's geometry and interaction tests, not
solely by successful APK compilation.
