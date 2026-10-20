import {
  hmacSha256Hex,
  isValidCheckoutSignature,
  isValidWebhookSignature,
} from './razorpay-signatures';

describe('Razorpay signatures', () => {
  const keySecret = 'unit_test_key_secret';
  const orderId = 'order_ABCDEFGHIJKLMN';
  const paymentId = 'pay_ABCDEFGHIJKLMN';
  const checkoutSignature = hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);

  describe('checkout signature', () => {
    it('accepts the signature Razorpay computes for order_id|payment_id', () => {
      expect(
        isValidCheckoutSignature({ orderId, paymentId, signature: checkoutSignature, keySecret }),
      ).toBe(true);
    });

    it('accepts upper-case hex', () => {
      expect(
        isValidCheckoutSignature({
          orderId,
          paymentId,
          signature: checkoutSignature.toUpperCase(),
          keySecret,
        }),
      ).toBe(true);
    });

    it.each([
      ['a different order', { orderId: 'order_ZZZZZZZZZZZZZZ' }],
      ['a different payment', { paymentId: 'pay_ZZZZZZZZZZZZZZ' }],
      ['a different secret', { keySecret: 'another_secret_value' }],
    ])('rejects a signature for %s', (_label, override) => {
      expect(
        isValidCheckoutSignature({
          orderId,
          paymentId,
          signature: checkoutSignature,
          keySecret,
          ...override,
        }),
      ).toBe(false);
    });

    it.each([
      '',
      'zz',
      'not-hex'.repeat(10),
      `${checkoutSignature}00`,
      checkoutSignature.slice(0, 63),
    ])('rejects malformed signature %p without throwing', (signature) => {
      expect(isValidCheckoutSignature({ orderId, paymentId, signature, keySecret })).toBe(false);
    });
  });

  describe('webhook signature', () => {
    const secret = 'unit_test_webhook_secret_0123456789abcdef';
    const previous = 'unit_test_previous_webhook_secret_0123456';
    const rawBody = Buffer.from('{"entity":"event","event":"payment.captured"}');
    const signature = hmacSha256Hex(secret, rawBody);

    it('accepts an HMAC of the exact raw body', () => {
      expect(isValidWebhookSignature({ rawBody, signature, secrets: [secret] })).toBe(true);
    });

    it('rejects a body that changed by a single byte', () => {
      const tampered = Buffer.from(rawBody);
      tampered[tampered.length - 2] = 0x41;
      expect(isValidWebhookSignature({ rawBody: tampered, signature, secrets: [secret] })).toBe(
        false,
      );
    });

    it('rejects a signature made with another secret', () => {
      expect(isValidWebhookSignature({ rawBody, signature, secrets: [previous] })).toBe(false);
    });

    it('accepts the previous secret during a rotation', () => {
      const oldSignature = hmacSha256Hex(previous, rawBody);
      expect(
        isValidWebhookSignature({ rawBody, signature: oldSignature, secrets: [secret, previous] }),
      ).toBe(true);
    });

    it('rejects everything when no secret is configured', () => {
      expect(isValidWebhookSignature({ rawBody, signature, secrets: [] })).toBe(false);
    });
  });
});
