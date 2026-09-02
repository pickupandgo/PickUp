# Pickup — Customer App

React Native + Expo customer app for the Pickup logistics platform, wired to the
[Pickup-Go-Core-Engine](https://github.com/vickysingh009/Pickup-Go-Core-Engine)
backend.

Branches:
- `main` — UI prototype (mock data, gallery of screens).
- `UIwithEngine` — UI integrated with the real engine (**you are here**). Live
  maps, real fare/driver/trip APIs, GPS pickup, live tracking.

The driver app (`pickup-driver/`) is a separate Expo project used only for
internal testing until the production driver UI is ready. It lives inside this
repo so `git clone` gives you both apps at once. It has its own `package.json`,
its own `.env`, and its own Expo instance on port 8082.

## Prerequisites

Every teammate needs these installed once:

| Tool             | Version         | Notes                                          |
| ---------------- | --------------- | ---------------------------------------------- |
| Node.js          | 18.x or 20.x    | Match project's Expo SDK 54 requirements       |
| Git              | any recent      | For cloning                                    |
| Expo Go (phone)  | 54.0.8+         | iOS: App Store · Android: Play Store           |
| A phone          | iOS or Android  | Testing happens on device, not simulator       |

You **do not** need Xcode, Android Studio, Java, or the platform SDKs. Expo Go
runs the JS bundle over the tunnel.

## Two things the project owner must give you

Both are secret and **not** in this repo:

1. `EXPO_PUBLIC_API_BASE_URL` — the public HTTPS URL of the engine. Right now
   this is a Cloudflare quick tunnel that changes every time the owner restarts
   it (e.g. `https://bicycle-reaches-gzip-pet.trycloudflare.com`). Ask on the
   team chat for the current one.
2. `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — a Google Maps Platform key with **Places
   API (New)**, **Geocoding API** and **Directions API** enabled. Restricted by
   platform + bundle id in the Google Cloud Console.

If you want to run the engine yourself instead of using the shared tunnel, see
[Running the engine locally](#running-the-engine-locally) below.

## First-time setup

```bash
# 1. clone and switch to the integrated branch
git clone https://github.com/Rajpatel800/PICKUP_UI.git pickup
cd pickup
git checkout UIwithEngine

# 2. install dependencies
npm install

# 3. create your .env from the template
cp .env.example .env      # macOS / Linux
copy .env.example .env    # Windows cmd
```

Open `.env` and fill in the two values from the section above:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://<current-tunnel-or-your-own>.trycloudflare.com
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
```

## Running the app

```bash
# starts Metro with a public tunnel so any phone on any network can connect
npm run start -- --tunnel -c
```

A QR code will show up in the terminal.

- **Android:** open Expo Go → "Scan QR code".
- **iOS:** open the Camera app → point at the QR → tap the "Open in Expo Go"
  banner. (Do **not** use Expo Go's built-in scanner on iOS 17+, it's
  unreliable.)

The bundle will download once (30-60 s over tunnel) and the app opens.

### If the QR won't connect

- Confirm your Expo Go is at least **54.0.8**. Older versions won't load an
  SDK 54 project.
- Try `npm run start -- --tunnel -c` — the `-c` clears Metro's cache, which
  fixes most "stuck bundling" issues.
- If Cloudflare's tunnel is flaky, restart with `npm run start` (LAN mode) but
  then your phone must be on the same Wi-Fi as your laptop.

### Iterating

- Change any file → Metro hot-reloads.
- If a hook change doesn't take effect, **fully close and reopen Expo Go**
  (swipe from recents). React Fast Refresh occasionally misses hook state.
- If you edit `.env`, restart `npm run start` — env vars are baked at Metro
  boot, not hot-reloaded.

## Running the driver app

The customer app is useless without an online driver, and simulating one from
the terminal is fine for API tests but not for end-to-end UX. Use the real
driver app on a second phone:

```bash
cd pickup-driver
npm install
copy ..\.env .env         # Windows — reuse the same URL and Maps key
cp ../.env .env           # macOS / Linux
npm run start -- --tunnel --port 8082
```

The `--port 8082` matters — the customer app runs Metro on 8081, so the driver
app needs its own port to avoid a collision. A separate QR appears; scan it
from Expo Go **on a different phone** (or a second Expo Go install on the same
phone works too).

On the driver app: pick a Driver ID (auto-randomised, or override in the
input field), hit **GO ONLINE**, allow location permission. Within a few
seconds you should appear as a truck marker on the customer's home map.

## Testing the full flow

The engine has no seed data. To see anything meaningful:

1. **Someone must be online as a driver.** Options:
   - Run the driver app on a second phone (see
     [Running the driver app](#running-the-driver-app)).
   - Or run the driver simulator: `powershell scripts/driver-sim.ps1` from the
     project root. This impersonates a driver via engine APIs so you can test
     matching / assignment from the customer app alone.
2. On the customer app: allow location permission → home screen shows a truck
   marker for each online driver within 8 km.
3. Tap **Start Booking** → search a drop location → step through vehicle,
   goods, review → **Book**. The client-side matching loop offers the ride to
   the nearest driver first.
4. The driver accepts (from their app or the simulator prompt) → customer
   flows through `DriverAssigned` → `PickupOtpVerification` → live tracking
   → completion.

## Running the engine locally

If the shared tunnel is down or you want an isolated backend, you can host the
engine yourself:

```bash
# clone the backend (separate repo)
git clone https://github.com/vickysingh009/Pickup-Go-Core-Engine.git engine
cd engine
npm install
npm run start:dev            # boots on http://localhost:3000
```

To expose it over the internet so your phone (on any network) can reach it,
install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
and run:

```bash
# from the pickup repo root:
powershell scripts/tunnel.ps1
```

The script starts a quick tunnel, prints the new HTTPS URL, and updates both
`.env` files (customer app + driver app if present) automatically. Then restart
`npm run start` so Metro picks up the new URL.

## Diagnostics

Before pushing changes, verify nothing regressed:

```bash
npx tsc --noEmit                # 0 errors expected
node scripts/check-wiring.js    # every screen reachable, no orphan routes
node scripts/check-text-nodes.js # no stray "Text strings must be rendered..." bugs
```

Additional helpers in `scripts/`:

- `smoke-engine.ps1` — hits every engine endpoint end-to-end
- `check-maps-key.ps1` — verifies the Google Maps key has the right APIs enabled
- `driver-sim.ps1` — headless driver for matching tests

## Project structure

```
src/
├── api/            # Engine, geocoding, directions, matching, typed HTTP
├── components/     # Reusable UI (atoms/molecules/organisms) + MapCanvas
├── config/         # env.ts — reads EXPO_PUBLIC_* into a typed shape
├── data/           # Mock strings + recent-locations sample
├── hooks/          # useNearbyDrivers, useTripStatus, useRoute, usePlaceSearch
├── navigation/     # Route names, bottom-tab wiring
├── screens/        # All 76 screens grouped by domain
├── state/          # BookingContext, persisted customerId
├── theme.ts        # colors, spacing, typography, borderRadius, shadows
└── types/          # Shared type aliases
```

Rules for the codebase live in [`AGENTS.md`](AGENTS.md) — read that if you're
touching any screen. Every wire between screens is documented in
[`WIRING_MAP.md`](WIRING_MAP.md).

## Common gotchas

- **`Cannot find name 'DOMException'` in Metro logs** — Hermes doesn't ship
  `DOMException`. The custom `AbortError` in `src/api/matching.ts` replaces it.
  Don't reintroduce `DOMException` anywhere.
- **Map recentres by itself** — `fitToMarkers` on the tracking screens only
  refits when the marker _set_ changes (via `markerIdsKey`), not on every GPS
  tick. Home has `fitToMarkers` disabled entirely so it never jumps.
- **Driver offline → online → invisible on customer** — engine flips
  `isAvailable` to false on ride accept but never back. The driver app has a
  watchdog that re-flips it after trip completion. If you see a stuck driver,
  they probably have an abandoned trip — check with
  `curl <API>/trips/active/driver/<id>`.
- **Customer sees no drivers** — pull up the "N drivers nearby" pill on Home;
  it tells you if the API is unreachable, empty, or loading.

## Publishing

This app targets both stores (`com.pickup.customer`) and is **not** an MVP.
Before any release build, work through the production checklist that lives
alongside `AGENTS.md`. In particular, the Google Maps key needs to move behind
the backend before the first store submission — it currently ships in the
bundle.
