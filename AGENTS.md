
# PICKUP UI — Project Context for AI Assistants

> **Read this entire file before writing ANY code.**

---

## What Is This Project?

PICKUP UI is a **customer-side logistics/delivery app prototype** built in React Native + Expo. It is a **UI-only prototype** with 76 screens, designed to be shown to clients as a fully tappable demo. There is **NO backend, NO real APIs, NO real maps** — all data is hardcoded mock data.

**GitHub:** https://github.com/Rajpatel800/PICKUP_UI

---

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| React Native | 0.81.5 | Core framework |
| Expo | 54.0.0 (SDK 54) | Build & dev tooling |
| TypeScript | 5.9.2 | Type safety |
| React Navigation (Native Stack) | 7.x | Screen-to-screen navigation |
| @expo/vector-icons (Feather) | 15.x | Icons |
| react-native-safe-area-context | 5.6.0 | Safe area handling |
| react-native-screens | 4.16.0 | Native screen containers |

**Entry point:** `index.ts` → `App.tsx`

---

## Critical Rules

### 1. Expo Version
> **This project is pinned to Expo SDK 54 for Expo Go 54.0.8 compatibility. Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.**

### 2. Customer-Only App
This is **PURELY a customer app**. There is NO driver side, NO admin panel. Do NOT add any driver/logistics-provider features.

### 3. No New Features Without Permission
Do NOT create new features, new screens, or new flows unless the user explicitly asks. Only modify what exists.

### 4. Mock Data Only
All data is mock/hardcoded in `src/data/mockData.ts`. Do NOT add API calls, fetch requests, or backend integrations.

### 5. Navigation Pattern
Every screen receives `navigation` as a prop (typed as `any`). Navigation is done via:
```tsx
navigation?.navigate('ScreenName')
```
Do NOT use `useNavigation()` hook — use the prop passed down from React Navigation's Stack.Screen.

### 6. Theme System
All colors, spacing, typography, and border radius come from `src/theme.ts`. Do NOT hardcode colors or sizes. Always import from theme:
```tsx
import { colors, spacing, borderRadius, typography } from '../../theme';
```

### 7. Component Library
The project has custom atoms/molecules in `src/components/`. Always use these instead of creating new ones:
- `Button` — primary action buttons
- `Card` — container cards
- `TopAppBar` — screen headers
- `ListRow` — list items
- `Divider` — separators
- `DraggableBottomSheet` — bottom sheets
- `BottomNavBar` — bottom navigation
- `VehicleOptionCard` — vehicle selection cards

### 8. Navigation Helpers
`BottomNavBar` emits tab ids, not route names. Screens that render it must wire tabs through
`src/navigation/tabRoutes.ts`:
```tsx
import { navigateToTab } from '../../navigation/tabRoutes';
<BottomNavBar currentTab="home" onTabPress={(id) => navigateToTab(navigation, id)} />
```

### 9. No Dead Buttons
Every interactive element must do something. Never bind `onPress` to a bare optional prop
(`onPress={onHelp}`) — it silently no-ops when the prop isn't supplied. Use the prop with a
navigation fallback instead:
```tsx
onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
```
If a control has no meaningful behaviour in a mock-only prototype, render it as a `View`
rather than a `Pressable`. Run `node scripts/check-wiring.js` to verify.

---

## Folder Structure

```
pickup/
├── App.tsx                    # Root — NavigationContainer + flat Stack.Navigator with all 76 screens,
│                              # plus a `Gallery` route listing every screen for direct access.
│                              # initialRouteName is LoginScreen.
├── index.ts                   # Entry point
├── src/
│   ├── theme.ts               # Design tokens (colors, spacing, typography, borderRadius, shadows)
│   ├── data/
│   │   └── mockData.ts        # All mock/hardcoded data and strings
│   ├── components/
│   │   ├── atoms/             # Button, Card, InputField, Divider, etc.
│   │   ├── molecules/         # TopAppBar, ListRow, VehicleOptionCard, etc.
│   │   ├── DraggableBottomSheet.tsx
│   │   └── BottomNavBar.tsx
│   ├── screens/
│   │   ├── auth/              # Login, OTP, Permission, RecordingConsent (4 screens)
│   │   ├── home/              # HomeScreen (1 screen)
│   │   ├── booking/           # Address search, vehicle selection, review, etc. (14 screens)
│   │   ├── tracking/          # Driver search, assignment, live tracking (12 screens)
│   │   ├── logistics/         # Multi-drop, pickup/drop OTP, delivery summary (12 screens)
│   │   ├── payment/           # Payment selection, processing, receipt, etc. (10 screens)
│   │   ├── profile/           # Profile, settings, trip history (5 screens)
│   │   └── support/           # Chat, cancellation, ratings, errors, etc. (18 screens)
│   ├── navigation/            # Navigation type definitions
│   ├── types/                 # TypeScript type definitions
│   ├── constants/             # App constants
│   ├── hooks/                 # Custom hooks
│   └── utils/                 # Utility functions
├── WIRING_MAP.md              # Complete screen-to-screen wiring documentation
└── AGENTS.md                  # This file
```

---

## All 76 Screens & Their Wiring

Every screen is wired. The complete map is in `WIRING_MAP.md`. Here's the summary:

### Auth Flow (5 screens)
```
LoginScreen → OtpVerificationScreen → PermissionScreen → RecordingConsentScreen → HomeScreen
```

### HomeScreen Hub
HomeScreen has bottom tabs: **Home, Trips, Account** — each navigates to its section.
There is deliberately **no Wallet feature** in this app: no stored balance, no wallet tab, no wallet
payment method. Payment methods are UPI, card and cash only.
"Start Booking" and "Enter drop location" → AddressSearchScreen.

### Booking Flow (14 screens)
```
AddressSearchScreen → SelectDropLocationScreen → SelectLocationScreen → MultiDropOverviewScreen
→ SelectVehicleScreen → GoodsDetailsScreen → GoodsInsuranceScreen → ReceiverDetailsScreen
→ FareEstimateScreen → ReviewBookingScreen → ValidateBookingScreen → BookingConfirmedScreen
→ FindingDriverScreen (auto 3s timer)
```

### Driver Search & Assignment (8 screens)
```
FindingDriverScreen → NoDriversAvailableScreen → AssignmentFailedScreen → DriverFoundScreen (auto 3s)
→ DriverAssignedScreen → DriverAssignedExpandedScreen → CallDriverScreen → ActiveTripChatScreen
```

### Cancellation Flow (6 screens)
```
CancellationReasonScreen → CancellationChargeConfirmationScreen → CancellationConfirmationScreen
→ CancellationResultScreen → TripCancelledStatusScreen → CustomerLiveTrackingScreen
```

### Live Tracking & Logistics (17 screens)
```
CustomerLiveTrackingScreen → LiveTrackingScreen → ActiveTripTrackingScreen
→ LiveTrackingExceptionsScreen (auto 3s) → MapLoadingScreen (auto 3s) → ReconnectingScreen (auto 3s)
→ NetworkErrorScreen → RouteUnavailableScreen → MultiDropProgressScreen → CurrentDropDetailsScreen
→ PickupOtpVerificationScreen → PickupVerifiedSuccessScreen → NextDropScreen
→ DropOtpVerificationScreen → DropCompletedStateScreen → FinalDeliverySummaryScreen
→ TripCompletedScreen → TripCompletedSummaryScreen
```

### Payment Flow (10 screens)
```
PaymentSelectionScreen → PaymentMethodScreen → PaymentMethodSelectedScreen
→ PaymentProcessingScreen (auto 3s) → PaymentPendingScreen → PaymentSuccessfulScreen
→ CashPaymentStatusScreen → PaymentFailedScreen → DigitalReceiptScreen
→ DriverRatingScreen → WrittenReviewScreen
```

### Profile (5 screens)
```
ProfileScreen → CustomerSettingsScreen → SavedAddressesScreen
→ TripHistoryScreen → HistoricalTripDetailScreen → ShareTrackingSheetScreen
```

### Error/Edge Case Screens (7 screens)
```
EmptyStateScreen → ErrorScreen → SearchUnavailableScreen → LogoutConfirmationScreen
→ NotificationCenterScreen → HomeScreen
```

### Auto-Timer Screens
These screens have NO buttons — they auto-advance after 3 seconds using `useEffect` + `setTimeout`:
- BookingConfirmedScreen → FindingDriverScreen
- DriverFoundScreen → DriverAssignedScreen
- PaymentProcessingScreen → PaymentPendingScreen
- LiveTrackingExceptionsScreen → MapLoadingScreen
- MapLoadingScreen → ReconnectingScreen
- ReconnectingScreen → NetworkErrorScreen

---

## How to Run

```bash
# Install dependencies
npm install

# Start Expo dev server (with tunnel for phone testing)
npm run start -- --tunnel -c

# Then scan QR code with Expo Go app on your phone
```

---

## Current Project Status (as of 30 Aug 2026)

| Item | Status |
|---|---|
| UI Screens Built | 76/76 Done |
| All Screens Wired | 76/76 Done |
| Bottom Tabs Working | Done |
| Back Buttons Working | Done |
| Auto-Timer Screens | 6/6 Done |
| Pushed to GitHub | Done |
| TypeScript Errors | 0 blocking |
| Backend/API | Not started (prototype only) |
| Real Maps | Placeholder views |
| Real Payments | Mock only |

### What's Next
The prototype is complete and ready for client demo. Future phases would involve:
1. Adding real map integration (Google Maps / Mapbox)
2. Backend API integration
3. Real authentication (OTP via SMS)
4. Payment gateway integration
5. Real-time driver tracking via WebSockets
