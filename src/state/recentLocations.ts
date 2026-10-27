import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import { useCallback, useEffect, useState } from 'react';

export interface RecentLocation {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly searchedAt: number;
  readonly placeId?: string;
}

export interface RecentLocationInput {
  readonly id?: string;
  readonly name?: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly placeId?: string;
  readonly searchedAt?: number;
}

const RECENT_LOCATIONS_KEY_PREFIX = 'pickup.recentLocations.';
const MAX_RECENT_LOCATIONS = 10;

/** Resolves the isolated storage key for a user. */
export const getRecentLocationsStorageKey = (userId?: string | null): string => {
  if (userId && userId.trim().length > 0) {
    return `${RECENT_LOCATIONS_KEY_PREFIX}${userId.trim()}`;
  }
  try {
    const authUid = getAuth().currentUser?.uid;
    if (authUid && authUid.trim().length > 0) {
      return `${RECENT_LOCATIONS_KEY_PREFIX}${authUid.trim()}`;
    }
  } catch {
    // Ignore in non-auth contexts
  }
  return `${RECENT_LOCATIONS_KEY_PREFIX}guest`;
};

type Listener = (locations: RecentLocation[], key: string) => void;
const listeners = new Set<Listener>();

export const subscribeRecentLocations = (
  listener: (locations: RecentLocation[], key: string) => void
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notifyListeners = (locations: RecentLocation[], key: string): void => {
  listeners.forEach((listener) => {
    try {
      listener(locations, key);
    } catch (e) {
      console.warn('[RECENT_LOCATIONS] Listener error:', e);
    }
  });
};

const isSameLocation = (
  a: RecentLocation,
  b: { address: string; latitude?: number; longitude?: number; placeId?: string }
): boolean => {
  if (a.placeId && b.placeId && a.placeId === b.placeId) {
    return true;
  }
  if (a.address.trim().toLowerCase() === b.address.trim().toLowerCase()) {
    return true;
  }
  if (
    typeof a.latitude === 'number' &&
    typeof a.longitude === 'number' &&
    typeof b.latitude === 'number' &&
    typeof b.longitude === 'number' &&
    !isNaN(a.latitude) &&
    !isNaN(b.latitude)
  ) {
    const latDiff = Math.abs(a.latitude - b.latitude);
    const lngDiff = Math.abs(a.longitude - b.longitude);
    if (latDiff < 0.0002 && lngDiff < 0.0002) {
      return true;
    }
  }
  return false;
};

/**
 * Retrieves the recent locations for a specific user, ordered descending by search time.
 */
export const getRecentLocations = async (userId?: string | null): Promise<RecentLocation[]> => {
  const key = getRecentLocationsStorageKey(userId);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid = parsed.filter(
      (item): item is RecentLocation =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.address === 'string' &&
        item.address.trim().length > 0 &&
        typeof item.latitude === 'number' &&
        !isNaN(item.latitude) &&
        typeof item.longitude === 'number' &&
        !isNaN(item.longitude)
    );

    return valid.sort((a, b) => (b.searchedAt || 0) - (a.searchedAt || 0));
  } catch (e) {
    console.warn('[RECENT_LOCATIONS] Failed to load recent locations:', e);
    return [];
  }
};

/**
 * Saves or moves a location to the top of recent searches for the authenticated user.
 */
export const saveRecentLocation = async (
  input: RecentLocationInput,
  userId?: string | null
): Promise<RecentLocation[]> => {
  if (!input.address || input.address.trim().length === 0) {
    return getRecentLocations(userId);
  }
  if (typeof input.latitude !== 'number' || isNaN(input.latitude) || typeof input.longitude !== 'number' || isNaN(input.longitude)) {
    return getRecentLocations(userId);
  }

  const key = getRecentLocationsStorageKey(userId);
  try {
    const existingList = await getRecentLocations(userId);

    // Filter out duplicates
    const filtered = existingList.filter((item) => !isSameLocation(item, input));

    // Construct meaningful name
    const meaningfulName = (input.name && input.name.trim().length > 0)
      ? input.name.trim()
      : input.address.split(',')[0].trim();

    const newLocation: RecentLocation = {
      id: input.id || input.placeId || `loc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: meaningfulName || 'Location',
      address: input.address.trim(),
      latitude: input.latitude,
      longitude: input.longitude,
      searchedAt: Date.now(),
      placeId: input.placeId,
    };

    const updated = [newLocation, ...filtered].slice(0, MAX_RECENT_LOCATIONS);
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    notifyListeners(updated, key);
    return updated;
  } catch (e) {
    console.warn('[RECENT_LOCATIONS] Failed to save recent location:', e);
    return getRecentLocations(userId);
  }
};

/**
 * Clears recent locations for a specific user.
 */
export const clearRecentLocations = async (userId?: string | null): Promise<void> => {
  const key = getRecentLocationsStorageKey(userId);
  try {
    await AsyncStorage.removeItem(key);
    notifyListeners([], key);
  } catch (e) {
    console.warn('[RECENT_LOCATIONS] Failed to clear recent locations:', e);
  }
};

/**
 * Hook to reactively consume recent locations for the active user.
 */
export const useRecentLocations = (userId?: string | null) => {
  const [locations, setLocations] = useState<RecentLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const key = getRecentLocationsStorageKey(userId);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await getRecentLocations(userId);
      setLocations(list);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    return subscribeRecentLocations((updatedList, updatedKey) => {
      if (updatedKey === key) {
        setLocations(updatedList);
        setIsLoading(false);
      }
    });
  }, [key, refresh]);

  return {
    locations,
    isLoading,
    refresh,
  };
};
