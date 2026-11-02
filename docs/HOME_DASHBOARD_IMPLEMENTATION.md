# Home dashboard data integration

## Sources traced in the local backend

Backend inspected read-only: `D:/PU/PickUp-raj_backend/src`.

| Dashboard | Existing authenticated endpoint | Mapping |
| --- | --- | --- |
| Vehicle | GET `/v1/drivers/me/onboarding` | `activeVehicle`, otherwise exactly one `vehicles[].active`, otherwise the sole registration only. `makeModel`, `registrationNumber`, `category`, `status`, `active`, `rejectionReason` are rendered directly. Multiple unselected registrations produce a manage-vehicles prompt. |
| Wallet | GET `/v1/wallet` | `balancePaise / 100` → rupees; INR symbol; `status` preserved. Only posted ledger balance is displayed. Pending top-ups do not become balance until the server confirms/credits them. |
| Today | **No verified daily endpoint exists** | Shows an em dash and an unavailable notice. No sample values, lifetime totals or inferred earnings are used. |
| Earnings details | GET `/v1/earnings/summary` and `/v1/earnings` via the existing EarningsHistory screen | Lifetime totals and server-defined earning states remain in the existing details screen. |
| New vehicle registration | POST `/v1/drivers/me/onboarding/vehicles` | Existing `createVehicle({ category, makeModel, registrationNumber })`; no frontend activation or approval. |

Onboarding uses Firebase `currentUser.getIdToken()` and the existing payments base URL. Wallet uses the existing payments client with Firebase token refresh. No driver ID is supplied from UI input. The dashboard uses the backend wallet directly, bypassing the development mock-wallet adapter. Failed refreshes clear the affected displayed value; they never become zero. Identity changes invalidate outstanding responses and clear financial data.

`makeModel` is the backend's combined vehicle name/model field. There are no separate manufacturer, catalogue image URL, selected-vehicle ID, reserved balance or pending balance fields in the inspected contracts; none were invented. The wallet is labelled WALLET, not a newly asserted withdrawable/available balance: the server exposes one ledger `balancePaise` only. Backend confirmation is needed before introducing any separate available/pending/reserved figures.

## Daily earnings dependency

Inspected `earnings/earnings.controller.ts`, `earnings/earnings.dto.ts`, `earnings/earnings.service.ts` and the driver app API contracts. `summaryForDriver` filters only by driver ID and groups lifetime rows by status. The summary controller accepts no date/timeframe query. List filters are status, cursor and limit only. The older generic app `/earnings/summary?timeframe=day` service does not match this backend and is no longer used by Home.

`createdAt` on an earning is not an authoritative completed-trip business date. Summing a page of earnings or lifetime payout-state totals would invent a daily calculation and could omit trips or misdate delayed payment records.

`DailyEarningsSource` and `DailyEarnings` in `HomeDashboardService.ts` are **proposed frontend interfaces**, not claims about an implemented server DTO. The backend must approve/provide:

- An authenticated daily summary endpoint or a documented extension of an existing endpoint. No URL has been guessed or added to network calls.
- A business date (`YYYY-MM-DD`) and explicit `Asia/Kolkata` timezone, with an inclusive local midnight and exclusive next midnight window.
- The business-approved metric (proposed: `NET_DRIVER_EARNINGS`, matching the server's existing `netAmountPaise` definition: gross less platform fee, other deductions and TDS), integer paise and INR currency.
- An authoritative completed-trip count and documented treatment of delayed payments, cash/mixed settlements, refunds and adjustments.

Until supplied, `getToday` explicitly returns unavailable. Once an adapter exists, the service validates date, timezone, currency, metric and numeric invariants. Tests for genuine zero, one/multiple trips and midnight boundaries exercise that future adapter boundary, **not a deployed daily endpoint**.

## Vehicle artwork and UI

Uses the existing VehicleAvatar mapping: TWO_WHEELER → bike; THREE_WHEELER → cargo three-wheeler; FOUR_WHEELER/MINI_TRUCK → mini-truck; PICKUP_TRUCK → pickup. The existing asset filenames for mini-truck and pickup are visually reversed, so the existing corrected mapping is retained.

Status labels are the actual backend values (VERIFIED, SUBMITTED, IN REVIEW, REJECTED, DRAFT, INACTIVE). Existence alone never yields APPROVED. A single pending/rejected registration is shown as such; it is not activated. The badge sits within the flexible vehicle-details column so it cannot overlap the name/registration. A loading indicator/skeleton, API retry, no-registration action and multiple-registration manage action are provided.

DETAILS and RECHARGE share DashboardAction: white surface token, existing startup-blue-dark text token, light secondary-container border, rounded corners, padded hit area and tinted pressed state. The white cards remain intact. Their footers wrap; the dashboard stacks the two cards below 360dp or with font scale over 1.3. The existing scroll view and bottom-tab safe area remain.

Navigation: EarningsTab/EarningsHistory; WalletTab/Recharge with `initial: false`; AccountTab/VehicleStatus. Existing Razorpay/payment verification behavior is unchanged.

## Refresh

Loads independently on screen focus, app resume, trip identity/status transition and pull-to-refresh. An IST-midnight timer clears/reloads the prior day's data; no frequent dashboard polling is introduced. Focus return after successful/failed/cancelled recharge reloads the server wallet. In-flight loads are deduplicated; generation and identity guards discard stale responses.

## Exact implementation files

- src/services/dashboard/HomeDashboardService.ts (new)
- src/hooks/useHomeDashboard.ts (new)
- src/components/molecules/CurrentVehicleCard.tsx (new)
- src/components/molecules/DashboardAction.tsx (new)
- src/components/molecules/EarningsCard.tsx
- src/components/molecules/WalletCard.tsx
- src/components/atoms/VehicleAvatar.tsx (exports existing category mapping for regression checks)
- src/screens/home/DriverHomeScreen.tsx
- src/screens/account/VehicleStatusScreen.tsx
- __tests__/homeDashboard.test.tsx (new)
- __tests__/homeDashboardRefresh.test.tsx (new)
- __tests__/homeDashboardNavigation.test.tsx (new)
- __tests__/homeVehicleRegistration.test.tsx (new)
- docs/HOME_DASHBOARD_IMPLEMENTATION.md (this report)

No live authenticated partner account has been queried; integration is traced against local backend source and verified through controlled regression responses.

## Verification results

- `npm run typecheck`: PASS, no TypeScript errors.
- Changed-file ESLint: PASS with 0 errors; 5 existing `no-void` style warnings in VehicleStatusScreen remain.
- Seven Jest suites: **102 tests passed**. Command: `npx --no-install jest --runInBand --runTestsByPath __tests__/homeDashboard.test.tsx __tests__/homeDashboardRefresh.test.tsx __tests__/homeDashboardNavigation.test.tsx __tests__/homeVehicleRegistration.test.tsx __tests__/earnings.test.ts __tests__/payments.test.ts __tests__/topUpFlow.test.ts`.
- Coverage includes active/multiple/ambiguous/pending/rejected/empty vehicles, malformed responses, API failure, every supported category mapping, genuine zero vs unavailable balances, future daily date validation, IST midnight, trip completion refresh, confirmed-balance refresh, stale failures, concurrent refresh deduplication, late responses after logout, registration API wiring, navigation, white/blue/pressed styles, and 320/390/800dp plus enlarged-text layout branches. Existing payment suites cover backend-confirmed, failed and cancelled top-ups.
- Android `assembleDebug assembleRelease`: both variants built successfully. Existing build signing configuration retained (release currently uses the project's debug signing key; these are verification APKs).
- APKs: `android/app/build/outputs/apk/debug/app-debug.apk` and `android/app/build/outputs/apk/release/app-release.apk`. Build log: `android-dashboard-build.log`.
- Device visual QA and live authenticated API/payment transactions were not performed. Responsive layout assertions are component tests, not device screenshots. Daily endpoint examples are adapter-contract tests, not live earnings verification.
