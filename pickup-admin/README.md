# 🚗 MultipleRide Admin Panel

A modern, full-featured **Admin Web Panel** for the **MultipleRide / Pick Up Logistics Platform** — built with **Next.js 16**, **TypeScript**, and **CSS Modules**.

Manage bookings, drivers, customers, live trips, KYC verification, and platform configuration from a single dashboard.

---

## 🖥️ Tech Stack

| Technology | Purpose |
|---|---|
| **Next.js 16** (App Router) | Core Framework |
| **TypeScript** | Type Safety |
| **CSS Modules** | Styling |
| **Lucide React** | Icons |
| **React Hot Toast** | Notifications |

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/vickysingh009/multipleride_admin-panel.git
cd multipleride_admin-panel
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Mock Login Credentials

| Field | Value |
|---|---|
| **Email** | `admin@pickupjodhpur.in` |
| **Password** | `Admin@123` |

---

## 📁 Folder Structure

```
src/
├── app/              # Next.js App Router (pages & layouts)
├── components/       # Reusable UI components (Cards, Buttons, Modals, Layouts)
├── features/         # Domain-specific page components (Bookings, Live Trips, Reports)
├── services/         # Data abstraction layer (currently serving mock data)
├── mock/             # Dummy data arrays for UI development
├── types/            # TypeScript interfaces & business domain models
└── context/          # React Context (Auth, etc.)
```

---

## 🌐 Environment Variables

Create a `.env.local` file in the root (never commit real secrets):

```env
NEXT_PUBLIC_APP_NAME="MultipleRide Admin"
NEXT_PUBLIC_API_BASE_URL="http://localhost:4000/api/v1"
NEXT_PUBLIC_SOCKET_URL="ws://localhost:4000"
```

---

## 📦 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

---

## 📋 Current Status

> **MOCK DATA MODE** — The application currently runs entirely on frontend mock data located in `src/mock/` and `src/services/`. No real backend is required to run or test the UI.

Before integrating with the real backend, read [`ADMIN_BACKEND_INTEGRATION_NOTES.md`](./ADMIN_BACKEND_INTEGRATION_NOTES.md).

---

## 📄 License

This project is private and proprietary. All rights reserved.

---

<p align="center">Built with ❤️ for MultipleRide / Pick Up Logistics Platform</p>
