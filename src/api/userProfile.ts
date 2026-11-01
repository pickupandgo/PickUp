import { ApiError } from './http';
import { getCustomerAccount, updateCustomerProfile } from './payments';
import type { CustomerProfileData } from '../state/session';
import { hasRequiredProfile } from '../state/profileValidation';

export interface CustomerAccountResponse {
  readonly customerId: string;
  readonly phone: string;
  readonly status: string;
  readonly createdAt: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly age?: number | null;
  readonly address?: string | null;
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
 * Returns null only when this identity has not been provisioned yet.
 */
export const fetchUserProfileApi = async (signal?: AbortSignal): Promise<BackendUserProfile | null> => {
  try {
    const res = await getCustomerAccount(signal);
    return {
      uid: res.customerId,
      fullName: res.name || '',
      email: res.email || '',
      phone: res.phone,
      age: res.age == null ? undefined : String(res.age),
      address: res.address || undefined,
      createdAt: res.createdAt,
    };
  } catch (error: any) {
    if (error instanceof ApiError && error.status === 403 && error.errorCode === 'USER_NOT_PROVISIONED') {
      return null;
    }
    throw error;
  }
};

/**
 * Saves editable profile fields on PATCH /v1/customers/me after registration.
 * Phone and Firebase identity are intentionally absent from the request body.
 */
export const saveUserProfileApi = async (
  profile: CustomerProfileData,
  signal?: AbortSignal,
): Promise<BackendUserProfile> => {
  if (!hasRequiredProfile(profile)) throw new Error('Name, valid email, age and location/address are required.');
  const ageText = profile.age?.trim();
  const res = await updateCustomerProfile({
    name: profile.fullName.trim(),
    email: profile.email.trim(),
    age: Number(ageText),
    address: profile.address!.trim(),
  }, signal);

  return {
    uid: res.customerId,
    fullName: res.name || '',
    email: res.email || '',
    phone: res.phone,
    age: res.age == null ? undefined : String(res.age),
    address: res.address || undefined,
    createdAt: res.createdAt,
  };
};
