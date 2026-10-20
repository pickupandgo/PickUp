import { EngineApiError } from '../engine/engineClient';
import type { EngineTripStatus } from '../engine/dispatch';
import type { ActiveTrip } from '../../types/trip';

type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/** Engine codes with their own message (EN and HI). Branch on the code, never on the text. */
const CODE_KEYS: Readonly<Record<string, string>> = {
  PAYMENT_REQUIRED: 'trip.errPaymentRequired',
  BOOKING_CANCELLED: 'trip.errCancelled',
  PAYMENT_BACKEND_UNAVAILABLE: 'trip.errBackendUnavailable',
  DELIVERY_BEING_CONFIRMED: 'trip.errDeliveryBeingConfirmed',
  NETWORK_ERROR: 'trip.errUnknownOutcome',
  TIMEOUT: 'trip.errUnknownOutcome',
  INVALID_RESPONSE: 'trip.errUnknownOutcome',
  NOT_SIGNED_IN: 'trip.errSignIn',
  AUTH_REQUIRED: 'trip.errSignIn',
  AUTH_INVALID_TOKEN: 'trip.errSignIn',
  IDENTITY_MISMATCH: 'trip.errNotYourTrip',
  FORBIDDEN: 'trip.errNotYourTrip',
  NOT_CONFIGURED: 'trip.errNotConfigured',
  AUTH_PROVIDER_UNAVAILABLE: 'trip.errTryAgain',
};

/**
 * A message for a failed trip action that is safe to show the driver. A refusal the app has no
 * message for shows the engine's own message (Contract G: "the server's message").
 */
export function describeTripError(error: unknown, t: Translate): string {
  if (error instanceof EngineApiError) {
    const key = CODE_KEYS[error.code];
    if (key) {
      return t(key);
    }
    if (error.status === 403) {
      return t('trip.errNotYourTrip');
    }
    if (error.status === 404) {
      return t('trip.errNotFound');
    }
    if (error.status >= 400 && error.status < 500 && error.message) {
      return error.message;
    }
    return t('trip.errTryAgain');
  }
  if (error instanceof RangeError) {
    return t('trip.errInvalidInput');
  }
  return t('trip.errTryAgain');
}

/** True when the request got no answer: the engine may have applied it, so re-read first. */
export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof EngineApiError && error.outcomeUnknown;
}

const APP_TO_ENGINE_STATUS: Readonly<Record<string, EngineTripStatus>> = {
  accepted: 'DRIVER_ASSIGNED',
  en_route_pickup: 'DRIVER_ASSIGNED',
  arrived_pickup: 'DRIVER_ARRIVED',
  pickup_verified: 'PICKUP_VERIFIED',
  in_transit: 'IN_TRANSIT',
  arrived_drop: 'DROP_PROGRESS',
  drop_verified: 'DELIVERED',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  expired: 'CANCELLED',
};

/** The engine's trip status (authoritative); derived from the display status only for the mock. */
export function engineStatusOf(trip: ActiveTrip): EngineTripStatus {
  return (
    (trip.engineStatus as EngineTripStatus | undefined) ??
    APP_TO_ENGINE_STATUS[trip.status] ??
    'DRIVER_ASSIGNED'
  );
}
