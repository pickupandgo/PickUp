import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persisted "driver finished onboarding" flag.
 *
 * Firebase keeps the auth session across restarts, but `getProfile()` reports a
 * 0% completion, so the app used to re-run Language/Vehicle selection every
 * launch. We persist a flag once onboarding completes and read it on startup so
 * a logged-in, onboarded driver lands straight on Home. Cleared on logout.
 */

const KEY = 'driver.onboardingComplete';

export const markOnboardingComplete = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEY, 'true');
  } catch {
    // Non-fatal: worst case the driver re-onboards next launch.
  }
};

export const clearOnboardingComplete = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
};

export const isOnboardingComplete = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'true';
  } catch {
    return false;
  }
};
