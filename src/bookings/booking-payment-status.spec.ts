import { collectedPaymentStatus } from './booking-payment-status';

describe('collectedPaymentStatus', () => {
  const stopIds = ['stop-1', 'stop-2', 'stop-3'];

  describe('paid drop by drop', () => {
    it('is UNPAID, then PARTIALLY_PAID, then PAID as the drops are paid', () => {
      const status = (paid: string[]) =>
        collectedPaymentStatus({
          perDrop: true,
          stopIds,
          completed: paid.map((bookingStopId) => ({ bookingStopId })),
        });
      expect(status([])).toBe('UNPAID');
      expect(status(['stop-1'])).toBe('PARTIALLY_PAID');
      expect(status(['stop-1', 'stop-3'])).toBe('PARTIALLY_PAID');
      expect(status(['stop-1', 'stop-2', 'stop-3'])).toBe('PAID');
    });

    it('goes straight to PAID for a single drop', () => {
      expect(
        collectedPaymentStatus({
          perDrop: true,
          stopIds: ['only'],
          completed: [{ bookingStopId: 'only' }],
        }),
      ).toBe('PAID');
    });

    it("counts each drop once, and nothing that isn't one of the booking's drops", () => {
      expect(
        collectedPaymentStatus({
          perDrop: true,
          stopIds,
          completed: [
            { bookingStopId: 'stop-1' },
            { bookingStopId: 'stop-1' },
            { bookingStopId: 'another-booking-stop' },
            { bookingStopId: null },
          ],
        }),
      ).toBe('PARTIALLY_PAID');
    });
  });

  describe('paid for the whole booking', () => {
    it('is PAID once its collection for the whole booking completed', () => {
      expect(collectedPaymentStatus({ perDrop: false, stopIds, completed: [] })).toBe('UNPAID');
      expect(
        collectedPaymentStatus({ perDrop: false, stopIds, completed: [{ bookingStopId: null }] }),
      ).toBe('PAID');
      // A drop's collection never pays a booking that is collected as a whole.
      expect(
        collectedPaymentStatus({
          perDrop: false,
          stopIds,
          completed: [{ bookingStopId: 'stop-1' }],
        }),
      ).toBe('UNPAID');
    });
  });
});
