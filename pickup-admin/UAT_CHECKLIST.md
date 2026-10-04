# Pick Up Admin Web Panel - UAT Checklist

This document contains the final frontend User Acceptance Testing (UAT) checklist to verify that all major Admin Panel modules are functional in the DUMMY/MOCK data state.

| Feature | Test Case | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| **Authentication** | Valid Login (`admin@pickupjodhpur.in`) | Redirects to Dashboard | Redirects successfully | PASS |
| **Authentication** | Invalid Login | Shows validation error | Shows error toast | PASS |
| **Authentication** | Logout | Clears session and redirects to Login | Session cleared, redirected | PASS |
| **Dashboard** | Load KPIs and Charts | Displays aggregate metrics correctly | Metrics loaded | PASS |
| **Dashboard** | Date Filter | Changes visual state of the filter | State updates | PASS |
| **Customers** | Search & Filter List | Updates list based on input | List filters correctly | PASS |
| **Customers** | Block/Unblock Customer | Toggles customer status and shows toast | Status toggled, toast shown | PASS |
| **Drivers** | View Driver Detail | Shows comprehensive profile (KYC, Wallet, Trips) | Profile loads with all data | PASS |
| **Drivers** | Approve/Suspend Driver | Changes verification/operational status | Status updates | PASS |
| **KYC** | Approve/Reject Documents | Updates KYC status for the driver | Status updates, feedback shown | PASS |
| **Vehicles** | View and Filter Vehicles | Displays list of vehicles with status | List renders and filters | PASS |
| **Vehicles** | Enable/Disable Vehicle | Changes operational status | Status toggled successfully | PASS |
| **Vehicle Categories** | Edit Pricing | Opens modal and saves new pricing structure | Modal works, data saved | PASS |
| **Vehicle Categories** | Surcharges & Commission | Saves business rules successfully | Feedback shown on save | PASS |
| **Bookings** | Search by Booking ID | Filters table to specific booking | Search functional | PASS |
| **Bookings** | View Booking Detail | Shows multi-drop timeline, fare, insurance | Detailed view renders accurately | PASS |
| **Bookings** | Reassign Driver | Modal opens, driver selected, updates UI | Driver reassigned | PASS |
| **Bookings** | Cancel Booking | Exceptionally cancels with reason and note | Status changes to Cancelled | PASS |
| **Live Operations** | Live Trips Sidebar | Lists active trips, updates periodically | List renders and updates | PASS |
| **Live Operations** | Interactive Mock Map | Markers display driver positions and sync with list | Markers move when sim is ON | PASS |
| **Live Operations** | Trip Detail Panel | Shows live progress of drops and coordinates | Overlay renders accurately | PASS |
| **Live Operations** | Realtime Simulation Toggle | Timer activates and moves coordinates | Coordinate jitter observed | PASS |
| **Reports** | Switch Report Types | Summaries and tables adapt (e.g. Revenue vs Booking) | Reports dynamically generate | PASS |
| **Driver Instructions** | Create New Instruction | Adds instruction to list with Active status | Instruction added | PASS |
| **Audit Logs** | Filter by Action/Entity | Restricts history list correctly | Filters functional | PASS |
| **Audit Logs** | View Log Detail | Shows immutable modal with Previous/New values | Detail renders accurately | PASS |
