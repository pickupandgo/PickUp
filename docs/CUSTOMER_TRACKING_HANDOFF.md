# Customer tracking handoff — BLOCKED, no Customer changes made

Reference: `pickupandgo/PickUp`, branch `latest-vicky-customer-app`, inspected commit `414a433077ce6d55866b837c09f5acd9f63e6b78`. Installed teammate-built APK SHA/configuration remain unverified. Confirm its source revision before patching. Preserve the teammate's UI/map components and working `/v1/routes/road` routing.

## Exact files for the Customer developer

- `src/screens/tracking/CustomerLiveTrackingScreen.tsx`: Driver polling effect, approximately lines 128–150 at the inspected commit.
- `src/screens/tracking/DriverAssignedScreen.tsx`: equivalent polling effect, approximately lines 99–118.

These are the two polling consumers requiring changes. `MapCanvas.native.tsx` already receives changed coordinates; no map-component rewrite is indicated by the source investigation. Do not mistake marker bitmap snapshot refresh (`tracksViewChanges`) for position polling.

## Stale/error visibility — BLOCKED

Current code catches failed polls while retaining the prior `driverPoint`. That point can keep appearing live after GPS loss, network errors or Engine unavailability. An Engine correction cannot update Customer presentation logic.

Minimal change: retain last known position separately from freshness and fetch state. Track server `capturedAt` and last successful response; derive LIVE vs STALE/UNAVAILABLE/AUTH_ERROR from capture age and the actual response/error. Render the last known point as stale or hide it, and show a clear reconnecting/unavailable state using the existing design. Do not assign a default coordinate, relabel a retained point as live, or update freshness on a failed request. A response older than 60 seconds is not live; a later failure is distinguishable from fresh GPS even inside that window. A local timer must expire status even if polling stops or no response arrives. Do not call an authorization failure merely GPS loss.

## Poll ordering — BLOCKED

The interval can start another request before the previous one finishes. An older successful response can then overwrite newer Driver coordinates, including after a trip/Driver switch or unmount.

Minimal change in both effects: use single-flight polling (start the next poll after completion, maintaining the existing intended cadence), an effect generation/request sequence guard, and monotonic `capturedAt` acceptance per Driver/trip. Reset comparison state when the Driver/trip changes. Cancel pending work where supported and always ignore responses after effect cleanup. Capture timestamps determine coordinate order; request order alone cannot compensate for stale server data. Ignore duplicate/older captures for coordinates while still updating the appropriate connectivity state. Never modify Customer road routing to implement this fix.

## Expected Engine contract

- Authenticated `GET /drivers/:trip.driverId` remains the endpoint; use the existing Firebase session/client. Access is limited to the assigned active-trip Customer (or the Driver's own identity).
- Success remains `{ success:true, driver:{ id, latitude, longitude, ... } }`, with `capturedAt` UTC epoch milliseconds, `receivedAt` ISO UTC, `accuracy` meters, `lastSeen` equal to capture milliseconds, `locationStatus:'LIVE'`. No default coordinates are returned as live. `receivedAt` is not GPS capture time.
- Unknown/expired fix: 404 with top-level Engine `code:'LOCATION_UNAVAILABLE'`. Unauthorized/foreign assignment: 403; invalid/expired auth: 401; service/database/network failures remain errors. Do not depend solely on a numeric 503: a network or database failure may have another transport/server status.
- GPS older than 60 seconds is unavailable even after Engine app restart. On trip completion/cancellation the former Customer no longer has access to later Driver positions. Stop the poll appropriately without misreporting logout or an active assignment.
- Pickup, transit and all open drops retain the same tracking endpoint and successful shape. `/v1/routes/road` stays Customer-only and unchanged.

## Focused acceptance tests for the teammate

1. Feed increasing capture times with changing coordinates during assigned/pickup/transit/drop stages; marker follows the newest fix and freshness uses the original capture time.
2. Return request B before older request A; A cannot move the marker backwards. Repeat across Driver/trip switch, effect cleanup and unmount. Duplicate capture timestamps do not rewind the point.
3. Test slow requests longer than 5 seconds: no overlapping poll backlog; abort/cleanup cannot update obsolete screens.
4. Freeze GPS, fail polls, return LOCATION_UNAVAILABLE, 401, 403 and server/network failures. Retained points are explicitly stale/unavailable, never newly live; local expiration still occurs without a fresh response.
5. Reconnect with a newer fix and confirm LIVE status and movement recover. Old data must not become current merely because HTTP succeeded.
6. Run the two-physical-device procedure in `TRACKING_ROUTING_REVIEW.md`. Confirm the existing road-following route and UI remain unchanged.

For build evidence, share package/versionCode/versionName, exact source SHA and dirty-worktree status at build time, build timestamp/timezone, variant, APK SHA-256, signing certificate SHA-256, Firebase project ID, Engine/Backend HTTPS hosts and Maps-key restriction type. Do not share keys, tokens, service-account files or signing private keys. Version 1.0/code 1 alone cannot establish which source was installed.
