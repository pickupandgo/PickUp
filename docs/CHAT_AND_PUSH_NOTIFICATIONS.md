# Customer/Driver Chat and Push Notifications Backend Specification

This document describes the schema additions, REST endpoints, and event-driven notification hooks added to `multipleride-backend` (`PickUp-raj_backend`).

---

## 1. Database Schema Additions (`prisma/schema.prisma`)

### Models Added

1. **`ChatMessage`**:
   - `id`: UUID (Primary Key)
   - `bookingId`: UUID (FK to `Booking`)
   - `senderUserId`: UUID (FK to `User`)
   - `senderRole`: `UserRole` (`CUSTOMER`, `DRIVER`, `ADMIN`)
   - `text`: Text message content
   - `imageUrl`: Optional image attachment URL
   - `status`: String (`SENT`, `DELIVERED`, `READ`)
   - `readAt`: Timestamp when recipient marked as read
   - `createdAt`, `updatedAt`: Timestamps
   - Index on `[bookingId, createdAt]`

2. **`DeviceToken`**:
   - `id`: UUID (Primary Key)
   - `userId`: UUID (FK to `User`, cascade delete)
   - `token`: Unique FCM registration token
   - `role`: `UserRole` (`CUSTOMER`, `DRIVER`)
   - `platform`: `ANDROID`, `IOS`, `WEB`
   - `language`: `en` or `hi` (defaults to `en`)
   - `isActive`: Boolean flag
   - `lastSeenAt`: Timestamp of last registration/ping
   - `createdAt`, `updatedAt`: Timestamps
   - Index on `[userId, role]`

3. **`NotificationPreference`**:
   - `id`: UUID (Primary Key)
   - `userId`: UUID (FK to `User`, unique)
   - `pushEnabled`: Boolean (default `true`)
   - `soundEnabled`: Boolean (default `true`)
   - `language`: Preferred locale (`en` or `hi`)
   - `createdAt`, `updatedAt`: Timestamps

### Migration Command
When running with PostgreSQL:
```bash
npm run prisma:generate
npx prisma migrate dev --name add_chat_and_device_tokens
```

---

## 2. API Endpoints

### Chat API (`/v1`)
All routes require `@SignedIn()` authentication and enforce booking authorization: only the customer who booked the trip or the driver assigned to that booking may participate.

- **`GET /v1/bookings/:bookingId/chat/messages`**:
  Returns list of chat messages ordered chronologically.

- **`POST /v1/bookings/:bookingId/chat/messages`**:
  Body: `{ "text": string, "imageUrl"?: string }`
  Persists message and triggers a high-priority FCM push notification to the counterpart.

- **`POST /v1/bookings/:bookingId/chat/read`**:
  Marks unread messages from the other party as read.

- **Trip-scoped aliases** (convenience for Driver App):
  - `GET /v1/trips/:tripId/chat/messages`
  - `POST /v1/trips/:tripId/chat/messages`
  - `POST /v1/trips/:tripId/chat/read`

### Push Notifications API (`/v1/notifications`)
- **`POST /v1/notifications/tokens`**:
  Body: `{ "token": string, "role": "CUSTOMER" | "DRIVER", "platform": "ANDROID" | "IOS", "language": "en" | "hi" }`
  Registers or refreshes the FCM device token for the current user.

- **`DELETE /v1/notifications/tokens`**:
  Body: `{ "token": string }`
  Deactivates device token upon user logout.

- **`GET /v1/notifications/preferences`**:
  Fetches user's current push notification settings.

- **`PUT /v1/notifications/preferences`**:
  Body: `{ "pushEnabled"?: boolean, "soundEnabled"?: boolean, "language"?: "en" | "hi" }`
  Updates push settings.

---

## 3. Event-Driven Push Notifications

Notifications are sent **only after the business transaction has committed**:

| Event | Recipient | Android Channel | Trigger Hook |
|---|---|---|---|
| `DRIVER_ASSIGNED` | Customer | `ride_updates` | `POST /v1/internal/bookings/:bookingId/assign` |
| `DRIVER_ARRIVED` | Customer | `ride_updates` | `POST /v1/internal/trips/:tripId/status` (`DRIVER_ARRIVED`) |
| `TRIP_STARTED` | Customer | `ride_updates` | `POST /v1/internal/trips/:tripId/status` (`PICKUP_VERIFIED` / `IN_TRANSIT`) |
| `ARRIVED_AT_STOP` | Customer | `ride_updates` | `POST /v1/internal/trips/:tripId/stops/:sequence/status` (`ARRIVED`) |
| `STOP_DELIVERED` | Customer | `ride_updates` | `POST /v1/internal/trips/:tripId/stops/:sequence/status` (`DELIVERED`) |
| `TRIP_COMPLETED` | Customer | `ride_updates` | `POST /v1/internal/trips/:tripId/status` (`COMPLETED`) |
| `BOOKING_CANCELLED` | Customer & Driver | `ride_updates` | `POST /v1/internal/bookings/:bookingId/cancel` |
| `NEW_CHAT_MESSAGE` | Counterpart | `chat_messages` | `POST /v1/bookings/:bookingId/chat/messages` |

---

## 4. Environment Variables
To enable live FCM delivery:
```env
# Firebase Cloud Messaging Server Key (Legacy or HTTP v1 OAuth token)
FCM_SERVER_KEY=your_firebase_server_key
# Optional Firebase Service Account JSON (absolute path or inline JSON)
FIREBASE_SERVICE_ACCOUNT=
```
If unset, notifications are cleanly logged in development mode as `[SIMULATED PUSH]` without crashing.
