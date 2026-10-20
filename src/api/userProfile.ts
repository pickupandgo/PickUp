import { request, ApiError } from './http';
import type { CustomerProfileData } from '../state/session';

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
 * Fetches the authenticated customer's profile from the backend.
 * Returns null if no profile exists yet for this UID.
 */
export const fetchUserProfileApi = async (): Promise<BackendUserProfile | null> => {
  try {
    return await request<BackendUserProfile>('/users/profile');
  } catch (error: any) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

/**
 * Creates or updates the customer profile on the backend.
 * Associates the profile with the caller's Firebase UID extracted from the Bearer token.
 * Throws ApiError if validation fails or email conflict (409) occurs.
 */
export const saveUserProfileApi = async (
  profile: CustomerProfileData,
): Promise<BackendUserProfile> => {
  return await request<BackendUserProfile>('/users/profile', {
    method: 'POST',
    body: {
      fullName: profile.fullName.trim(),
      email: profile.email.trim(),
      phone: profile.phone?.trim(),
      age: profile.age?.trim() || undefined,
      address: profile.address?.trim() || undefined,
      photoUri: profile.photoUri?.trim() || undefined,
    },
  });
};
