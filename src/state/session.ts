import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import { hasRequiredProfile } from './profileValidation';

const SESSION_KEY = 'pickup.isLoggedIn';
const PROFILE_KEY = 'pickup.profileComplete';
const PROFILE_DATA_KEY = 'pickup.customerProfile';

export interface CustomerProfileData {
  fullName: string;
  email: string;
  age?: string;
  address?: string;
  phone?: string;
  photoUri?: string;
}

const getFirebaseUid = (): string | null => {
  try {
    return getAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
};

const getUserProfileKey = (uid?: string | null): string => {
  return uid ? `${PROFILE_KEY}.${uid}` : PROFILE_KEY;
};

const getUserProfileDataKey = (uid?: string | null): string => {
  return uid ? `${PROFILE_DATA_KEY}.${uid}` : PROFILE_DATA_KEY;
};

/** Marks the user as logged in. */
export const setLoggedIn = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(SESSION_KEY, 'true');
  } catch {
    // Non-fatal
  }
};

/** Clears session and profile completion on logout. */
export const clearSession = async (uid?: string | null): Promise<void> => {
  try {
    const userUid = uid ?? getFirebaseUid();
    await AsyncStorage.removeItem(SESSION_KEY);
    await AsyncStorage.removeItem(PROFILE_KEY);
    await AsyncStorage.removeItem(PROFILE_DATA_KEY);
    if (userUid) {
      await AsyncStorage.removeItem(getUserProfileKey(userUid));
      await AsyncStorage.removeItem(getUserProfileDataKey(userUid));
    }
  } catch {
    // Non-fatal
  }
};

/** Returns whether the user is logged in. */
export const getIsLoggedIn = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(SESSION_KEY)) === 'true';
  } catch {
    return false;
  }
};

/** Marks the customer profile as completed. */
export const setProfileComplete = async (
  profileData?: CustomerProfileData,
  uid?: string | null,
): Promise<void> => {
  try {
    const userUid = uid ?? getFirebaseUid();
    if (!userUid) return;
    const profileKey = getUserProfileKey(userUid);
    const dataKey = getUserProfileDataKey(userUid);

    await AsyncStorage.setItem(profileKey, 'true');

    if (profileData) {
      const serialized = JSON.stringify(profileData);
      await AsyncStorage.setItem(dataKey, serialized);
    }
  } catch {
    // Non-fatal
  }
};

/** Checks if the customer profile has been completed. */
export const isProfileComplete = async (uid?: string | null): Promise<boolean> => {
  try {
    const userUid = uid ?? getFirebaseUid();
    if (userUid) {
      const rawUser = await AsyncStorage.getItem(getUserProfileDataKey(userUid));
      if (rawUser) {
        try {
          const parsed = JSON.parse(rawUser);
          if (typeof parsed?.fullName === 'string' && typeof parsed?.email === 'string' && hasRequiredProfile(parsed)) {
            return true;
          }
        } catch {
          // parse failed
        }
      }
    }
    return false;
  } catch {
    return false;
  }
};

/** Clears the profile completed status. */
export const clearProfileComplete = async (uid?: string | null): Promise<void> => {
  try {
    const userUid = uid ?? getFirebaseUid();
    await AsyncStorage.removeItem(PROFILE_KEY);
    if (userUid) {
      await AsyncStorage.removeItem(getUserProfileKey(userUid));
    }
  } catch {
    // Non-fatal
  }
};

/** Gets persisted customer profile data. */
export const getCustomerProfile = async (uid?: string | null): Promise<CustomerProfileData | null> => {
  try {
    const userUid = uid ?? getFirebaseUid();
    if (userUid) {
      const rawScoped = await AsyncStorage.getItem(getUserProfileDataKey(userUid));
      if (rawScoped) {
        return JSON.parse(rawScoped);
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
};
