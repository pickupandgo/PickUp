import {
  refundCaseOf,
  refundMove,
  refundStatusForProvider,
  resolveRefundAmount,
} from './refund-policy';

describe('refundCaseOf', () => {
  it('records the facts: cancelled before or after the handover, undelivered drop, completed', () => {
    expect(refundCaseOf({ bookingStatus: 'CANCELLED', handedOver: false, stopStatus: null })).toBe(
      'CANCELLED_BEFORE_HANDOVER',
    );
    expect(refundCaseOf({ bookingStatus: 'CANCELLED', handedOver: true, stopStatus: null })).toBe(
      'CANCELLED_AFTER_HANDOVER',
    );
    expect(
      refundCaseOf({ bookingStatus: 'CANCELLED', handedOver: false, stopStatus: 'CANCELLED' }),
    ).toBe('CANCELLED_BEFORE_HANDOVER');
    expect(
      refundCaseOf({ bookingStatus: 'CANCELLED', handedOver: true, stopStatus: 'DELIVERED' }),
    ).toBe('CANCELLED_AFTER_HANDOVER');
    expect(
      refundCaseOf({ bookingStatus: 'COMPLETED', handedOver: false, stopStatus: 'UNDELIVERED' }),
    ).toBe('UNDELIVERED_DROP');
    expect(
      refundCaseOf({ bookingStatus: 'CANCELLED', handedOver: false, stopStatus: 'UNDELIVERED' }),
    ).toBe('UNDELIVERED_DROP');
    expect(
      refundCaseOf({ bookingStatus: 'COMPLETED', handedOver: true, stopStatus: 'DELIVERED' }),
    ).toBe('COMPLETED_BOOKING');
    expect(refundCaseOf({ bookingStatus: 'COMPLETED', handedOver: true, stopStatus: null })).toBe(
      'COMPLETED_BOOKING',
    );
  });
});

describe('resolveRefundAmount', () => {
  it('refunds everything left of the source when partial refunds are off (the default)', () => {
    expect(
      resolveRefundAmount({
        refundablePaise: 45_000n,
        requestedPaise: null,
        partialAllowed: false,
      }),
    ).toEqual({ ok: true, amountPaise: 45_000n });
    // Confirming the full amount is fine; any other amount is refused, never adjusted.
    expect(
      resolveRefundAmount({
        refundablePaise: 45_000n,
        requestedPaise: 45_000n,
        partialAllowed: false,
      }),
    ).toEqual({ ok: true, amountPaise: 45_000n });
    expect(
      resolveRefundAmount({
        refundablePaise: 45_000n,
        requestedPaise: 10_000n,
        partialAllowed: false,
      }),
    ).toEqual({ ok: false, reason: 'PARTIAL_NOT_ALLOWED' });
  });

  it('allows 1 paisa up to what is left when partial refunds are on', () => {
    expect(
      resolveRefundAmount({ refundablePaise: 45_000n, requestedPaise: 1n, partialAllowed: true }),
    ).toEqual({ ok: true, amountPaise: 1n });
    expect(
      resolveRefundAmount({ refundablePaise: 45_000n, requestedPaise: null, partialAllowed: true }),
    ).toEqual({ ok: true, amountPaise: 45_000n });
  });

  it('never refunds more than is left, or anything once nothing is', () => {
    for (const partialAllowed of [true, false]) {
      expect(
        resolveRefundAmount({ refundablePaise: 45_000n, requestedPaise: 45_001n, partialAllowed }),
      ).toEqual({ ok: false, reason: 'TOO_MUCH' });
      expect(
        resolveRefundAmount({ refundablePaise: 45_000n, requestedPaise: 0n, partialAllowed }),
      ).toEqual({ ok: false, reason: 'TOO_MUCH' });
      expect(
        resolveRefundAmount({ refundablePaise: 0n, requestedPaise: null, partialAllowed }),
      ).toEqual({ ok: false, reason: 'NOTHING_LEFT' });
      expect(
        resolveRefundAmount({ refundablePaise: 0n, requestedPaise: 100n, partialAllowed }),
      ).toEqual({ ok: false, reason: 'NOTHING_LEFT' });
    }
  });
});

describe('provider refund states', () => {
  it('maps Razorpay statuses, treating unknown ones as still processing', () => {
    expect(refundStatusForProvider('pending')).toBe('PROCESSING');
    expect(refundStatusForProvider('processed')).toBe('COMPLETED');
    expect(refundStatusForProvider('failed')).toBe('FAILED');
    expect(refundStatusForProvider('something_new')).toBe('PROCESSING');
  });

  it('moves forward only; closed refunds the provider reports anyway are conflicts', () => {
    expect(refundMove('PENDING', 'PROCESSING')).toBe('APPLY');
    expect(refundMove('PENDING', 'COMPLETED')).toBe('APPLY');
    expect(refundMove('PENDING', 'FAILED')).toBe('APPLY');
    expect(refundMove('PROCESSING', 'PROCESSING')).toBe('ALREADY_APPLIED');
    expect(refundMove('PROCESSING', 'COMPLETED')).toBe('APPLY');
    expect(refundMove('PROCESSING', 'FAILED')).toBe('APPLY');
    expect(refundMove('COMPLETED', 'COMPLETED')).toBe('ALREADY_APPLIED');
    expect(refundMove('COMPLETED', 'PROCESSING')).toBe('STALE');
    expect(refundMove('COMPLETED', 'FAILED')).toBe('CONFLICT');
    expect(refundMove('FAILED', 'FAILED')).toBe('ALREADY_APPLIED');
    expect(refundMove('FAILED', 'PROCESSING')).toBe('STALE');
    expect(refundMove('FAILED', 'COMPLETED')).toBe('CONFLICT');
    for (const target of ['PROCESSING', 'COMPLETED', 'FAILED'] as const) {
      expect(refundMove('REFUSED', target)).toBe('CONFLICT');
      expect(refundMove('CANCELLED', target)).toBe('CONFLICT');
    }
  });
});
