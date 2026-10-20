import { RazorpayApiError } from '../razorpay/razorpay.errors';
import { QR_CODE_ID_PATTERN } from './razorpay-collection-http.gateway';
import { SimulatedCollectionLinkGateway } from './simulated-collection-link.gateway';
import type { CreateCollectionLinkInput } from './collection-link.gateway';

const COLLECTION_ID = '0b9d6f5e-5c2a-4c1e-9f57-1d2f3a4b5c6d';
const BOOKING_ID = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function input(overrides: Partial<CreateCollectionLinkInput> = {}): CreateCollectionLinkInput {
  return {
    collectionId: COLLECTION_ID,
    bookingId: BOOKING_ID,
    stage: 'DELIVERY',
    stop: { id: 'stop-2', sequence: 2 },
    amountPaise: 15_000,
    expiresAt: new Date(Date.now() + 30 * 60_000),
    description: 'Drop 2',
    ...overrides,
  };
}

describe('SimulatedCollectionLinkGateway', () => {
  it('makes single-use QR codes that carry the obligation in their notes', async () => {
    const gateway = new SimulatedCollectionLinkGateway();
    const created = await gateway.create('QR_CODE', input());
    expect(created).toMatchObject({ product: 'QR_CODE', status: 'ACTIVE', amountPaise: 15_000 });
    expect(created.referenceId).toMatch(QR_CODE_ID_PATTERN);

    const paid = gateway.pay(created.referenceId);
    expect(paid?.qrCode).toMatchObject({
      id: created.referenceId,
      status: 'closed',
      close_reason: 'paid',
      notes: {
        collection_id: COLLECTION_ID,
        booking_id: BOOKING_ID,
        stage: 'DELIVERY',
        booking_stop_id: 'stop-2',
        stop_sequence: '2',
      },
    });
    expect(paid?.payment).toMatchObject({ amount: 15_000, status: 'captured', method: 'upi' });

    const fetched = await gateway.fetch('QR_CODE', created.referenceId);
    expect(fetched.status).toBe('PAID');
    expect(fetched.payments).toEqual([
      expect.objectContaining({ id: paid?.payment.id, amount: 15_000, status: 'captured' }),
    ]);
    await expect(gateway.findQrCodeIdByPayment(String(paid?.payment.id))).resolves.toBe(
      created.referenceId,
    );

    // Paid once: the QR takes nothing more.
    expect(gateway.pay(created.referenceId)).toBeNull();
  });

  it('leaves pickup QR codes without drop notes and reports short payments as partial', async () => {
    const gateway = new SimulatedCollectionLinkGateway();
    const created = await gateway.create('QR_CODE', input({ stage: 'PICKUP', stop: null }));
    const paid = gateway.pay(created.referenceId, 9_000);
    expect(paid?.qrCode.notes).toEqual({
      collection_id: COLLECTION_ID,
      booking_id: BOOKING_ID,
      stage: 'PICKUP',
    });
    await expect(gateway.fetch('QR_CODE', created.referenceId)).resolves.toMatchObject({
      status: 'PARTIALLY_PAID',
    });
  });

  it('closes QR codes for good and reports expiry', async () => {
    const gateway = new SimulatedCollectionLinkGateway();
    const open = await gateway.create('QR_CODE', input());
    await expect(gateway.cancel('QR_CODE', open.referenceId)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    expect(gateway.pay(open.referenceId)).toBeNull();

    const expired = await gateway.create('QR_CODE', input({ expiresAt: new Date(Date.now() - 1) }));
    await expect(gateway.fetch('QR_CODE', expired.referenceId)).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    expect(gateway.pay(expired.referenceId)).toBeNull();
  });

  it('refuses payment links and unknown QR codes', async () => {
    const gateway = new SimulatedCollectionLinkGateway();
    await expect(gateway.create('PAYMENT_LINK', input())).rejects.toThrow(/QR codes only/);
    await expect(gateway.fetch('QR_CODE', 'qr_unknown12345')).rejects.toBeInstanceOf(
      RazorpayApiError,
    );
    expect(gateway.pay('qr_unknown12345')).toBeNull();
    await expect(gateway.findQrCodeIdByPayment('pay_unknown12345')).resolves.toBeNull();
  });
});
