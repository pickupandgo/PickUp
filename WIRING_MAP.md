# PICKUP UI — Complete Prototype Wiring Map

> **Screens: 79 | Reachable from the flow: 72 | Gallery-only by design: 7**
>
> Verified by `node scripts/check-wiring.js` (targets resolve, no orphans, no dead handlers)
> and `npx tsc --noEmit` (0 errors).
>
> **Last verified:** 30 Aug 2026

---

## Conventions

| Rule | Detail |
|---|---|
| Navigation | Always the `navigation` prop. No `useNavigation()` anywhere. |
| Route names | Component names, e.g. `'DropCompletedStateScreen'`. Registered flat in `App.tsx`. |
| Callback priority | `onPress={() => (onX ? onX() : navigation?.navigate('Target'))}` — host app can override, prototype still works standalone. |
| Back | `navigation?.goBack()`. Never a forward jump. |
| "Back to Home" | `navigation?.navigate('HomeScreen')`. |
| Logout | `navigation?.reset({ index: 0, routes: [{ name: 'LoginScreen' }] })`. |
| Help / support | `ActiveTripChatScreen` — the app's only support surface. |
| Bottom tabs | `navigateToTab(navigation, tabId)` from `src/navigation/tabRoutes.ts`. |
| Non-navigational controls | Rendered as `View`, not `Pressable`, so no button is dead. |

Tab map: `home → HomeScreen`, `trips → TripHistoryScreen`, `activity → NotificationCenterScreen`, `profile → ProfileScreen`.

---

## Flow 1: Authentication

```
LoginScreen ──Get OTP──► OtpVerificationScreen ──VERIFY──► PermissionScreen
   ──Allow / Not Now──► RecordingConsentScreen ──Grant Consent / Not Now──►
   CreateProfileScreen ──SAVE & CONTINUE──► HomeScreen
```

`CreateProfileScreen` is the onboarding step; it has no back affordance by design.

`OtpVerificationScreen` runs a live 1s countdown; "Resend OTP" enables at 0:00 and restarts it.
"Change Number" goes back.

---

## Flow 2: HomeScreen hub

| Control | Destination |
|---|---|
| Avatar (TopAppBar leading) | ProfileScreen |
| Bell (TopAppBar trailing) | NotificationCenterScreen |
| Active trip card | ActiveTripTrackingScreen |
| "Change" (pickup) | SelectLocationScreen |
| Drop pin / "Enter drop location" / "Start Booking" / "Add another drop" / recent location | AddressSearchScreen |
| "Trip History" card | TripHistoryScreen |
| "Manage Addresses" card | SavedAddressesScreen |
| Tabs | Home (no-op, already here) · Trips → TripHistoryScreen · Account → ProfileScreen |

> There is no Wallet tab or wallet payment method — the app has no wallet feature.

---

## Flow 3: Booking

Pickup is already set on HomeScreen (current location, changeable there), so the booking flow only
asks for drops:

```
AddressSearchScreen ──► SelectDropLocationScreen ──CONFIRM DROP──► MultiDropOverviewScreen
  ──CONFIRM ROUTE──► SelectVehicleScreen
  ──CONTINUE──► GoodsDetailsScreen ──► GoodsInsuranceScreen ──► ReceiverDetailsScreen
  ──► FareEstimateScreen ──► ReviewBookingScreen ──Confirm Booking──► ValidateBookingScreen
  ──CONFIRM & BOOK──► BookingConfirmedScreen ──⏱ 3s──► FindingDriverScreen
```

`SelectLocationScreen` is the **set/change pickup** screen, not a step in the drop flow. It is
entered from HomeScreen's "Change", MultiDropOverviewScreen's pickup edit, or ReviewBookingScreen's
pickup row, and its "Confirm Pick Up" returns to whichever screen opened it.

Side exits:
- AddressSearchScreen `x` → HomeScreen (leaves the flow; back arrow still goes back)
- SelectDropLocationScreen "Add another drop" → MultiDropOverviewScreen
- MultiDropOverviewScreen "Add Drop Location" → SelectDropLocationScreen
- MultiDropOverviewScreen edit stop → SelectLocationScreen for the pickup, SelectDropLocationScreen for a drop
- ReviewBookingScreen rows → Pickup: SelectLocationScreen · Drop: SelectDropLocationScreen · Vehicle: SelectVehicleScreen · Payment: PaymentMethodScreen · Declared Value: DeclaredValueSelectionScreen · Insurance: GoodsInsuranceScreen
- DeclaredValueSelectionScreen "Next" → back to ReviewBookingScreen
- BookingConfirmedScreen "Cancel Booking" → CancellationReasonScreen

---

## Flow 4: Driver search

```
FindingDriverScreen ──[MOCK] DRIVER FOUND──► DriverFoundScreen ──⏱ 3s──► DriverAssignedScreen
                    ──[MOCK] NO DRIVERS───► NoDriversAvailableScreen
                    ──CANCEL BOOKING─────► CancellationReasonScreen

NoDriversAvailableScreen ──Retry Search──► AssignmentFailedScreen ──Retry Booking──► FindingDriverScreen
                         ──Return to Home──► HomeScreen        AssignmentFailedScreen ──Cancel──► HomeScreen
```

| DriverAssignedScreen | Destination |
|---|---|
| [MOCK] Start Trip | PickupOtpVerificationScreen |
| Contact Driver | CallDriverScreen |
| Trip Details | DriverAssignedExpandedScreen |

`DriverAssignedExpandedScreen`: Track Driver → CustomerLiveTrackingScreen · phone → CallDriverScreen · chat → ActiveTripChatScreen · Cancel Booking → CancellationReasonScreen.
`CallDriverScreen`: End Call → back. Mute/Speaker toggle local state; Keypad is display-only.

---

## Flow 5: Cancellation

```
CancellationReasonScreen ──SUBMIT──► CancellationChargeConfirmationScreen
  ──CANCEL & ACCEPT CHARGE──► CancellationConfirmationScreen
  ──CANCEL TRIP──► CancellationResultScreen ──BACK TO HOME──► HomeScreen
```

"KEEP TRIP" on both confirmation screens goes back — it no longer completes the cancellation.
`TripCancelledStatusScreen` is reached by tapping a cancelled trip in TripHistoryScreen.

---

## Flow 6: Trip & multi-drop delivery

```
PickupOtpVerificationScreen ──VERIFY PICKUP OTP──► PickupVerifiedSuccessScreen
  ──TRACK TRIP──► CustomerLiveTrackingScreen ──[MOCK] END──► MultiDropProgressScreen
  ──tap a stop──► CurrentDropDetailsScreen ──VERIFY DROP OTP──► DropOtpVerificationScreen
  ──VERIFY DELIVERY OTP──► DropCompletedStateScreen
        ├─ Track Next Stop ──► NextDropScreen ──Track Driver──► CustomerLiveTrackingScreen
        └─ VIEW DELIVERY SUMMARY ──► FinalDeliverySummaryScreen
  ──CONFIRM PAYMENT & CLOSE TRIP──► PaymentSelectionScreen
```

Tracking leaves: Call → CallDriverScreen · Chat → ActiveTripChatScreen · Share → ShareTrackingSheetScreen · Track Map → LiveTrackingScreen.
"Resend OTP" on both OTP screens clears the inputs; it never advances the flow.

### Network-error demo chain

```
ActiveTripTrackingScreen ──help──► LiveTrackingExceptionsScreen ──⏱ 3s──► MapLoadingScreen
  ──⏱ 3s──► ReconnectingScreen ──⏱ 3s──► NetworkErrorScreen
      ├─ Retry ──► CustomerLiveTrackingScreen   (recovered)
      └─ Check Network Settings ──► RouteUnavailableScreen ──Retry──► MultiDropProgressScreen
```

---

## Flow 7: Payment

```
PaymentSelectionScreen ──► PaymentMethodScreen
   ├─ cash selected ──► CashPaymentStatusScreen ──CONFIRM──► PaymentSuccessfulScreen
   └─ UPI selected ───► PaymentMethodSelectedScreen ──Pay──► PaymentProcessingScreen
        ──⏱ 3s──► PaymentPendingScreen
             ├─ Check Status ───► PaymentSuccessfulScreen
             └─ Cancel Payment ──► PaymentFailedScreen
PaymentSuccessfulScreen ──View Booking──► PaymentConfirmationScreen ──DONE──► TripCompletedScreen
PaymentFailedScreen ──Retry──► PaymentMethodSelectedScreen · ──Change Method──► PaymentSelectionScreen
```

`PaymentMethodScreen` branches on the actual selected method. `PaymentMethodSelectedScreen` "Change" goes back to the picker.

---

## Flow 8: Completion, rating & receipt

```
TripCompletedScreen ──Done──► TripCompletedSummaryScreen
                    ──Write a Review──► DriverRatingScreen

TripCompletedSummaryScreen ├─ RATE DRIVER ──► DriverRatingScreen
                           ├─ VIEW RECEIPT ─► DigitalReceiptScreen
                           └─ BACK TO HOME ─► HomeScreen

DriverRatingScreen ──SUBMIT RATING──► WrittenReviewScreen ──SUBMIT REVIEW──► HomeScreen
```

Stars set the rating, which unlocks the feedback chips and the submit button. Submit navigates
after the simulated 1s delay so the loading state is visible. Skip on either screen returns to
TripCompletedSummaryScreen.

---

## Flow 9: Profile & settings

```
ProfileScreen ├─ Saved Addresses ──► SavedAddressesScreen
              ├─ Booking History ──► TripHistoryScreen
              ├─ Notifications ───► NotificationCenterScreen
              ├─ Edit Profile ─────► EditProfileScreen
              ├─ Settings / avatar ─► CustomerSettingsScreen
              └─ Logout ──► LogoutConfirmationScreen ──Log Out──► reset to LoginScreen

EditProfileScreen ──photo / "Change Profile Photo"──► ChangeProfilePhotoScreen
  (transparent modal; every action and the scrim dismiss back to Edit Profile)
EditProfileScreen ──SAVE CHANGES──► back to ProfileScreen
```

- `CustomerSettingsScreen` rows each have their own destination ("Profile" → EditProfileScreen); "Language" is a display-only row.
- `SavedAddressesScreen`: edit → SelectDropLocationScreen · delete removes the row from local state · Add New Address → AddressSearchScreen.
- `TripHistoryScreen`: tabs filter locally (Recent / Scheduled). A completed trip opens HistoricalTripDetailScreen; a cancelled trip opens TripCancelledStatusScreen.
- `HistoricalTripDetailScreen`: Rate Trip → DriverRatingScreen · Download Invoice → DigitalReceiptScreen · Need Help? → ActiveTripChatScreen · more → ShareTrackingSheetScreen.

---

## Flow 10: Notifications & sharing

`NotificationCenterScreen` tabs filter by type. Each notification opens a relevant screen:

| Notification | Destination |
|---|---|
| Driver arriving soon | CustomerLiveTrackingScreen |
| Payment successful | DigitalReceiptScreen |
| Trip completed | TripCompletedSummaryScreen |
| New device login | CustomerSettingsScreen |
| Booking cancelled | TripCancelledStatusScreen |

`ShareTrackingSheetScreen`: copy shows a 2s confirmation; SHARE TRACKING runs its 1.5s simulation then returns.

---

## Auto-advancing screens (3s, `setTimeout` with cleanup)

| Screen | Advances to |
|---|---|
| BookingConfirmedScreen | FindingDriverScreen |
| DriverFoundScreen | DriverAssignedScreen |
| PaymentProcessingScreen | PaymentPendingScreen |
| LiveTrackingExceptionsScreen | MapLoadingScreen |
| MapLoadingScreen | ReconnectingScreen |
| ReconnectingScreen | NetworkErrorScreen |

---

## Gallery-only screens (7)

Alternate layouts and edge states with no natural parent in a linear customer journey. Reach them
from the `Gallery` route in `App.tsx`.

| Screen | Why |
|---|---|
| BookingReviewScreen | Alternate layout of ReviewBookingScreen |
| VehicleSelectionScreen | Alternate layout of SelectVehicleScreen |
| SearchingDriverScreen | Alternate layout of FindingDriverScreen |
| LoadingSkeletonScreen | Skeleton-state showcase |
| EmptyStateScreen | Parameterised empty state |
| ErrorScreen | Parameterised error state |
| SearchUnavailableScreen | Search-failure state |

These are fully wired internally — their buttons work; they just have no inbound flow edge.

---

## Verification

```bash
npm run check      # typecheck + wiring + text-node checks
```

- `check:wiring` fails if a navigation target isn't registered, a route becomes unreachable, or an `onPress` is bound to a bare optional prop.
- `check:text` fails if any raw string is a child of a view element. This catches the runtime crash
  **"Text strings must be rendered within a `<Text>` component"** at build time. The most common
  cause is a same-line space between a tag and the next element or comment:
  ```tsx
  <View style={styles.spacer} /> {/* comment */}   // the space is a text child
  <Pressable ...>  <View>                          // the two spaces are a text child
  ```
  JSX discards whitespace runs containing a newline, so putting the next element on its own line
  fixes it.

---

## What this prototype is NOT

- No backend or API calls — all data is mock, from `src/data/mockData.ts`
- No real maps — placeholder views and static images
- No real payment processing
- No real OTP verification — any 4 digits pass
- No persistent state — nothing is saved between screens
