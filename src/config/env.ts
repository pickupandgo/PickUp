/**
 * Application environment configuration.
 *
 * Values are provided via a build-time `.env` file and read here through
 * `react-native-config`. See `.env.example` for the available keys.
 *
 * The application operates in mock mode when no backend (API_BASE_URL)
 * is configured.
 *
 * DO NOT hardcode production URLs or secrets in this file — put them in `.env`.
 */

import Config from 'react-native-config';

/** Treat missing or empty env values as `undefined`. */
const readOptional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Read from the `.env` config if available; undefined otherwise. */
const EXTERNAL_API_BASE_URL: string | undefined = readOptional(Config.API_BASE_URL);
const EXTERNAL_WS_ENDPOINT: string | undefined = readOptional(Config.WS_ENDPOINT);
const GOOGLE_MAPS_API_KEY: string | undefined = readOptional(Config.GOOGLE_MAPS_API_KEY);

/**
 * Payments + driver wallet backend. Release builds only accept https. Plain http is allowed
 * in development builds so a backend on the developer's laptop can be used for testing.
 * Anything else is rejected (undefined), so a bad value can never send tokens in clear text.
 */
const parsePaymentsBaseUrl = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const url = value.replace(/\/+$/, '');
  const rootUrl = url.replace(/\/v1$/, '');
  const isHttps = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(rootUrl);
  const isDevHttp = __DEV__ && /^http:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(rootUrl);
  return isHttps || isDevHttp ? rootUrl : undefined;
};

const PAYMENTS_API_BASE_URL = parsePaymentsBaseUrl(readOptional(Config.PAYMENTS_API_BASE_URL));

/**
 * When true, domain services use mock adapters instead of
 * making real API calls. This is the default when no production
 * backend endpoint has been configured.
 */
const IS_MOCK_MODE = !EXTERNAL_API_BASE_URL;

export interface AppEnvironment {
  /** Base URL for the REST API. Undefined when no backend is configured. */
  readonly API_BASE_URL: string | undefined;
  /** WebSocket endpoint for real-time features. Undefined when no backend is configured. */
  readonly WS_ENDPOINT: string | undefined;
  readonly ENVIRONMENT: 'development' | 'staging' | 'production';
  readonly IS_MOCK_MODE: boolean;
  /** Default request timeout in milliseconds. */
  readonly REQUEST_TIMEOUT_MS: number;
  readonly googleMapsApiKey?: string;
  /** Payments + wallet backend base URL. Undefined when not configured (or not allowed). */
  readonly PAYMENTS_API_BASE_URL: string | undefined;
}

export const env: AppEnvironment = {
  API_BASE_URL: EXTERNAL_API_BASE_URL,
  WS_ENDPOINT: EXTERNAL_WS_ENDPOINT,
  ENVIRONMENT: 'development',
  IS_MOCK_MODE,
  REQUEST_TIMEOUT_MS: 15000,
  googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  PAYMENTS_API_BASE_URL,
};

export const hasGeocodingConfig = () => !!env.googleMapsApiKey;
