import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Stable per-install customer identity.
 *
 * The engine has no authentication: `customerId` is just a string it trusts.
 * Persisting one per install means a customer keeps their active trip across
 * app restarts. When real auth lands, replace this with the authenticated user
 * id and delete the generated fallback.
 */

const CUSTOMER_ID_KEY = 'pickup.customerId';

/** RFC4122-ish v4 id without pulling in a uuid dependency. */
const generateId = (): string => {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `C-${hex(8)}-${hex(4)}-${hex(12)}`;
};

let cached: string | undefined;

export const getCustomerId = async (): Promise<string> => {
  if (cached) return cached;

  try {
    const stored = await AsyncStorage.getItem(CUSTOMER_ID_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {
    // Storage unavailable: fall through and use a session-only id.
  }

  const created = generateId();
  cached = created;
  try {
    await AsyncStorage.setItem(CUSTOMER_ID_KEY, created);
  } catch {
    // Non-fatal: the id simply won't survive a restart.
  }
  return created;
};

/** Clears the identity, e.g. on logout. */
export const resetCustomerId = async (): Promise<void> => {
  cached = undefined;
  try {
    await AsyncStorage.removeItem(CUSTOMER_ID_KEY);
  } catch {
    // Ignore.
  }
};
