import { CheckoutError } from '../src/services/payments/checkoutErrors';
import type {
  CheckoutDto,
  PaymentsApi,
  TopUpDto,
  VerifyTopUpDto,
} from '../src/services/payments/paymentsApi';
import { PaymentsApiError } from '../src/services/payments/paymentsErrors';
import {
  runTopUp,
  type CheckoutSuccess,
  type TopUpFlowDeps,
  type TopUpPhase,
} from '../src/services/payments/topUpFlow';

const AMOUNT = 50_000;
const KEY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PAYMENT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ORDER_ID = 'order_ABCdef123456';

const CHECKOUT: CheckoutDto = {
  keyId: 'rzp_test_AbCdEf123456',
  orderId: ORDER_ID,
  amountPaise: AMOUNT,
  currency: 'INR',
};

const CHECKOUT_SUCCESS: CheckoutSuccess = {
  razorpay_payment_id: 'pay_ABCdef123456',
  razorpay_order_id: ORDER_ID,
  razorpay_signature: 'b'.repeat(64),
};

function topUp(status: TopUpDto['status'], amountPaise = AMOUNT): TopUpDto {
  return {
    paymentId: PAYMENT_ID,
    status,
    amountPaise,
    checkout: status === 'PENDING' ? { ...CHECKOUT, amountPaise } : null,
  };
}

function verified(
  status: TopUpDto['status'],
  balancePaise?: number,
): VerifyTopUpDto {
  return {
    payment: topUp(status),
    providerStatus: status === 'PAID' ? 'captured' : 'authorized',
    wallet:
      balancePaise === undefined
        ? null
        : {
            walletId: 'w1',
            status: 'ACTIVE',
            balancePaise,
            updatedAt: '2026-10-02T10:00:00Z',
          },
  };
}

type Api = TopUpFlowDeps['api'];

interface Harness {
  readonly api: { [K in keyof Api]: jest.Mock };
  readonly openCheckout: jest.Mock<Promise<CheckoutSuccess>, [CheckoutDto]>;
  readonly phases: TopUpPhase[];
  readonly deps: TopUpFlowDeps;
}

function harness(overrides: Partial<TopUpFlowDeps> = {}): Harness {
  const api = {
    startTopUp: jest.fn<
      ReturnType<PaymentsApi['startTopUp']>,
      [number, string]
    >(async () => topUp('PENDING')),
    getTopUp: jest.fn<ReturnType<PaymentsApi['getTopUp']>, [string]>(async () =>
      topUp('PENDING'),
    ),
    verifyTopUp: jest.fn<
      ReturnType<PaymentsApi['verifyTopUp']>,
      [string, unknown]
    >(async () => verified('PAID', 150_000)),
  };
  const openCheckout = jest.fn<Promise<CheckoutSuccess>, [CheckoutDto]>(
    async () => CHECKOUT_SUCCESS,
  );
  const phases: TopUpPhase[] = [];
  const deps: TopUpFlowDeps = {
    api: api as unknown as Api,
    openCheckout,
    onPhase: phase => phases.push(phase),
    sleep: async () => undefined,
    pollIntervalMs: 0,
    pollAttempts: 3,
    interruptedPollAttempts: 2,
    ...overrides,
  };
  return { api, openCheckout, phases, deps };
}

describe('runTopUp', () => {
  it('credits the wallet when Checkout succeeds and the server verifies the payment', async () => {
    const h = harness();

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toEqual({
      kind: 'success',
      amountPaise: AMOUNT,
      paymentId: PAYMENT_ID,
      balancePaise: 150_000,
    });
    expect(h.api.startTopUp).toHaveBeenCalledWith(AMOUNT, KEY);
    expect(h.openCheckout).toHaveBeenCalledWith(CHECKOUT);
    expect(h.api.verifyTopUp).toHaveBeenCalledWith(PAYMENT_ID, {
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: 'pay_ABCdef123456',
      razorpaySignature: 'b'.repeat(64),
    });
    expect(h.phases).toEqual([
      'CREATING_ORDER',
      'AWAITING_PAYMENT',
      'CONFIRMING',
    ]);
  });

  it('reports success without charging again when the attempt was already paid', async () => {
    const h = harness();
    h.api.startTopUp.mockResolvedValue(topUp('PAID'));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome.kind).toBe('success');
    expect(h.openCheckout).not.toHaveBeenCalled();
  });

  it('never opens Checkout for an amount the driver did not confirm', async () => {
    const h = harness();
    h.api.startTopUp.mockResolvedValue(topUp('PENDING', AMOUNT + 100));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toMatchObject({ kind: 'failed', paymentAttempted: false });
    expect(h.openCheckout).not.toHaveBeenCalled();
  });

  it('explains why the server refused to start the payment', async () => {
    const h = harness();
    h.api.startTopUp.mockRejectedValue(
      new PaymentsApiError('DRIVER_NOT_APPROVED', 'x', 403, 'req-7'),
    );

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toEqual({
      kind: 'failed',
      amountPaise: AMOUNT,
      paymentId: undefined,
      message: 'Your driver account must be approved before you can add money.',
      requestId: 'req-7',
      paymentAttempted: false,
    });
    expect(h.openCheckout).not.toHaveBeenCalled();
  });

  it('does not open Checkout if the screen was closed while the order was created', async () => {
    const h = harness({ isAbandoned: () => true });

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome.kind).toBe('cancelled');
    expect(h.openCheckout).not.toHaveBeenCalled();
  });

  it('reports a cancel after checking the server', async () => {
    const h = harness();
    h.openCheckout.mockRejectedValue(new CheckoutError('cancelled', 0));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toEqual({
      kind: 'cancelled',
      amountPaise: AMOUNT,
      paymentId: PAYMENT_ID,
    });
    expect(h.api.getTopUp).toHaveBeenCalledWith(PAYMENT_ID);
  });

  it('trusts the server over a Checkout error when the payment went through', async () => {
    const h = harness();
    h.openCheckout.mockRejectedValue(new CheckoutError('cancelled', 0));
    h.api.getTopUp.mockResolvedValue(topUp('PAID'));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome.kind).toBe('success');
  });

  it('reports a declined payment as failed, noting that money may have moved', async () => {
    const h = harness();
    h.openCheckout.mockRejectedValue(new CheckoutError('failed', 3));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toMatchObject({ kind: 'failed', paymentAttempted: true });
  });

  it('waits for the server after Checkout lost its connection', async () => {
    const h = harness();
    h.openCheckout.mockRejectedValue(new CheckoutError('network', 2));
    h.api.getTopUp
      .mockResolvedValueOnce(topUp('PENDING'))
      .mockResolvedValueOnce(topUp('PAID'));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome.kind).toBe('success');
    expect(h.api.getTopUp).toHaveBeenCalledTimes(2);
    expect(h.phases).toContain('WAITING_FOR_BANK');
  });

  it('reports an interrupted payment when the server never settles it', async () => {
    const h = harness();
    h.openCheckout.mockRejectedValue(new CheckoutError('network', 2));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toMatchObject({
      kind: 'failed',
      paymentAttempted: true,
      message: 'The payment was interrupted by a network problem.',
    });
    expect(h.api.getTopUp).toHaveBeenCalledTimes(2);
  });

  it('reports that Checkout could not open without claiming money moved', async () => {
    const h = harness();
    h.openCheckout.mockRejectedValue(new CheckoutError('unavailable'));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toMatchObject({ kind: 'failed', paymentAttempted: false });
    expect(h.api.getTopUp).not.toHaveBeenCalled();
  });

  it('polls when verification says the payment is not captured yet', async () => {
    const h = harness();
    h.api.verifyTopUp.mockResolvedValue(verified('PENDING'));
    h.api.getTopUp
      .mockResolvedValueOnce(topUp('PENDING'))
      .mockResolvedValueOnce(topUp('PAID'));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toEqual({
      kind: 'success',
      amountPaise: AMOUNT,
      paymentId: PAYMENT_ID,
      balancePaise: null,
    });
    expect(h.phases).toEqual([
      'CREATING_ORDER',
      'AWAITING_PAYMENT',
      'CONFIRMING',
      'WAITING_FOR_BANK',
    ]);
  });

  it('stops at a final verification rejection', async () => {
    const h = harness();
    h.api.verifyTopUp.mockRejectedValue(
      new PaymentsApiError('PAYMENT_VERIFICATION_FAILED', 'x', 409, 'req-9'),
    );

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome).toMatchObject({
      kind: 'failed',
      requestId: 'req-9',
      paymentAttempted: true,
    });
    expect(h.api.getTopUp).not.toHaveBeenCalled();
  });

  it.each([
    ['network', new PaymentsApiError('NETWORK_ERROR', 'x', 0)],
    ['sign-in', new PaymentsApiError('AUTH_INVALID_TOKEN', 'x', 401)],
    ['server', new PaymentsApiError('INTERNAL_ERROR', 'x', 500)],
  ])(
    'never reports a %s failure after payment as failed: it waits, then says pending',
    async (_label, error) => {
      const h = harness();
      h.api.verifyTopUp.mockRejectedValue(error);

      const outcome = await runTopUp(AMOUNT, KEY, h.deps);

      expect(outcome).toEqual({
        kind: 'pending',
        amountPaise: AMOUNT,
        paymentId: PAYMENT_ID,
      });
      expect(h.api.getTopUp).toHaveBeenCalledTimes(3);
    },
  );

  it('does not trust an incomplete Checkout result and asks the server instead', async () => {
    const h = harness();
    h.openCheckout.mockResolvedValue({
      razorpay_payment_id: 'pay_ABCdef123456',
    });
    h.api.getTopUp.mockResolvedValue(topUp('PAID'));

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome.kind).toBe('success');
    expect(h.api.verifyTopUp).not.toHaveBeenCalled();
  });

  it('ignores a Checkout result for a different order', async () => {
    const h = harness();
    h.openCheckout.mockResolvedValue({
      ...CHECKOUT_SUCCESS,
      razorpay_order_id: 'order_OTHER12345',
    });

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(h.api.verifyTopUp).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('pending');
  });

  it('stops waiting when the screen is closed', async () => {
    let closed = false;
    const h = harness({ isAbandoned: () => closed, pollAttempts: 20 });
    h.api.verifyTopUp.mockResolvedValue(verified('PENDING'));
    h.api.getTopUp.mockImplementation(async () => {
      closed = true;
      return topUp('PENDING');
    });

    const outcome = await runTopUp(AMOUNT, KEY, h.deps);

    expect(outcome.kind).toBe('pending');
    expect(h.api.getTopUp).toHaveBeenCalledTimes(1);
  });
});
