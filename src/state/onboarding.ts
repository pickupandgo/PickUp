import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';

/**
 * Persisted "driver finished onboarding" flag.
 *
 * Scoped by UID to ensure each authenticated driver account preserves
 * their own onboarding state without cross-account contamination on the same device.
 */

const KEY_PREFIX = 'driver.onboardingComplete';

const getScopedKey = (uid?: string | null): string => {
  const resolvedUid = uid || getAuth().currentUser?.uid;
  return resolvedUid ? `${KEY_PREFIX}.${resolvedUid}` : KEY_PREFIX;
};

export const markOnboardingComplete = async (uid?: string | null): Promise<void> => {
  try {
    const key = getScopedKey(uid);
    await AsyncStorage.setItem(key, 'true');
  } catch {
    // Non-fatal: worst case the driver re-onboards next launch.
  }
};

export const clearOnboardingComplete = async (uid?: string | null): Promise<void> => {
  try {
    const key = getScopedKey(uid);
    await AsyncStorage.removeItem(key);
  } catch {
    // Ignore.
  }
};

export const isOnboardingComplete = async (uid?: string | null): Promise<boolean> => {
  try {
    const key = getScopedKey(uid);
    const value = await AsyncStorage.getItem(key);
    return value === 'true';
  } catch {
    return false;
  }
};
