import { RazorpayApiError } from '../razorpay/razorpay.errors';
import { razorpayRefundSchema } from '../razorpay/razorpay.types';
import { findOurRefund, toProviderRefund } from './refund.gateway';
import {
  DisabledRefundGateway,
  refundEntity,
  SimulatedRefundGateway,
} from './simulated-refund.gateway';

const input = {
  refundId: '0b6a2b1e-9b3c-4f0e-8f8e-2a6d4c1b7e90',
  providerPaymentId: 'pay_ABCDEFGHIJKLMN',
  amountPaise: 45_000,
  notes: { refund_id: '0b6a2b1e-9b3c-4f0e-8f8e-2a6d4c1b7e90', booking_id: 'booking-1' },
};

describe('SimulatedRefundGateway', () => {
  it('returns the original refund for a repeated idempotency key', async () => {
    const gateway = new SimulatedRefundGateway();
    const first = await gateway.createRefund(input);
    expect(first).toMatchObject({
      paymentId: 'pay_ABCDEFGHIJKLMN',
      amount: 45_000,
      currency: 'INR',
      status: 'pending',
      receipt: input.refundId,
      reference: null,
    });
    expect(first.id).toMatch(/^rfnd_sim[0-9a-f]{14}$/);
    const again = await gateway.createRefund({ ...input, amountPaise: 99 });
    expect(again).toEqual(first);
    await expect(gateway.listPaymentRefunds('pay_ABCDEFGHIJKLMN')).resolves.toHaveLength(1);
    expect(
      findOurRefund(await gateway.listPaymentRefunds('pay_ABCDEFGHIJKLMN'), input.refundId)?.id,
    ).toBe(first.id);
  });

  it('moves a pending refund once, like Razorpay', async () => {
    const gateway = new SimulatedRefundGateway();
    const refund = await gateway.createRefund(input);
    const processed = gateway.setRefundStatus(refund.id, 'processed');
    expect(processed).toMatchObject({ status: 'processed' });
    expect(processed?.reference).toMatch(/^\d{10,11}$/);
    // A finished refund never moves again.
    expect(gateway.setRefundStatus(refund.id, 'failed')).toMatchObject({ status: 'processed' });
    await expect(gateway.fetchRefund(refund.id)).resolves.toMatchObject({ status: 'processed' });
    expect(gateway.setRefundStatus('rfnd_simunknown00', 'processed')).toBeNull();
  });

  it('produces the entity a refund webhook carries, readable as a Razorpay refund', async () => {
    const gateway = new SimulatedRefundGateway();
    const refund = await gateway.createRefund(input);
    const entity = refundEntity(gateway.setRefundStatus(refund.id, 'failed')!);
    const parsed = razorpayRefundSchema.parse(entity);
    expect(toProviderRefund(parsed)).toEqual({ ...refund, status: 'failed', reference: null });
  });

  it('rejects invalid amounts and unknown refunds as Razorpay would', async () => {
    const gateway = new SimulatedRefundGateway();
    await expect(gateway.createRefund({ ...input, amountPaise: 0 })).rejects.toBeInstanceOf(
      RazorpayApiError,
    );
    await expect(gateway.fetchRefund('rfnd_simunknown00')).rejects.toBeInstanceOf(RazorpayApiError);
  });
});

describe('DisabledRefundGateway', () => {
  it('refuses every provider call', async () => {
    const gateway = new DisabledRefundGateway();
    expect(gateway.enabled).toBe(false);
    await expect(gateway.createRefund()).rejects.toMatchObject({
      code: 'REFUND_PROVIDER_NOT_CONFIGURED',
    });
    await expect(gateway.fetchRefund()).rejects.toMatchObject({
      code: 'REFUND_PROVIDER_NOT_CONFIGURED',
    });
    await expect(gateway.listPaymentRefunds()).rejects.toMatchObject({
      code: 'REFUND_PROVIDER_NOT_CONFIGURED',
    });
  });
});
