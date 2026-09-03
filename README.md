# PickUp Driver

The **driver-side** mobile app for the PickUp ride‑hailing & delivery platform, built with [React Native](https://reactnative.dev). Drivers use it to go online, receive and accept trip offers, navigate to pickups and drops, verify pickups/drops with OTP, capture delivery proof, chat with customers, and track their earnings and wallet.

> The app runs in **mock mode** out of the box — no backend required. Point it at a real Core Engine by setting `API_BASE_URL` in `.env`.

---

## Features

- **Authentication** — Phone + OTP login (Firebase Auth), language selection, and vehicle selection during onboarding.
- **Driver Home** — Online/offline toggle, live map, and a notification center.
- **Trip lifecycle** — New trip offers, navigate to pickup, arrival, pickup OTP, active trip, multi-stop journeys, drop OTP, delivery-proof camera capture, and trip completion.
- **In‑trip chat** — Real-time messaging with the customer during an active trip.
- **Cancellation flow** — Reason selection, processing, and result screens.
- **Earnings** — Earnings history and per-trip earnings breakdowns.
- **Wallet** — Balance, recharge flow, and full transaction history.
- **Trip history** — Past trips with detailed views.
- **Account & compliance** — Profile, KYC documents, vehicle documents/status, subscription management, settings, and account-restricted handling.
- **Maps & routing** — Google Maps rendering, geocoding, directions, and driver/trip matching + dispatch services.

## Tech Stack

| Area | Technology |
|------|-----------|
| Framework | React Native `0.87`, React `19` |
| Language | TypeScript |
| Navigation | React Navigation (native-stack + bottom-tabs) |
| Maps | `react-native-maps` + Google Maps Platform |
| Auth | Firebase Auth (`@react-native-firebase`) |
| Animation / gestures | Reanimated 4, Gesture Handler, `@gorhom/bottom-sheet` |
| Config | `react-native-config` (build-time `.env`) |
| Storage | AsyncStorage |
| Testing | Jest + React Test Renderer |
| Linting / format | ESLint + Prettier |

## Project Structure

```
Driver/
├── App.tsx                 # App entry component
├── index.js                # React Native registration
├── android/ · ios/         # Native projects
├── src/
│   ├── components/          # Reusable UI components
│   ├── config/              # Environment config (env.ts)
│   ├── data/                # Mock data / seed data
│   ├── hooks/               # Custom React hooks
│   ├── location/            # Location handling
│   ├── map/                 # Map components & helpers
│   ├── navigation/          # RootNavigator, MainTabNavigator, stacks
│   ├── screens/             # Feature screens
│   │   ├── auth/            #   login, OTP, language & vehicle selection
│   │   ├── home/            #   driver home, notifications
│   │   ├── trip/            #   offer → pickup → active → drop → completed, chat, cancel
│   │   ├── trips/           #   trip history
│   │   ├── earnings/        #   earnings history & details
│   │   ├── wallet/          #   wallet, recharge, transactions
│   │   ├── account/         #   profile, KYC, vehicle docs, subscription, settings
│   │   └── shared/          #   placeholder / shared screens
│   ├── services/            # Domain services
│   │   ├── api/             #   ApiClient, ApiError
│   │   ├── engine/          #   dispatch, matching, directions, geocoding
│   │   ├── auth/ chat/ earnings/ kyc/ routing/ subscription/
│   │   ├── tracking/ trip/ wallet/
│   ├── types/ · utils/      # Shared types & utilities
│   └── theme.ts             # Design tokens / theme
└── __tests__/ · __mocks__/  # Tests and mocks
```

## Prerequisites

- **Node.js** `>= 22.11.0`
- **React Native environment** set up per the official [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide
- **Android**: Android Studio + SDK, a running emulator or a connected device
- **iOS** (macOS only): Xcode + CocoaPods (via Ruby Bundler)

## Getting Started

### 1. Install dependencies

```sh
npm install
```

For iOS, install the native pods (first clone and after any native dependency change):

```sh
bundle install          # first time only, installs CocoaPods
bundle exec pod install # run from the ios/ setup as needed
```

### 2. Configure the environment

Copy the example env file and fill in your values:

```sh
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `API_BASE_URL` | Core engine REST API base URL (no trailing slash). **Leave empty to run in mock mode.** |
| `WS_ENDPOINT` | WebSocket endpoint for real-time features. |
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform key (Places API New, Geocoding, Directions, Android Maps SDK). |

> ⚠️ These values are inlined at **build time** (via `react-native-config`), not read at runtime. A **native rebuild is required** after changing any of them. Never commit your real `.env`.

### 3. Start Metro

```sh
npm start
```

### 4. Build and run

In a separate terminal:

```sh
# Android
npm run android

# iOS (macOS only)
npm run ios
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the Metro bundler |
| `npm run android` | Build & run on Android emulator/device |
| `npm run ios` | Build & run on iOS simulator/device |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Jest test suite |

## Mock Mode

When `API_BASE_URL` is empty, the app runs fully against mock adapters and seed data (`src/data/`) — useful for UI development and demos without a live backend. As soon as a backend URL is provided, the domain services switch to real API/WebSocket calls automatically (`src/config/env.ts`).

## Troubleshooting

- Clear the Metro cache: `npm start -- --reset-cache`
- Rebuild native after `.env` changes (values are compiled in, not read at runtime).
- General React Native issues: see the [Troubleshooting guide](https://reactnative.dev/docs/troubleshooting).

## License

Private — © PickUp. All rights reserved.
