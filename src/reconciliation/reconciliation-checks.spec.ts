import { FINDING_CATEGORIES, FINDING_SEVERITIES } from './finding-types';
import { DATABASE_CHECKS, kindsOf } from './reconciliation-checks.service';

describe('database check catalog', () => {
  it('names every check once', () => {
    const names = DATABASE_CHECKS.map((spec) => spec.check);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every kind to exactly one check, so clearing by kind never crosses checks', () => {
    const owners = new Map<string, string>();
    for (const spec of DATABASE_CHECKS) {
      for (const kind of kindsOf(spec)) {
        expect(owners.get(kind) ?? spec.check).toBe(spec.check);
        owners.set(kind, spec.check);
      }
    }
    expect(owners.size).toBeGreaterThan(50);
  });

  it('only uses kinds, categories and severities the findings table accepts', () => {
    for (const spec of DATABASE_CHECKS) {
      for (const [kind, classified] of [
        ...Object.entries(spec.kinds),
        ['FALLBACK', spec.fallback] as const,
      ]) {
        expect(kind).toMatch(/^[A-Z][A-Z0-9_]{1,59}$/);
        expect(FINDING_CATEGORIES).toContain(classified.category);
        expect(FINDING_SEVERITIES).toContain(classified.severity);
      }
    }
  });

  it('keeps the existing report codes, renaming only the ambiguous REVERSED', () => {
    const kinds = DATABASE_CHECKS.flatMap(kindsOf);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'GROSS_NOT_BOOKING_FARE',
        'COLLECTION_NOT_IN_EARNING',
        'STUCK_SUBMITTING',
        'PAYOUT_REVERSED',
        'PAYOUT_FAILED',
        'REFUNDS_EXCEED_SOURCE',
        'PAID_BOOKING_CANCELLED',
        'FEE_NOT_LEDGER_AMOUNT',
        'PENDING_PAST_EXPIRY',
      ]),
    );
    expect(kinds).not.toContain('REVERSED');
  });

  it('never clears findings of past events (settlement data, duplicate deliveries)', () => {
    const byName = new Map(DATABASE_CHECKS.map((spec) => [spec.check, spec]));
    expect(byName.get('SETTLEMENT_DATA')?.clears).toBe(false);
    expect(byName.get('DUPLICATE_DELIVERIES')?.clears).toBe(false);
    expect(byName.get('WALLET_LEDGER')?.clears).toBe(true);
  });
});
