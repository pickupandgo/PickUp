import type { BackendOutcome } from '../payment-backend/payment-backend.client';
import {
  backoffMs,
  classify,
  type PolicyRecord,
  shouldAlertRetry,
} from './outbox-policy';

const ok: BackendOutcome = { kind: 'OK', status: 200, body: {} };
const unavailable = (code = 'HTTP_503'): BackendOutcome => ({
  kind: 'UNAVAILABLE',
  status: 503,
  code,
  message: '',
});
const refused = (code: string, status = 409): BackendOutcome => ({
  kind: 'REFUSED',
  status,
  code,
  message: '',
  details: null,
});

const command = (
  kind: PolicyRecord['kind'],
  status?: string,
): PolicyRecord => ({
  kind,
  mode: 'COMMAND',
  ...(status ? { status } : {}),
});
const event = (kind: PolicyRecord['kind'], status?: string): PolicyRecord => ({
  kind,
  mode: 'EVENT',
  ...(status ? { status } : {}),
});

describe('outbox policy', () => {
  describe('classify', () => {
    it('treats any 2xx as delivered (a repeat is a no-op at the backend)', () => {
      expect(classify(command('ASSIGN'), ok)).toEqual({ kind: 'DELIVERED' });
      expect(classify(event('TRIP_STATUS', 'DRIVER_ARRIVED'), ok)).toEqual({
        kind: 'DELIVERED',
      });
    });

    it('retries every outcome without a definitive answer, never drops it', () => {
      for (const code of [
        'TIMEOUT',
        'NETWORK_ERROR',
        'HTTP_503',
        'UNEXPECTED_RESPONSE',
      ]) {
        expect(classify(event('CANCEL'), unavailable(code))).toEqual({
          kind: 'RETRY',
          alert: false,
        });
      }
    });

    it('retries a completion while the payment is not confirmed (review F retry loop)', () => {
      expect(
        classify(
          command('TRIP_STATUS', 'COMPLETED'),
          refused('PAYMENT_REQUIRED'),
        ),
      ).toEqual({ kind: 'RETRY', alert: false });
    });

    it('records the expected PAYMENT_REQUIRED of a backend-first command without an alert', () => {
      expect(
        classify(
          command('TRIP_STATUS', 'PICKUP_VERIFIED'),
          refused('PAYMENT_REQUIRED'),
        ),
      ).toEqual({ kind: 'REFUSED', alert: false });
      expect(
        classify(
          command('STOP_STATUS', 'DELIVERED'),
          refused('PAYMENT_REQUIRED'),
        ),
      ).toEqual({ kind: 'REFUSED', alert: false });
    });

    it('alerts any other refusal: engine and backend disagree', () => {
      expect(
        classify(command('TRIP_STATUS', 'COMPLETED'), refused('STOPS_PENDING')),
      ).toEqual({ kind: 'REFUSED', alert: true });
      expect(
        classify(
          command('TRIP_STATUS', 'IN_TRANSIT'),
          refused('INVALID_TRIP_TRANSITION'),
        ),
      ).toEqual({ kind: 'REFUSED', alert: true });
      expect(
        classify(command('ASSIGN'), refused('DRIVER_NOT_APPROVED')),
      ).toEqual({
        kind: 'REFUSED',
        alert: true,
      });
      // An event describes what the engine already did: even PAYMENT_REQUIRED is a divergence.
      expect(
        classify(event('STOP_STATUS', 'ARRIVED'), refused('PAYMENT_REQUIRED')),
      ).toEqual({ kind: 'REFUSED', alert: true });
      expect(classify(event('CANCEL'), refused('BOOKING_CLOSED'))).toEqual({
        kind: 'REFUSED',
        alert: true,
      });
    });
  });

  describe('backoffMs (exponential, capped, equal jitter)', () => {
    it('keeps half of the delay fixed and never retries immediately', () => {
      expect(backoffMs(1, 1_000, 300_000, () => 0)).toBe(500);
      expect(backoffMs(1, 1_000, 300_000, () => 1)).toBe(1_000);
      expect(backoffMs(2, 1_000, 300_000, () => 0)).toBe(1_000);
      expect(backoffMs(4, 1_000, 300_000, () => 0.5)).toBe(6_000);
    });

    it('caps the delay and survives very large attempt counts', () => {
      expect(backoffMs(20, 1_000, 300_000, () => 1)).toBe(300_000);
      expect(backoffMs(10_000, 1_000, 300_000, () => 0)).toBe(150_000);
      expect(backoffMs(0, 1_000, 300_000, () => 0)).toBe(500);
    });
  });

  describe('shouldAlertRetry', () => {
    it('alerts at the threshold and then every threshold attempts', () => {
      const alerted = Array.from({ length: 25 }, (_, i) => i + 1).filter(
        (attempts) => shouldAlertRetry(attempts, 8),
      );
      expect(alerted).toEqual([8, 16, 24]);
      expect(shouldAlertRetry(1, 1)).toBe(true);
    });
  });
});
