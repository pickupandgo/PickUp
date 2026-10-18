import {
  critical,
  detected,
  FINDING_CATEGORIES,
  firstUuid,
  info,
  kindPart,
  uniqueFindings,
  warning,
  webhookOutcomeSpec,
} from './finding-types';

const BOOKING = '3f1e2d4c-5b6a-4789-8abc-def012345678';
const DRIVER = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';

describe('detected', () => {
  it('identifies a condition by its kind and the records involved', () => {
    const finding = detected({
      ...critical('PAYOUT_MISMATCH'),
      kind: 'PAYOUT_STATUS_CONFLICT',
      source: 'PROVIDER',
      entityType: 'DRIVER_PAYOUT',
      entityId: 'payout-1',
      providerRef: 'pout_123',
      internalAmountPaise: 15_000,
      providerAmountPaise: 15_000n,
    });
    expect(finding.fingerprint).toBe('PAYOUT_STATUS_CONFLICT|DRIVER_PAYOUT|payout-1|pout_123');
    expect(finding).toMatchObject({
      category: 'PAYOUT_MISMATCH',
      severity: 'CRITICAL',
      source: 'PROVIDER',
      internalAmountPaise: 15_000n,
      providerAmountPaise: 15_000n,
      bookingId: null,
      refs: {},
    });
  });

  it('uses an explicit identity, so details and amounts never split one condition in two', () => {
    const seen = (detail: string, amount: number) =>
      detected({
        ...warning('STALE_PENDING'),
        kind: 'STALE_PENDING_REFUND',
        source: 'DATABASE',
        entityType: 'BOOKING',
        entityId: BOOKING,
        detail,
        internalAmountPaise: amount,
        identity: [BOOKING, null, undefined, 'refund-7'],
      });
    const first = seen('refund refund-7, 1 attempt(s)', 100);
    const later = seen('refund refund-7, 4 attempt(s)', 250);
    expect(first.fingerprint).toBe(`STALE_PENDING_REFUND|${BOOKING}|||refund-7`);
    expect(later.fingerprint).toBe(first.fingerprint);
  });

  it('keeps only UUIDs in the booking and driver columns; anything else goes to refs', () => {
    const finding = detected({
      ...info('PROVIDER_EVENT_ANOMALY'),
      kind: 'PROVIDER_LOOKUP_FAILED',
      source: 'PROVIDER',
      bookingId: 'TAB-QR-001',
      driverId: DRIVER,
      refs: { eventId: 'evt_1', empty: '', missing: null, absent: undefined },
    });
    expect(finding.bookingId).toBeNull();
    expect(finding.driverId).toBe(DRIVER.toLowerCase());
    expect(finding.refs).toEqual({ eventId: 'evt_1', bookingId: 'TAB-QR-001' });
  });

  it('caps every value to its column', () => {
    const finding = detected({
      ...critical('WALLET_MISMATCH'),
      kind: 'WALLET_BALANCE_NOT_LEDGER',
      source: 'DATABASE',
      entityType: 'E'.repeat(60),
      entityId: 'i'.repeat(400),
      providerRef: 'p'.repeat(400),
      internalState: 's'.repeat(100),
      providerState: 'S'.repeat(100),
      detail: 'd'.repeat(900),
      refs: { long: 'r'.repeat(400) },
    });
    expect(finding.entityType).toHaveLength(40);
    expect(finding.entityId).toHaveLength(150);
    expect(finding.providerRef).toHaveLength(150);
    expect(finding.internalState).toHaveLength(60);
    expect(finding.providerState).toHaveLength(60);
    expect(finding.detail).toHaveLength(500);
    expect(finding.refs.long).toHaveLength(150);
    expect(finding.fingerprint.length).toBeLessThanOrEqual(300);
  });

  it('treats empty strings as unknown', () => {
    const finding = detected({
      ...info('STALE_PENDING'),
      kind: 'STALE_PENDING_PAYMENT',
      source: 'DATABASE',
      entityType: '',
      detail: '',
      internalState: '',
    });
    expect(finding).toMatchObject({ entityType: null, detail: null, internalState: null });
  });

  it.each(['lowercase', 'A', 'WITH SPACE', 'X'.repeat(61), '1STARTS_WITH_DIGIT'])(
    'refuses the kind %p (the table CHECK would)',
    (kind) => {
      expect(() => detected({ ...info('STALE_PENDING'), kind, source: 'DATABASE' })).toThrow(
        /Invalid finding kind/,
      );
    },
  );
});

describe('uniqueFindings', () => {
  it('keeps the first finding of each fingerprint, in order', () => {
    const make = (kind: string, entityId: string, detail: string) =>
      detected({
        ...warning('STALE_PENDING'),
        kind,
        source: 'DATABASE',
        entityType: 'PAYMENT',
        entityId,
        detail,
      });
    const unique = uniqueFindings([
      make('STALE_PENDING_PAYMENT', 'p1', 'first'),
      make('STALE_PENDING_PAYMENT', 'p2', 'other'),
      make('STALE_PENDING_PAYMENT', 'p1', 'second'),
      make('STALE_PAYMENT_WITHOUT_ORDER', 'p1', 'another kind'),
    ]);
    expect(unique.map((finding) => finding.detail)).toEqual(['first', 'other', 'another kind']);
  });
});

describe('kindPart', () => {
  it('turns a provider code into an UPPER_SNAKE_CASE kind suffix', () => {
    expect(kindPart('REFUND_MISMATCH', 'X')).toBe('REFUND_MISMATCH');
    expect(kindPart('bank validation: conflict!', 'X')).toBe('BANK_VALIDATION_CONFLICT');
    expect(kindPart('__odd__', 'X')).toBe('ODD');
    expect(kindPart(null, 'PROBLEM')).toBe('PROBLEM');
    expect(kindPart('***', 'PROBLEM')).toBe('PROBLEM');
    expect(kindPart('A'.repeat(80), 'X')).toHaveLength(40);
  });
});

describe('firstUuid', () => {
  it('finds the first id in a report detail', () => {
    expect(firstUuid(`refund ${BOOKING.toUpperCase()}, 2 attempt(s), last never`)).toBe(BOOKING);
    expect(firstUuid('booking fare 15000')).toBeNull();
    expect(firstUuid(null)).toBeNull();
  });
});

describe('webhookOutcomeSpec', () => {
  it.each([
    // Money reached Razorpay and nothing of ours applied it.
    [
      'RAZORPAY',
      'AMOUNT_MISMATCH',
      'payment.captured',
      'PROVIDER_PAID_INTERNAL_PENDING',
      'CRITICAL',
    ],
    ['RAZORPAY', 'UNKNOWN_ORDER', 'payment.captured', 'PROVIDER_PAID_INTERNAL_PENDING', 'CRITICAL'],
    [
      'RAZORPAY',
      'MISSING_ORDER_ID',
      'payment.captured',
      'PROVIDER_PAID_INTERNAL_PENDING',
      'CRITICAL',
    ],
    ['RAZORPAY', 'PAYMENT_NOT_PENDING', 'order.paid', 'PROVIDER_PAID_INTERNAL_PENDING', 'CRITICAL'],
    [
      'RAZORPAY',
      'UNKNOWN_COLLECTION',
      'qr_code.credited',
      'PROVIDER_PAID_INTERNAL_PENDING',
      'CRITICAL',
    ],
    ['RAZORPAY', 'UNKNOWN_COLLECTION', 'qr_code.closed', 'PROVIDER_EVENT_ANOMALY', 'WARNING'],
    [
      'RAZORPAY',
      'BOOKING_NOT_PAYABLE',
      'payment.authorized',
      'PROVIDER_PAID_INTERNAL_PENDING',
      'WARNING',
    ],
    // Paid twice.
    [
      'RAZORPAY',
      'DUPLICATE_ORDER_PAYMENT',
      'payment.captured',
      'DUPLICATE_PROVIDER_EVENT',
      'CRITICAL',
    ],
    [
      'RAZORPAY',
      'DUPLICATE_BOOKING_PAYMENT',
      'payment.captured',
      'DUPLICATE_PROVIDER_EVENT',
      'CRITICAL',
    ],
    // Recorded as paid; waits for a refund decision.
    ['RAZORPAY', 'PAID_AFTER_CANCELLATION', 'qr_code.credited', 'REFUND_MISMATCH', 'WARNING'],
    ['RAZORPAY', 'PAID_FOR_CLOSED_DROP', 'qr_code.credited', 'REFUND_MISMATCH', 'WARNING'],
    // Held as paid, disputed or refunded at Razorpay.
    [
      'RAZORPAY',
      'DISPUTE_RECORDED',
      'payment.dispute.created',
      'INTERNAL_PAID_PROVIDER_NOT_PAID',
      'CRITICAL',
    ],
    [
      'RAZORPAY',
      'REFUND_UNKNOWN',
      'refund.processed',
      'INTERNAL_PAID_PROVIDER_NOT_PAID',
      'CRITICAL',
    ],
    ['RAZORPAY', 'REFUND_MISMATCH', 'refund.processed', 'REFUND_MISMATCH', 'CRITICAL'],
    ['RAZORPAY', 'REFUND_CONFLICTING_STATE', 'refund.failed', 'REFUND_MISMATCH', 'CRITICAL'],
    // Nothing assumed about money.
    ['RAZORPAY', 'UNSUPPORTED_PAYLOAD', 'payment.captured', 'PROVIDER_EVENT_ANOMALY', 'WARNING'],
    ['RAZORPAY', null, 'payment.captured', 'PROVIDER_EVENT_ANOMALY', 'WARNING'],
    ['RAZORPAYX', 'MISMATCH', 'payout.processed', 'PAYOUT_MISMATCH', 'CRITICAL'],
    ['RAZORPAYX', 'CONFLICTING_STATE', 'payout.processed', 'PAYOUT_MISMATCH', 'CRITICAL'],
    ['RAZORPAYX', 'UNKNOWN_PAYOUT', 'payout.processed', 'PAYOUT_MISMATCH', 'CRITICAL'],
    [
      'RAZORPAYX',
      'BANK_VALIDATION_CONFLICT',
      'fund_account.validation.completed',
      'PROVIDER_EVENT_ANOMALY',
      'WARNING',
    ],
    ['RAZORPAYX', 'UNSUPPORTED_PAYLOAD', 'payout.failed', 'PROVIDER_EVENT_ANOMALY', 'WARNING'],
  ] as const)('%s %s on %s is %s / %s', (source, outcome, eventType, category, severity) => {
    expect(webhookOutcomeSpec(source, outcome, eventType)).toEqual({ category, severity });
  });

  it('only ever names a valid category', () => {
    for (const outcome of ['AMOUNT_MISMATCH', 'REFUND_UNKNOWN', 'ANYTHING_ELSE', null]) {
      for (const source of ['RAZORPAY', 'RAZORPAYX'] as const) {
        expect(FINDING_CATEGORIES).toContain(
          webhookOutcomeSpec(source, outcome, 'payment.captured').category,
        );
      }
    }
  });
});
