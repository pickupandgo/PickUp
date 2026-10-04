// ============================================================
// PICK UP ADMIN PANEL — MOCK ADMIN DATA
// ============================================================
// This file contains all mock data for the admin authentication layer.
// Replace with real API responses when backend is ready.

import type { AdminUser, LoginCredentials } from '@/types';

// Mock admin users (do NOT use real credentials in production)
export const MOCK_ADMIN_USERS: AdminUser[] = [
  {
    id: 'admin-001',
    name: 'Rajesh Kumar',
    email: 'admin@pickupjodhpur.in',
    role: 'owner',
  },
  {
    id: 'admin-002',
    name: 'Priya Sharma',
    email: 'supervisor@pickupjodhpur.in',
    role: 'supervisor',
  },
];

// Mock credentials map (email → password)
// In production, authentication is handled entirely by the backend.
export const MOCK_CREDENTIALS: Record<string, string> = {
  'admin@pickupjodhpur.in': 'Admin@123',
  'supervisor@pickupjodhpur.in': 'Super@123',
};

// Mock session storage key
export const SESSION_KEY = 'pickup_admin_session';

// Mock token (would come from backend JWT in production)
export const MOCK_TOKEN = 'mock-jwt-token-pickup-admin-2024';

// Helper: find user by email
export function findMockUserByEmail(email: string): AdminUser | undefined {
  return MOCK_ADMIN_USERS.find((u) => u.email === email);
}

// Helper: validate mock credentials
export function validateMockCredentials(credentials: LoginCredentials): boolean {
  const expected = MOCK_CREDENTIALS[credentials.email];
  return expected !== undefined && expected === credentials.password;
}
