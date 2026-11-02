# Partner notifications: implementation and backend handoff

## Delivered in the Driver app

Profile's `handleNotifications` incorrectly called `navigate('Settings')`. It now opens
the single `Notifications` route in RootNavigator. Profile's header bell and menu row,
Home's bell and Wallet's bell use that same route. Settings retains its own callback.
Root-stack navigation preserves the originating tab/stack for Back. The inbox has a
stable route ID, preventing duplicate instances. No auth bypass or existing auth policy
was changed.

MainActivity installs the existing react-native-screens RNScreensFragmentFactory before
super.onCreate, as recommended in the installed package README, so Android activity
restoration does not try to recreate unsupported screen fragments.

The mock NotificationCenter route and mock notification records have been removed.
NotificationsScreen provides recipient-record rendering, backend unread count, read-one,
read-all, cursor pagination, refresh, loading/empty/error/retry and full-body expansion.
NotificationInbox is session-scoped memory, deduplicates records, and rejects late
responses after account changes. Push payloads are never saved as business history.

**History is unavailable in the inspected backend.** The production history port is
explicitly unavailable: no invented HTTP endpoint is called, no sample records are
rendered and the unread badge remains unknown/hidden rather than showing zero. The
history UI/controller are exercised using test-only repository fixtures. They are not
claimed as a live backend history integration. Connect a recipient-authorized
NotificationHistory adapter only after the APIs below are implemented and verified.

## Existing backend integration

Inspected `D:\PU\PickUp-raj_backend`:

- `src/notifications/notifications.controller.ts`: authenticated routes.
- `src/notifications/notifications.dto.ts`: token/preference DTOs.
- `src/notifications/notifications.service.ts`: token ownership and legacy push sender.
- `prisma/schema.prisma`: DeviceToken and NotificationPreference exist; no persisted
  notification-inbox table or notification outbox exists.
- `src/engine/internal-bookings.controller.ts`, `src/chat/chat.service.ts`: event producers.

The app uses only these verified notification routes:

- `POST /v1/notifications/tokens`: `{ token, role: 'DRIVER', platform: 'ANDROID', language: 'en' | 'hi' }`.
  Response includes `{ token, userId, role, platform, language }`.
- `DELETE /v1/notifications/tokens`: `{ token }`, response `{ success: true }`.

Both use the existing PAYMENTS_API_BASE_URL and the signed-in Firebase ID token.
The server chooses the user ID. Expired auth is refreshed once. No token, bearer,
credential or push body is logged by this app integration. Existing preference GET/PUT
routes were inspected but are not needed for this change.

## FCM app delivery

Added `@react-native-firebase/messaging` 26.3.3, matching the existing Firebase modules.
Existing Firebase project registration/configuration is reused unchanged. Android
channels `ride_updates`, `chat_messages`, and fallback `partner_updates` are created
natively. A monochrome small notification icon is provided. The inbox's Enable push
alerts action requests Android 13+ permission; registration does not imply permission
has been granted.

One app-level listener set handles Firebase restoration, foreground messages, token
refresh, background notification taps and getInitialNotification. The background
handler is registered before AppRegistry. For background/terminated notification
payloads FCM displays the OS alert; no duplicate local alert is emitted. Data-only
messages deliberately do not manufacture visible alerts or permanent records.

Foreground pushes require `role=DRIVER` and `recipientId` equal to the server-confirmed
registered user ID. They deduplicate by notificationId/eventId/messageId, refresh the
inbox and display a generic, non-sensitive, tappable banner. Receipt never navigates.
Taps wait for authenticated identity and Main navigation readiness. Logout clears
state, attempts authenticated token deactivation before sign-out, and invalidates
the installation token. Failed cleanup invalidates the token before another account
can register a replacement. Multiple devices are supported by the existing per-token
backend records; only this installation is deactivated.

## Backend limitations requiring implementation/deployment

No backend source/database/deployment was changed in this task.

1. The sender calls legacy `https://fcm.googleapis.com/fcm/send`, uses a server key,
   and returns simulated success when the key is absent. Replace it with Firebase
   Admin SDK/HTTP v1 using server-side credentials. Validate per-token send results,
   revoke invalid tokens and retry transient failures. Do not simulate successful delivery.
2. Token registration catches database failures and returns a success-shaped DTO;
   the app cannot prove durable registration from that response. Return a real failure
   when persistence fails. DELETE currently filters only by token; additionally scope
   it to CurrentPrincipal.userId. Validate DRIVER role against the authenticated principal.
3. Actual driver producers currently include BOOKING_CANCELLED and NEW_CHAT_MESSAGE.
   Other trip lifecycle sends in the inspected controller target customers. RIDE_OFFER
   has a template but no producer was found there. Wallet/earnings, KYC and vehicle
   verification notification producers were not found. The app does not fabricate them.
4. Persist notification plus an outbox job in the same transaction as each genuine
   business change. Add a unique `(recipient_user_id, event_id)` constraint. Retry only
   delivery, not the business transaction, and do not fail committed trips/payments when
   push delivery fails. Store history even if push is disabled or no token is registered.
5. Existing push data carries backend booking/payment-trip references, not necessarily
   engine trip IDs. Define and authorize that mapping before contextual trip deep links.
   This app opens the inbox and uses only IDs that resolve to its authorized records;
   it does not navigate using arbitrary push trip/document IDs. Unavailable history means
   contextual deep linking and notification read state cannot yet be verified end to end.
6. Stop forwarding free-form chat/document/personal contents in lock-screen push text.
   Use generic copy and fetch sensitive details through authorized app APIs.

## Proposed missing server contract (not existing endpoints)

Follow the existing `/v1/notifications` convention and Firebase bearer authentication:

| Proposed route | Request | Response |
| --- | --- | --- |
| GET /v1/notifications | `?limit=20&cursor=<opaque>` | `{ items: Notification[], nextCursor: string|null, unreadCount: number }` |
| GET /v1/notifications/unread-count | none | `{ unreadCount: number }` |
| PATCH /v1/notifications/:id/read | no recipient ID | authorized updated notification |
| PATCH /v1/notifications/read-all | no recipient ID | `{ unreadCount: 0, readThrough: string }` |
| GET /v1/notifications/:id | no recipient ID | authorized notification (needed for cold-start resolution outside first page) |

`Notification`: `{ id, type, title, body, createdAt, readAt: string|null,
relatedEntityId?: string, relatedEntityType?: string }` plus server-only recipient/event
identity. Use ISO timestamps, stable IDs and a `(createdAt,id)` descending cursor. Counts
cover the whole account, not the loaded page. Read actions must be idempotent and
recipient-scoped. Read-all needs an atomic cutoff so a concurrent new notification stays
unread. For the client port, implement list/markRead/markAllRead using these verified routes;
the controller refreshes the authoritative page/count after read operations.

Proposed relational notification columns: UUID id, recipient_user_id FK, event_id, type,
title, body, related_entity_id/type, validated data JSONB, created_at and nullable read_at.
Add recipient/date and unread indexes. Use a separate outbox with notification_id FK,
attempt count, next_attempt_at, lease/status and last safe error; no extra duplicate inbox.
FCM data should include only notificationId/eventId, recipientId, role and a validated
event type. Never include bearer tokens, Aadhaar/document data or arbitrary routes.

## Verification scope

Automated tests cover navigation separation, backend DTO/auth, refresh and error handling,
inbox rendering, server count, read actions, pagination/deduplication, account isolation,
foreground receipt, cold-start queuing, token refresh/logout and failed cleanup.
Live remote FCM delivery, backend retry/invalid-token behavior, persistent history and
business-event-to-inbox delivery require the backend changes above and a real sender;
unit tests cannot establish them. See the final task result for command/build/device results.

SDK reference: https://rnfirebase.io/messaging/usage

### Final verification results

- `npm run typecheck`: PASS.
- Changed-file ESLint: PASS, zero errors; eight existing warnings in the previously
  implemented app/navigation/auth test setup. New notification files pass without warnings.
- `npx --no-install jest --runInBand --silent --testTimeout=30000`: PASS, 32 suites,
  347 tests, 52.436 seconds. Includes a read-versus-refresh concurrency regression test.
- `android/gradlew.bat assembleDebug assembleRelease --console=plain`: BUILD SUCCESSFUL,
  2m 13s, 1,215 tasks (44 executed, 1,171 up-to-date). Existing Gradle deprecation warnings
  remain. Release uses the repository's existing debug signing configuration; store signing
  was not changed.
- Final debug APK installed successfully on the connected RMX3870 Android phone.
- Physical-device PASS: Home bell; Profile Notifications row; Profile header bell;
  independent Settings action; Back restores Profile with Account selected. Final
  force-stop/cold launch succeeds, and Home's bell opens Notifications after startup.
  No AndroidRuntime/ReactNativeJS error was found in that final app process.
- Android notification permission was already granted. Display density remains the original
  480, with no override. Metro was restarted after a stale-server/port conflict and remains
  running for debug use.
- Actual FCM send/receive, persisted token durability, server delivery retries/invalid-token
  revocation, persistent history and contextual business-record links were NOT verified
  end to end. The backend gaps described above prevent claiming those capabilities.
- Verification is Android-only; no iOS/APNs setup or testing was performed.

Artifacts:

- `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\debug\app-debug.apk`
- `D:\PU\PickUp-raj_driver\android\app\build\outputs\apk\release\app-release.apk`
- `D:\PU\PickUp-raj_driver\android-notifications-build.log`
- `D:\PU\PickUp-raj_driver\notifications-full-tests.log`
- `D:\PU\PickUp-raj_driver\artifacts\notifications\notifications-phone.png`

## Exact application files changed

- `D:\PU\PickUp-raj_driver\App.tsx`
- `D:\PU\PickUp-raj_driver\index.js`
- `D:\PU\PickUp-raj_driver\package.json`
- `D:\PU\PickUp-raj_driver\package-lock.json`
- `D:\PU\PickUp-raj_driver\jest.setup.js`
- `D:\PU\PickUp-raj_driver\src\types\navigation.ts`
- `D:\PU\PickUp-raj_driver\src\navigation\RootNavigator.tsx`
- `D:\PU\PickUp-raj_driver\src\navigation\MainTabNavigator.tsx`
- `D:\PU\PickUp-raj_driver\src\navigation\stacks\HomeStack.tsx`
- `D:\PU\PickUp-raj_driver\src\screens\account\ProfileScreen.tsx`
- `D:\PU\PickUp-raj_driver\src\screens\home\DriverHomeScreen.tsx`
- `D:\PU\PickUp-raj_driver\src\screens\wallet\DriverWalletScreen.tsx`
- `D:\PU\PickUp-raj_driver\src\screens\home\NotificationCenterScreen.tsx` (removed)
- `D:\PU\PickUp-raj_driver\src\screens\notifications\NotificationsScreen.tsx` (new)
- `D:\PU\PickUp-raj_driver\src\components\molecules\NotificationCard.tsx`
- `D:\PU\PickUp-raj_driver\src\components\notifications\NotificationRuntime.tsx` (new)
- `D:\PU\PickUp-raj_driver\src\services\auth\AuthService.ts`
- `D:\PU\PickUp-raj_driver\src\services\notifications\NotificationBackend.ts` (new)
- `D:\PU\PickUp-raj_driver\src\services\notifications\NotificationInbox.ts` (new)
- `D:\PU\PickUp-raj_driver\src\services\notifications\PushSession.ts` (new)
- `D:\PU\PickUp-raj_driver\src\services\notifications\notifications.ts` (new)
- `D:\PU\PickUp-raj_driver\src\data\mockData.ts`
- `D:\PU\PickUp-raj_driver\android\app\src\main\AndroidManifest.xml`
- `D:\PU\PickUp-raj_driver\android\app\src\main\java\com\com.pickup.driver\MainApplication.kt`
- `D:\PU\PickUp-raj_driver\android\app\src\main\java\com\com.pickup.driver\MainActivity.kt`
- `D:\PU\PickUp-raj_driver\android\app\src\main\res\drawable\ic_partner_notification.xml` (new)
- `D:\PU\PickUp-raj_driver\__tests__\accountDocumentScreens.test.tsx`
- `D:\PU\PickUp-raj_driver\__tests__\homeDashboardNavigation.test.tsx`
- `D:\PU\PickUp-raj_driver\__tests__\notificationBackend.test.ts` (new)
- `D:\PU\PickUp-raj_driver\__tests__\notificationInbox.test.ts` (new)
- `D:\PU\PickUp-raj_driver\__tests__\notificationsScreen.test.tsx` (new)
- `D:\PU\PickUp-raj_driver\__tests__\pushSession.test.ts` (new)
- `D:\PU\PickUp-raj_driver\docs\NOTIFICATIONS_IMPLEMENTATION.md` (new)

Build/test logs and screenshots are generated verification artifacts, separate from this
application file list.
