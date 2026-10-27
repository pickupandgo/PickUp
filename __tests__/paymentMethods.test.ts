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

  it('never offers a prepaid / pay-now / pay-online option', () => {
    const ids = PAYMENT_METHOD_OPTIONS.map((o) => o.id as string);
    for (const banned of ['PREPAID_UPI', 'PREPAID', 'PAY_NOW', 'PAY_ONLINE', 'UPI', 'COD', 'CARD']) {
      expect(ids).not.toContain(banned);
    }
  });

  it('selects PAY_AT_DELIVERY by default in PaymentMethodScreen when no method is in draft', () => {
    const mockSetPaymentMethod = jest.fn();
    const mockContinue = jest.fn();
    jest.spyOn(require('../src/state/BookingContext'), 'useBooking').mockReturnValue({
      draft: { drops: [] },
      setPaymentMethod: mockSetPaymentMethod,
    });

    const React = require('react');
    const TestRenderer = require('react-test-renderer');
    const PaymentMethodScreen = require('../src/screens/payment/PaymentMethodScreen').default;

    let renderer: any;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(React.createElement(PaymentMethodScreen, { onContinue: mockContinue }));
    });

    const root = renderer.root;
    const radios = root.findAll((el: any) => el.props.accessibilityRole === 'radio' && typeof el.props.onPress === 'function');
    expect(radios).toHaveLength(2);

    // PAY_AT_PICKUP should be unselected
    expect(radios[0].props.accessibilityState).toEqual({ selected: false });
    // PAY_AT_DELIVERY should be selected by default
    expect(radios[1].props.accessibilityState).toEqual({ selected: true });
  });
});
