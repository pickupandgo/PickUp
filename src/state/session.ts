import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persisted login flag for the customer app.
 *
 * The prototype has no real backend auth, so "being logged in" is just a
 * boolean we store on the device. It's written when the user finishes OTP
 * verification and cleared on logout. `App.tsx` reads it on launch to decide
 * whether to open on HomeScreen (logged in) or LoginScreen (logged out).
 *
 * When real auth lands, replace this flag with a check for a valid token /
 * Firebase user and delete this file.
 */

const SESSION_KEY = 'pickup.isLoggedIn';

/** Marks the user as logged in. Call after successful OTP verification. */
export const setLoggedIn = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(SESSION_KEY, 'true');
  } catch {
    // Non-fatal: the session simply won't survive a restart.
  }
};

/** Clears the login flag. Call on logout. */
export const clearSession = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore: nothing more we can do if storage is unavailable.
  }
};

/** Returns whether the user is currently logged in. */
export const getIsLoggedIn = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(SESSION_KEY)) === 'true';
  } catch {
    // Storage unavailable: treat as logged out so we fail safe to Login.
    return false;
  }
};
