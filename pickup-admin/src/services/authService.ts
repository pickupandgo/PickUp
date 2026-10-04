// ============================================================
// PICK UP ADMIN PANEL — AUTH SERVICE
// ============================================================
// Service abstraction layer for authentication.
// Currently uses mock data. Replace implementation with real
// API calls when the backend is ready — the interface stays the same.

import type { LoginCredentials, LoginResponse, AdminUser } from '@/types';
import {
  SESSION_KEY,
  MOCK_TOKEN,
  findMockUserByEmail,
  validateMockCredentials,
} from '@/mock/adminMock';

// Simulated network delay (ms) — remove in production
const MOCK_DELAY = 900;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------------------------------------
// login
// -------------------------------------------------------
// FUTURE: Replace body with: return apiClient.post('/auth/admin/login', credentials)
export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  await delay(MOCK_DELAY);

  const isValid = validateMockCredentials(credentials);

  if (!isValid) {
    return {
      success: false,
      error: 'Invalid email or password. Please try again.',
    };
  }

  const user = findMockUserByEmail(credentials.email);

  if (!user) {
    return { success: false, error: 'User account not found.' };
  }

  // Persist session to localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ user, token: MOCK_TOKEN })
    );
  }

  return { success: true, user, token: MOCK_TOKEN };
}

// -------------------------------------------------------
// logout
// -------------------------------------------------------
// FUTURE: Also call: apiClient.post('/auth/admin/logout')
export async function logout(): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_KEY);
  }
}

// -------------------------------------------------------
// getSession
// -------------------------------------------------------
// FUTURE: Replace with: apiClient.get('/auth/admin/session')
export function getSession(): { user: AdminUser; token: string } | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

// -------------------------------------------------------
// isAuthenticated
// -------------------------------------------------------
export function isAuthenticated(): boolean {
  return getSession() !== null;
}
