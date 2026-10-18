import Config from 'react-native-config';

/** Strips any trailing slash so path joining is predictable. */
const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

/**
 * The payments backend carries the signed-in customer's Firebase token. A release build only
 * accepts https so a token is never sent in clear text; plain http is allowed in development
 * builds so a backend on the developer's machine can be used. Anything else is dropped.
 */
const parseSecureBaseUrl = (value: string | undefined): string => {
  const url = normalizeBaseUrl((value ?? '').trim());
  if (!url) {
    return '';
  }
  const isHttps = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(url);
  const isDevHttp = __DEV__ && /^http:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(url);
  return isHttps || isDevHttp ? url : '';
};

export const env = {
  /** Trip engine base URL (dispatch, rides, trips, OTP reads). */
  apiBaseUrl: normalizeBaseUrl(Config.EXPO_PUBLIC_API_BASE_URL ?? Config.API_BASE_URL ?? ''),
  /** Payments backend base URL (fare quotes, customer account, booking payment state). */
  paymentsApiBaseUrl: parseSecureBaseUrl(
    Config.EXPO_PUBLIC_PAYMENTS_API_BASE_URL ?? Config.PAYMENTS_API_BASE_URL,
  ),
  googleMapsApiKey: Config.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? Config.GOOGLE_MAPS_API_KEY ?? '',
} as const;

/** True when the engine base URL is configured. */
export const hasApiConfig = (): boolean => env.apiBaseUrl.length > 0;
/** True when the payments backend base URL is configured (and allowed). */
export const hasPaymentsConfig = (): boolean => env.paymentsApiBaseUrl.length > 0;
/** True when geocoding/autocomplete can be used. */
export const hasGeocodingConfig = (): boolean => env.googleMapsApiKey.length > 0;

export const assertApiConfig = (): void => {
  if (!hasApiConfig()) {
    throw new Error('API_BASE_URL is not set.');
  }
};
