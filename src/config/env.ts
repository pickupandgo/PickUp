import Config from 'react-native-config';

/** Strips any trailing slash so path joining is predictable. */
const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

export const env = {
  apiBaseUrl: normalizeBaseUrl(Config.EXPO_PUBLIC_API_BASE_URL ?? Config.API_BASE_URL ?? ''),
  googleMapsApiKey: Config.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? Config.GOOGLE_MAPS_API_KEY ?? '',
} as const;

/** True when the backend URL is configured. */
export const hasApiConfig = (): boolean => env.apiBaseUrl.length > 0;

/** True when geocoding/autocomplete can be used. */
export const hasGeocodingConfig = (): boolean => env.googleMapsApiKey.length > 0;

export const assertApiConfig = (): void => {
  if (!hasApiConfig()) {
    throw new Error('API_BASE_URL is not set.');
  }
};

console.log('API BASE URL IS:', env.apiBaseUrl);

