import type { EngineStopStatus } from '../generated/prisma/enums';
import { nextStopIndex, tripReached } from './trip-progress';

const stops = (...statuses: EngineStopStatus[]) =>
  statuses.map((status) => ({ status }));

describe('trip progress', () => {
  describe('tripReached', () => {
    it('follows the M6 order, treating DROP_PROGRESS like IN_TRANSIT', () => {
      expect(tripReached('DRIVER_ARRIVED', 'DRIVER_ARRIVED')).toBe(true);
      expect(tripReached('DRIVER_ARRIVED', 'PICKUP_VERIFIED')).toBe(false);
      expect(tripReached('IN_TRANSIT', 'PICKUP_VERIFIED')).toBe(true);
      expect(tripReached('DROP_PROGRESS', 'IN_TRANSIT')).toBe(true);
      expect(tripReached('IN_TRANSIT', 'DROP_PROGRESS')).toBe(true);
      expect(tripReached('DELIVERED', 'IN_TRANSIT')).toBe(true);
      expect(tripReached('COMPLETED', 'DELIVERED')).toBe(true);
      expect(tripReached('DELIVERED', 'COMPLETED')).toBe(false);
    });

    it('never counts a cancelled trip as having reached anything', () => {
      expect(tripReached('CANCELLED', 'DRIVER_ASSIGNED')).toBe(false);
      expect(tripReached('CANCELLED', 'PICKUP_VERIFIED')).toBe(false);
    });
  });

  describe('nextStopIndex', () => {
    it('moves to the next unfinished drop', () => {
      expect(nextStopIndex(stops('DELIVERED', 'PENDING', 'PENDING'), 0)).toBe(
        1,
      );
      expect(
        nextStopIndex(stops('DELIVERED', 'UNDELIVERED', 'PENDING'), 0),
      ).toBe(2);
    });

    it('returns null once every drop is finished', () => {
      expect(nextStopIndex(stops('DELIVERED', 'DELIVERED'), 1)).toBeNull();
      expect(
        nextStopIndex(stops('DELIVERED', 'UNDELIVERED', 'CANCELLED'), 0),
      ).toBeNull();
    });

    it('keeps a failed drop unfinished (retry or admin resolution first)', () => {
      expect(
        nextStopIndex(stops('DELIVERED', 'DELIVERY_FAILED', 'PENDING'), 0),
      ).toBe(1);
    });
  });
});
