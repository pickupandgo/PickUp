# Admin Backend Integration Notes

This document provides guidelines and expectations for the Backend Developer who will be replacing the frontend mock services with real APIs.

## 1. Overall Architecture
Currently, the frontend uses an abstraction layer (`src/services/`) that returns mock data wrapped in Promises. To integrate the backend:
1. Replace the internal array queries in `src/services/*.ts` with `fetch` or `axios` calls to your REST/GraphQL API.
2. Maintain the TypeScript interfaces defined in `src/types/` as the expected contract, or update the interfaces to exactly match your backend schemas and refactor the UI accordingly.

## 2. Expected Data Domains & Endpoints
The frontend expects operational CRUD capabilities for the following domains:

- **Authentication:** Login (returns JWT/Session token). Protected routes check for auth state.
- **Customers:** List, Detail, Update Status (Block/Unblock).
- **Drivers:** List, Detail, Update Status (Approve, Reject, Suspend). Expects related aggregates (Trips summary, Wallet summary).
- **KYC:** List pending/approved, document approval workflows.
- **Vehicles:** List, Detail, Status toggles.
- **Business Configuration:** Vehicle categories, Pricing rules (distance/hourly), Surcharges (Rain/Traffic), Platform Commission, Cancellation thresholds.
- **Bookings:** Comprehensive list, deeply nested detail (Pickup, Multi-drops, Receiver, Load, Fare Breakdown, Insurance). Requires endpoints for Admin overrides (Reassign, Cancel, Update Status, Add Internal Note).
- **Driver Instructions:** CMS-like CRUD for operational messages.
- **Audit Logs:** Immutable, read-only event stream of Admin actions.
- **Reports:** Aggregated business metrics (Bookings, Revenue, Commission, Cancellations).

## 3. Realtime Expectations (Live Operations)
The Live Operations module (`/live-trips`) currently uses a mock polling timer (`mockRealtimeService.ts`).
- **Target Implementation:** Replace this with a WebSockets or Socket.io connection.
- **Expected Payload:** The socket should emit a payload matching or mapping to `LiveOperationsData` (active trips, online drivers, current GPS coordinates, last updated timestamps).
- **Cleanup:** Ensure the socket disconnects when the `LiveTripsPage` unmounts to prevent memory leaks.

## 4. Pagination & Filtering
All list views (Bookings, Customers, Drivers, Audit Logs) currently implement client-side pagination. 
- When switching to APIs, implement **Server-Side Pagination**. 
- The API should accept query parameters (e.g., `?page=1&limit=15&search=abc&status=completed`) and return `{ data: [...], total: 100 }`.

## 5. Security & Authentication
- The UI expects a token-based authentication mechanism.
- The `AuthContext` must be updated to store and validate the real JWT.
- Axios/Fetch interceptors should be configured to inject the `Authorization: Bearer <token>` header into every request and handle `401 Unauthorized` responses by triggering a forced logout.
