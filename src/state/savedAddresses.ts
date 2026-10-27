import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import { useCallback, useEffect, useState } from 'react';

export type SavedAddressIcon = 'home' | 'briefcase' | 'box' | 'map-pin';

export interface SavedAddress {
  readonly id: string;
  readonly title: string;
  readonly icon: SavedAddressIcon;
  readonly isPrimary?: boolean;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly createdAt: number;
}

export interface SavedAddressInput {
  readonly id?: string;
  readonly title: string;
  readonly icon?: SavedAddressIcon;
  readonly isPrimary?: boolean;
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export const DEFAULT_SAVED_ADDRESSES: readonly SavedAddress[] = [];

const SAVED_ADDRESSES_STORAGE_KEY_PREFIX = 'pickup.savedAddresses.';

export const getSavedAddressesStorageKey = (userId?: string | null): string => {
  if (userId && userId.trim().length > 0) {
    return `${SAVED_ADDRESSES_STORAGE_KEY_PREFIX}${userId.trim()}`;
  }
  try {
    const authUid = getAuth().currentUser?.uid;
    if (authUid && authUid.trim().length > 0) {
      return `${SAVED_ADDRESSES_STORAGE_KEY_PREFIX}${authUid.trim()}`;
    }
  } catch {
    // Ignore in non-auth contexts
  }
  return `${SAVED_ADDRESSES_STORAGE_KEY_PREFIX}guest`;
};

type Listener = (addresses: SavedAddress[], key: string) => void;
const listeners = new Set<Listener>();

export const subscribeSavedAddresses = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notifyListeners = (addresses: SavedAddress[], key: string): void => {
  listeners.forEach((listener) => {
    try {
      listener(addresses, key);
    } catch (e) {
      console.warn('[SAVED_ADDRESSES] Listener error:', e);
    }
  });
};

/**
 * Filter out any legacy dummy mock addresses (Shastri Nagar, Tech Hub Ratanada, Basni Industrial Area)
 * that were previously seeded during development.
 */
const purgeLegacyMockAddresses = (list: SavedAddress[]): SavedAddress[] => {
  return list.filter((addr) => {
    if (!addr || typeof addr !== 'object') return false;
    const isMockHome = addr.id === '1' && (addr.addressLine1?.includes('Shastri Nagar') || addr.addressLine2?.includes('Shastri Nagar'));
    const isMockOffice = addr.id === '2' && addr.addressLine1?.includes('Tech Hub');
    const isMockWarehouse = addr.id === '3' && addr.addressLine1?.includes('Basni Industrial Area');
    return !isMockHome && !isMockOffice && !isMockWarehouse;
  });
};

/**
 * Retrieves saved addresses for a user. Never seeds hardcoded dummy addresses.
 */
export const getSavedAddresses = async (userId?: string | null): Promise<SavedAddress[]> => {
  const key = getSavedAddressesStorageKey(userId);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      // Check if user had addresses saved in guest session to migrate
      if (userId && userId.trim().length > 0) {
        const guestKey = `${SAVED_ADDRESSES_STORAGE_KEY_PREFIX}guest`;
        const guestRaw = await AsyncStorage.getItem(guestKey);
        if (guestRaw) {
          const guestParsed = JSON.parse(guestRaw);
          if (Array.isArray(guestParsed)) {
            const cleanGuest = purgeLegacyMockAddresses(guestParsed);
            if (cleanGuest.length > 0) {
              await AsyncStorage.setItem(key, JSON.stringify(cleanGuest));
              return cleanGuest;
            }
          }
        }
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const clean = purgeLegacyMockAddresses(parsed);
      if (clean.length !== parsed.length) {
        await AsyncStorage.setItem(key, JSON.stringify(clean));
      }
      return clean;
    }
    return [];
  } catch (e) {
    console.warn('[SAVED_ADDRESSES] Failed to load saved addresses:', e);
    return [];
  }
};

/**
 * Adds a new address to the saved addresses list.
 */
export const saveAddress = async (
  input: SavedAddressInput,
  userId?: string | null
): Promise<SavedAddress[]> => {
  const key = getSavedAddressesStorageKey(userId);
  try {
    const current = await getSavedAddresses(userId);
    const isFirst = current.length === 0;
    const shouldBePrimary = Boolean(input.isPrimary ?? isFirst);

    const newAddress: SavedAddress = {
      id: input.id || `addr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: input.title.trim() || 'Address',
      icon: input.icon || 'map-pin',
      isPrimary: shouldBePrimary,
      addressLine1: input.addressLine1.trim(),
      addressLine2: input.addressLine2.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      createdAt: Date.now(),
    };

    const updated = shouldBePrimary
      ? [newAddress, ...current.map((item) => ({ ...item, isPrimary: false }))]
      : [...current, newAddress];

    await AsyncStorage.setItem(key, JSON.stringify(updated));
    notifyListeners(updated, key);
    return updated;
  } catch (e) {
    console.warn('[SAVED_ADDRESSES] Failed to save address:', e);
    return getSavedAddresses(userId);
  }
};

/**
 * Updates an existing address in the saved list.
 */
export const updateSavedAddress = async (
  id: string,
  updates: Partial<SavedAddressInput>,
  userId?: string | null
): Promise<SavedAddress[]> => {
  const key = getSavedAddressesStorageKey(userId);
  try {
    const current = await getSavedAddresses(userId);
    const existing = current.find((item) => item.id === id);
    if (!existing) return current;

    const shouldBePrimary = updates.isPrimary !== undefined ? updates.isPrimary : existing.isPrimary;

    const updated = current.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          title: updates.title !== undefined ? updates.title.trim() : item.title,
          icon: updates.icon || item.icon,
          isPrimary: shouldBePrimary,
          addressLine1: updates.addressLine1 !== undefined ? updates.addressLine1.trim() : item.addressLine1,
          addressLine2: updates.addressLine2 !== undefined ? updates.addressLine2.trim() : item.addressLine2,
          latitude: updates.latitude !== undefined ? updates.latitude : item.latitude,
          longitude: updates.longitude !== undefined ? updates.longitude : item.longitude,
        };
      }
      if (shouldBePrimary) {
        return { ...item, isPrimary: false };
      }
      return item;
    });

    await AsyncStorage.setItem(key, JSON.stringify(updated));
    notifyListeners(updated, key);
    return updated;
  } catch (e) {
    console.warn('[SAVED_ADDRESSES] Failed to update address:', e);
    return getSavedAddresses(userId);
  }
};

/**
 * Deletes an address from the saved list.
 */
export const deleteSavedAddress = async (
  id: string,
  userId?: string | null
): Promise<SavedAddress[]> => {
  const key = getSavedAddressesStorageKey(userId);
  try {
    const current = await getSavedAddresses(userId);
    const filtered = current.filter((item) => item.id !== id);

    // If we deleted the primary address and other addresses exist, designate the first one as primary
    let finalUpdated = filtered;
    const hadPrimary = current.some((item) => item.id === id && item.isPrimary);
    if (hadPrimary && filtered.length > 0) {
      finalUpdated = filtered.map((item, index) =>
        index === 0 ? { ...item, isPrimary: true } : item
      );
    }

    await AsyncStorage.setItem(key, JSON.stringify(finalUpdated));
    notifyListeners(finalUpdated, key);
    return finalUpdated;
  } catch (e) {
    console.warn('[SAVED_ADDRESSES] Failed to delete address:', e);
    return getSavedAddresses(userId);
  }
};

/**
 * Sets a specific address as primary.
 */
export const setPrimarySavedAddress = async (
  id: string,
  userId?: string | null
): Promise<SavedAddress[]> => {
  const key = getSavedAddressesStorageKey(userId);
  try {
    const current = await getSavedAddresses(userId);
    const updated = current.map((item) => ({
      ...item,
      isPrimary: item.id === id,
    }));
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    notifyListeners(updated, key);
    return updated;
  } catch (e) {
    console.warn('[SAVED_ADDRESSES] Failed to set primary address:', e);
    return getSavedAddresses(userId);
  }
};

/**
 * Hook to consume saved addresses reactively.
 */
export const useSavedAddresses = (userId?: string | null) => {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const key = getSavedAddressesStorageKey(userId);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await getSavedAddresses(userId);
      setAddresses(list);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  const addAddress = useCallback(
    async (input: SavedAddressInput) => {
      const updated = await saveAddress(input, userId);
      setAddresses(updated);
      return updated;
    },
    [userId]
  );

  const updateAddress = useCallback(
    async (id: string, updates: Partial<SavedAddressInput>) => {
      const updated = await updateSavedAddress(id, updates, userId);
      setAddresses(updated);
      return updated;
    },
    [userId]
  );

  const removeAddress = useCallback(
    async (id: string) => {
      const updated = await deleteSavedAddress(id, userId);
      setAddresses(updated);
      return updated;
    },
    [userId]
  );

  const setPrimary = useCallback(
    async (id: string) => {
      const updated = await setPrimarySavedAddress(id, userId);
      setAddresses(updated);
      return updated;
    },
    [userId]
  );

  useEffect(() => {
    void refresh();
    return subscribeSavedAddresses((updatedList, updatedKey) => {
      if (updatedKey === key) {
        setAddresses(updatedList);
        setIsLoading(false);
      }
    });
  }, [key, refresh]);

  return {
    addresses,
    isLoading,
    refresh,
    addAddress,
    updateAddress,
    removeAddress,
    setPrimary,
  };
};
