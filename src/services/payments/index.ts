import { env } from '../../config/env';
import { getFirebaseIdToken } from './firebaseToken';
import { createPaymentsApi, type PaymentsApi } from './paymentsApi';
import { createPaymentsClient } from './paymentsClient';

let api: PaymentsApi | null = null;

/** The payments backend API, or null when PAYMENTS_API_BASE_URL is not configured. */
export function getPaymentsApi(): PaymentsApi | null {
  if (!env.PAYMENTS_API_BASE_URL) {
    return null;
  }
  if (!api) {
    api = createPaymentsApi(
      createPaymentsClient({
        baseUrl: env.PAYMENTS_API_BASE_URL,
        getToken: getFirebaseIdToken,
        timeoutMs: env.REQUEST_TIMEOUT_MS,
      }),
    );
  }
  return api;
}
