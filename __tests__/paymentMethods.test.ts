/**
 * Review H / I.11: exactly two payment options, with the exact copy, and no prepaid / pay-now.
 */
import { PAYMENT_METHOD_OPTIONS } from '../src/data/paymentMethods';

describe('customer payment options', () => {
  it('offers exactly two options', () => {
    expect(PAYMENT_METHOD_OPTIONS).toHaveLength(2);
    expect(PAYMENT_METHOD_OPTIONS.map((o) => o.id)).toEqual(['PAY_AT_PICKUP', 'PAY_AT_DELIVERY']);
  });

  it('uses the exact contract copy', () => {
    const [pickup, delivery] = PAYMENT_METHOD_OPTIONS;
    expect(pickup).toMatchObject({
      id: 'PAY_AT_PICKUP',
      label: 'PAY AT PICKUP',
      description: 'Pay when the driver arrives at your pickup location.',
    });
    expect(delivery).toMatchObject({
      id: 'PAY_AT_DELIVERY',
      label: 'PAY AT DELIVERY',
      description: 'Receiver pays when the driver arrives at the delivery location.',
    });
  });

  it('never offers a prepaid / pay-now option', () => {
    const ids = PAYMENT_METHOD_OPTIONS.map((o) => o.id as string);
    for (const banned of ['PREPAID_UPI', 'PREPAID', 'PAY_NOW', 'UPI', 'COD', 'CARD']) {
      expect(ids).not.toContain(banned);
    }
  });
});
