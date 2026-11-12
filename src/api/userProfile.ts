import { request, ApiError } from './http';
import type { CustomerProfileData } from '../state/session';

export interface CustomerAccountResponse {
  readonly customerId: string;
  readonly phone: string;
  readonly status: string;
  readonly createdAt: string;
  readonly name?: string | null;
  readonly email?: string | null;
}

export interface BackendUserProfile {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  age?: string;
  address?: string;
  photoUri?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Fetches the authenticated customer's account and profile from the backend (GET /v1/customers/me).
 * Returns null if no customer profile exists yet for this authenticated identity (HTTP 403/404).
 */
export const fetchUserProfileApi = async (signal?: AbortSignal): Promise<BackendUserProfile | null> => {
  try {
    const res = await request<CustomerAccountResponse>('/v1/customers/me', {
      method: 'GET',
      signal,
    });
    return {
      uid: res.customerId,
      fullName: res.name || '',
      email: res.email || '',
      phone: res.phone,
      createdAt: res.createdAt,
    };
  } catch (error: any) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return null;
    }
    throw error;
  }
};

/**
 * Registers or updates the customer profile on the backend (POST /v1/customers/me).
 * Uses the authenticated Firebase token; validates and persists name and email.
 * Throws ApiError if phone verification is required (403), role conflict (409), or phone taken (409).
 */
export const saveUserProfileApi = async (
  profile: CustomerProfileData,
  signal?: AbortSignal,
): Promise<BackendUserProfile> => {
  const body: Record<string, string> = {};
  if (profile.fullName?.trim()) {
    body.name = profile.fullName.trim();
  }
  if (profile.email?.trim()) {
    body.email = profile.email.trim();
  }

  const res = await request<CustomerAccountResponse>('/v1/customers/me', {
    method: 'POST',
    body,
    signal,
  });

  return {
    uid: res.customerId,
    fullName: res.name || profile.fullName.trim(),
    email: res.email || profile.email.trim(),
    phone: res.phone || profile.phone || '',
    age: profile.age?.trim() || undefined,
    address: profile.address?.trim() || undefined,
    photoUri: profile.photoUri?.trim() || undefined,
    createdAt: res.createdAt,
  };
};
