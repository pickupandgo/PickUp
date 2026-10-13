import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = 'pickup.isLoggedIn';
const PROFILE_KEY = 'pickup.profileComplete';
const PROFILE_DATA_KEY = 'pickup.customerProfile';

export interface CustomerProfileData {
  fullName: string;
  email: string;
  age?: string;
  address?: string;
}

/** Marks the user as logged in. */
export const setLoggedIn = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(SESSION_KEY, 'true');
  } catch {
    // Non-fatal
  }
};

/** Clears session and profile completion on logout. */
export const clearSession = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
    await AsyncStorage.removeItem(PROFILE_KEY);
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
export const setProfileComplete = async (profileData?: CustomerProfileData): Promise<void> => {
  try {
    await AsyncStorage.setItem(PROFILE_KEY, 'true');
    if (profileData) {
      await AsyncStorage.setItem(PROFILE_DATA_KEY, JSON.stringify(profileData));
    }
  } catch {
    // Non-fatal
  }
};

/** Checks if the customer profile has been completed. */
export const isProfileComplete = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(PROFILE_KEY)) === 'true';
  } catch {
    return false;
  }
};

/** Clears the profile completed status. */
export const clearProfileComplete = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(PROFILE_KEY);
  } catch {
    // Non-fatal
  }
};

/** Gets persisted customer profile data. */
export const getCustomerProfile = async (): Promise<CustomerProfileData | null> => {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_DATA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
