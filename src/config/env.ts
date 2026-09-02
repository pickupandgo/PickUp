import Constants from 'expo-constants';

interface AppExtra {
  readonly apiBaseUrl?: string;
  readonly googleMapsApiKey?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as AppExtra;

/** Strips any trailing slash so path joining is predictable. */
const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

export const env = {
  apiBaseUrl: normalizeBaseUrl(extra.apiBaseUrl ?? ''),
  googleMapsApiKey: extra.googleMapsApiKey ?? '',
} as const;

/** True when the backend URL is configured. */
export const hasApiConfig = (): boolean => env.apiBaseUrl.length > 0;

/** True when geocoding/autocomplete can be used. */
export const hasGeocodingConfig = (): boolean => env.googleMapsApiKey.length > 0;

/**
 * Fails loudly during development if configuration is missing, rather than
 * letting requests silently hit a relative URL at runtime.
 */
export const assertApiConfig = (): void => {
  if (!hasApiConfig()) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL is not set. Copy .env.example to .env and set the backend URL, then restart the dev server with `-c` to clear the cache.'
    );
  }
};
