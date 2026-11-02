# Active-trip Customer / Driver chat

Local implementation, 2026-11-02. No Git push, staging migration or deployment was performed.
This is MultipleRide's owner-approved active-trip retention policy, not a claim about another
company's private implementation or retention practices.

## Contract and ownership

The existing Backend stores temporary chat content. Engine remains the trip-lifecycle authority;
its existing Backend projection confirms assignment and terminal state. No Engine, financial,
dispatch, OTP or payment behavior was changed.

Firebase Bearer authentication and existing principal/account checks apply to every request.
Only the booking's Customer, assigned Driver and existing authorized ADMIN can access its chat.
Sender identity/role comes from the verified principal. An unrelated participant is forbidden.

| Operation | Booking route | Driver convenience route |
| --- | --- | --- |
| Read messages | `GET /v1/bookings/:bookingId/chat/messages` | `GET /v1/trips/:tripId/chat/messages` |
| Send text | `POST /v1/bookings/:bookingId/chat/messages` | `POST /v1/trips/:tripId/chat/messages` |
| Acknowledge read | `POST /v1/bookings/:bookingId/chat/read` | `POST /v1/trips/:tripId/chat/read` |

`bookingId` and the convenience `tripId` belong to Backend. Driver must use Engine's
`paymentTripId` mapping, never Engine `trip.id`. Customer uses `paymentBookingId`.
Missing mapping disables the composer until assignment confirmation. Push opens a validated
booking reference only after authenticated, approved Main navigation is mounted; Backend still
authorizes the actual conversation before composing is enabled.

Send body: `{ "text": "I am at the pickup", "clientMessageId": "client_reference_123456" }`.
Trimmed text must have 1–2000 characters. Clients reuse the same reference for explicit retries;
the existing `(booking, sender, clientMessageId)` unique constraint prevents duplicate messages.
An identical replay returns the saved response; reusing the reference for different text is 409.
Only a confirmed server acknowledgement means sent. HTTP failures remain failed with Retry.
There is no offline auto-send queue. URL/image attachments are disabled until a private upload
contract exists; arbitrary client-supplied document URLs are rejected.

Before confirmed assignment: **409 CHAT_NOT_ASSIGNED**. After Backend booking or trip becomes
COMPLETED/CANCELLED: **410 CHAT_CLOSED**, including history and read acknowledgements. No history
screen or completed-trip send access remains. Booking→trip shared locks serialize authorization
with existing assignment/cancellation writes; unique-key replay reauthorizes in a fresh transaction.

## Delivery and privacy

Foreground, focused chat refreshes every 3.5 seconds and acknowledges unread counterpart messages.
Polling pauses on blur/background. Retry, account changes, logout, closure, request cancellation,
late responses and token refresh are handled without fabricated sends. Driver uses Backend HTTPS
and refreshes a rejected token at most once with the same message reference.

Both apps use account-scoped RAM only; no new chat text is copied to AsyncStorage. Visible chat
clears on blur/background/logout/closure. Customer deletes legacy `customer.chat.*` storage keys
on session changes/startup and foreground, retrying cleanup if storage temporarily fails. Other
Customer storage and UI layout remain intact. An updated Customer build must actually run before
old installations can clear their legacy copies. Closed-conversation revisions prevent late
network responses restoring previously erased messages.

Active conversation messages remain temporarily in PostgreSQL so delivery, reconnect and restart
work. Closed content and its NEW_CHAT_MESSAGE inbox alerts are deleted by the Backend cleanup
worker: startup and every minute, at most three batches of 100 conversations per tick. Multiple
workers use row locks/SKIP LOCKED. Failure retries next tick and logs no text; closed access stays
denied even if physical cleanup is delayed. This removes live database rows, not historical
database backups/WAL; infrastructure backup retention is a separate operator responsibility.
Chat text is excluded from new inbox and lock-screen notification copies.
Cleanup also uses a transaction with a five-second lock timeout and ten-second statement timeout.

## Migration / activation requirements

New additive migration: `20261102120000_active_trip_chat_cleanup`. It creates a partial chat-alert
index and `public.purge_closed_chat_conversations(integer)`. It deletes no rows during migration.
The SECURITY DEFINER function can delete only closed chat rows/their chat alerts in bounded
batches. PUBLIC has no EXECUTE. Runtime must not receive broad DELETE privileges.

Apply migrations with the authorized migration role before deploying Backend. Where `mr_app`
exists, an authorized operator must then apply the updated `prisma/sql/02-app-grants.sql`; it
adds only EXECUTE for this function. The temporary Render owner-role environment already has
function access; do not invent roles or run mr_app grants where that role does not exist.
No existing deployed migration was edited. Validation used only the disposable loopback `_test`
database; no staging/production migration has been run for this change.

Driver `PAYMENTS_API_BASE_URL` and Customer `EXPO_PUBLIC_PAYMENTS_API_BASE_URL` must point to the
same Backend; Engine URLs stay separate. The new Vicky checkout currently has no private .env;
provide its existing approved client environment before creating a usable device build. Do not
copy Backend/internal/Firebase-admin credentials into either app.

Staging push was found disabled: FCM_ENABLED was not true and a matching FCM project/ADC credential
was not configured. An authorized operator must configure `FCM_ENABLED=true`,
`FCM_PROJECT_ID=multipleride-customer` and server-side Firebase Admin Application Default
Credentials (for example a private GOOGLE_APPLICATION_CREDENTIALS file), and grant the service
identity appropriate FCM send permission. Never put that file in Git or an APK. No cloud settings
were changed. Open-screen polling works independently; background push delivery is not live-verified.

## Verification / remaining UAT

Node 24.21.0 was used. Prisma validation/client generation and Backend production build passed.
Backend focused units passed (35); real PostgreSQL chat + auth/customer/driver API integration
passed (47), including least-privileged positive delivery/read receipts, concurrent idempotency,
concurrent cancellation, ownership rejection and selective cleanup preserving financial/user rows.
Driver full Jest suite passed (390); Customer full suite passed (389), with subsequent focused
checks for final chat lifecycle changes (42 Driver / 28 Customer passed). The final seven
PostgreSQL chat checks passed after adding the cleanup index. Customer wiring/text checks passed.
Changed Backend ESLint passed; Driver changed-file ESLint has zero errors and seven warnings.
Customer has no configured/installed ESLint; use its existing typecheck/wiring/text checks.

No real Firebase messages, push delivery, phone chat, Engine+Backend cross-service live E2E,
new APK build/install, or cloud activation was performed for chat. The previous authfix APK
does not contain this implementation. Release requires approved Backend migration/deployment,
updated Driver and Vicky Customer builds, then two-account physical-device UAT covering assigned
chat in both directions, read receipts, push taps, offline/reconnect/retry, logout/account switch,
missing assignment mapping, and completion/cancellation while chat/send is open. Verify the
Engine's terminal projection reaches Backend and actual closed-content cleanup runs. Do not
enable chat attachments or weaken KYC/payment gates for UAT.

## Changed files

Backend (`raj_backend/`):

```text
docs/active-trip-chat.md
prisma/migrations/20261102120000_active_trip_chat_cleanup/migration.sql
prisma/sql/02-app-grants.sql
src/chat/chat.dto.ts
src/chat/chat.module.ts
src/chat/chat.service.ts
src/chat/chat.service.spec.ts
src/chat/chat-cleanup.service.ts
src/chat/chat-cleanup.service.spec.ts
src/common/errors/error-codes.ts
src/notifications/notifications.service.ts
src/notifications/notifications.service.spec.ts
test/integration/chat.int-spec.ts
```

Driver UAT worktree (`du/`):

```text
src/components/notifications/NotificationRuntime.tsx
src/hooks/useChat.ts
src/navigation/RootNavigator.tsx
src/screens/trip/ActiveTripChatScreen.tsx
src/screens/trip/ActiveTripScreen.tsx
src/screens/trip/NavigationScreen.tsx
src/services/auth/AuthService.ts
src/services/chat/ChatService.ts
src/services/notifications/PushSession.ts
src/services/notifications/notifications.ts
src/types/chat.ts
src/types/navigation.ts
__tests__/chatService.test.ts
__tests__/chatScreen.test.tsx
__tests__/pushSession.test.ts
__tests__/rootAuthentication.test.tsx
```

Existing UAT RootNavigator/AuthService/authentication tests were preserved, with only the chat
integration additions described above. The earlier authSessionRestoration.test.ts remains intact.

Vicky Customer (`vicky-customer/`):

```text
App.tsx
src/hooks/useChatPrivacy.ts
src/services/chatService.ts
src/screens/support/ActiveTripChatScreen.tsx
__tests__/chatReliability.test.tsx
__tests__/accountIsolation.test.tsx
```

Workspace memory: `C:\multiple_ride\CODEX_MEMORY.md`. Read-only Git status/diff/history checks
and a local Backend integration branch were used; nothing was staged, committed or published.
Changed source was checked for credential patterns and accidental environment/build/signing files;
no matches were found. The pre-existing untracked migration helper was preserved and excluded.
