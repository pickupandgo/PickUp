import Config from 'react-native-config';

declare const process: any;

/** Strips any trailing slash so path joining is predictable. */
const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

/**
 * The payments backend carries the signed-in customer's Firebase token. A release build only
 * accepts https so a token is never sent in clear text; plain http is allowed in development
 * builds so a backend on the developer's machine can be used. Anything else is dropped.
 */
const parseSecureBaseUrl = (value: string | undefined): string => {
  const raw = (value ?? '').trim();
  if (!raw) {
    return '';
  }
  const isHttps = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/.*)?$/.test(raw);
  const isDevHttp = __DEV__ && /^http:\/\/[A-Za-z0-9.-]+(:\d+)?(\/.*)?$/.test(raw);
  if (!isHttps && !isDevHttp) {
    return '';
  }
  // Strip trailing slashes and any trailing /v1 version suffix so path joining is predictable
  // regardless of whether the base URL in .env includes /v1 or not.
  return normalizeBaseUrl(raw.replace(/\/v1\/?$/, ''));
};

const resolveRawPaymentsUrl = (): string => {
  const explicit =
    Config.EXPO_PUBLIC_PAYMENTS_API_BASE_URL ??
    Config.PAYMENTS_API_BASE_URL ??
    (typeof process !== 'undefined' && process.env
      ? (process.env.EXPO_PUBLIC_PAYMENTS_API_BASE_URL || process.env.PAYMENTS_API_BASE_URL)
      : undefined);

  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  // Fall back to engine API URL if explicit payments URL is not specified
  const fallback =
    Config.EXPO_PUBLIC_API_BASE_URL ??
    Config.API_BASE_URL ??
    (typeof process !== 'undefined' && process.env
      ? (process.env.EXPO_PUBLIC_API_BASE_URL || process.env.API_BASE_URL)
      : undefined);

  return (fallback ?? '').trim();
};

const resolveRawApiUrl = (): string => {
  const explicit =
    Config.EXPO_PUBLIC_API_BASE_URL ??
    Config.API_BASE_URL ??
    (typeof process !== 'undefined' && process.env
      ? (process.env.EXPO_PUBLIC_API_BASE_URL || process.env.API_BASE_URL)
      : undefined);

  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  const fallback =
    Config.EXPO_PUBLIC_PAYMENTS_API_BASE_URL ??
    Config.PAYMENTS_API_BASE_URL ??
    (typeof process !== 'undefined' && process.env
      ? (process.env.EXPO_PUBLIC_PAYMENTS_API_BASE_URL || process.env.PAYMENTS_API_BASE_URL)
      : undefined);

  return (fallback ?? '').trim();
};

/** Prefer a dedicated engine URL while keeping the legacy API URL as a compatible fallback. */
const resolveRawEngineUrl = (): string => {
  const explicit =
    Config.EXPO_PUBLIC_ENGINE_API_BASE_URL ??
    Config.ENGINE_API_BASE_URL ??
    (typeof process !== 'undefined' && process.env
      ? (process.env.EXPO_PUBLIC_ENGINE_API_BASE_URL || process.env.ENGINE_API_BASE_URL)
      : undefined);

  return explicit && explicit.trim() ? explicit.trim() : resolveRawApiUrl();
};

export const env = {
  /** Trip engine base URL (dispatch, rides, trips, OTP reads). */
  engineApiBaseUrl: parseSecureBaseUrl(resolveRawEngineUrl()),
  // Legacy consumers use apiBaseUrl. Keep it mapped to the authenticated engine endpoint.
  apiBaseUrl: parseSecureBaseUrl(resolveRawEngineUrl()),
  /** Payments backend base URL (fare quotes, customer account, booking payment state). */
  paymentsApiBaseUrl: parseSecureBaseUrl(resolveRawPaymentsUrl()),
  googleMapsApiKey:
    Config.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
    Config.GOOGLE_MAPS_API_KEY ??
    (typeof process !== 'undefined' && process.env
      ? (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY)
      : '') ??
    '',
} as const;

/** True when the engine base URL is configured. */
export const hasApiConfig = (): boolean => env.engineApiBaseUrl.length > 0;
/** True when the payments backend base URL is configured (and allowed). */
export const hasPaymentsConfig = (): boolean => env.paymentsApiBaseUrl.length > 0;
/** True when geocoding/autocomplete can be used. */
export const hasGeocodingConfig = (): boolean => env.googleMapsApiKey.length > 0;

export const assertApiConfig = (): void => {
  if (!hasApiConfig()) {
    throw new Error('ENGINE_API_BASE_URL is not set.');
  }
};

