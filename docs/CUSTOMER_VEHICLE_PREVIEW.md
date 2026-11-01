# Customer vehicle map preview

User-approved on 2026-11-01: read-only pre-booking vehicle graphics, not driver selection or dispatch authority. No driver counts are displayed.

## Contract

Authenticated `GET /drivers/preview?lat=26.2&lng=73.1&radius=5&vehicleCategory=TWO_WHEELER` uses the existing global Firebase guard. Supported canonical categories: TWO_WHEELER, THREE_WHEELER, MINI_TRUCK, PICKUP_TRUCK. Coordinates must be finite/in range; radius defaults to 5 km and is capped at 10 km. Response has `success`, server `generatedAt` and `vehicles`, each with an opaque per-viewer alias `key`, rounded coordinates (4 decimals), verified `vehicleCategory`, and original GPS `capturedAt`. No Firebase UID, name, phone, rating or financial information is exposed. Response is no-store.

Preview reuses Engine presence, durable fresh GPS, active-trip exclusion and Backend verified eligibility. Up to the nearest 30 candidates are checked, at most 4 concurrent eligibility calls, with a 6-second eligibility budget. Unknown eligibility never becomes a displayed vehicle; if none can be verified during outage/deadline it returns 503. It rechecks GPS, busy state and presence before returning. Rate limit: 12 requests/minute per authenticated subject per Engine process, bounded/pruned limiter state. Aliases reset on Engine restart and differ between viewers. No driver can be chosen from the map; POST /rides and dispatch/assignment verification remain unchanged.

Customer polls every 8 seconds after each completed request, only while focused/foreground and authenticated. Category changes abort old requests and clear old markers. Original capture age and network time determine local expiry; failures clear icons rather than representing stale availability. Native Android interpolation runs only for actual changed GPS coordinates. Existing bundled vehicle assets are used. No counts, invented GPS or random animation is added.

## Deployment and limits

Deploy the updated Engine and the new Customer build. Backend and Driver source are unchanged by this feature; no new migration or secret is needed. Existing engine_driver_positions migration/GPS publishing must already be operational. Before Engine deployment, the app may show a preview-unavailable/retry state; it does not fall back to the older unsanitized nearby list.

Existing dispatch presence remains process-local. This preview deliberately does not claim complete fleet availability or multi-instance consistency; it only displays verified fresh vehicles known to the handling Engine. Horizontal presence/dispatch coordination is a separate existing release concern. Counts are not inferred from the limited preview.

Local verification: Engine preview/controller unit tests, existing dispatch-progression tests, TypeScript, targeted lint and Nest build; Customer category-switch/late-response, expiry/failure, response-validation, real-coordinate animation and vehicle/map regression tests. Controlled live drivers and deployed-Engine verification remain pending. No production data was created/reset and no deployment performed.


## Booking-screen refresh M4 (2026-11-01)
Finding mode also consumes this preview, disabled immediately on assigned/terminal state, blur/background, or observer failure. Marker churn is excluded from route-camera fitting. Preview errors never mean dispatch exhaustion. No driver count or availability promise is shown.
Ride responses now include additive `serverTime` and `offerRequestedAt` alongside existing `offerExpiresAt`, `searchStatus` and `offerStatus`. These are read-only response-window metadata. There is no overall search deadline in the current engine. Customer card progress describes the current offer response window; zero seconds waits for server progression rather than cancelling the booking. Missing/malformed/stale timing uses indeterminate progress. No schema migration or dispatch policy change. Deploy these Engine changes (and the preview endpoint) before the M6 live check; no deployment was performed here.

### M6 live observation
Authenticated GET `/drivers/preview` returned 403 `LOCATION_ACCESS_DENIED` on 2026-11-01. That local error belongs to the single-driver access guard; local explicit preview route is registered before `:id`. Verify the deployed Engine commit includes the preview controller/service changes and route order. Do not relax the assigned-driver guard or use legacy unfiltered enumeration as a fallback. Authenticated recovery returned no active ride after normal Home cleanup. Deployment was not performed by this diagnostic.
