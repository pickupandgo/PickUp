import { createHmac, timingSafeEqual } from 'node:crypto';

/** Razorpay signatures are lowercase hex HMAC-SHA256 digests (64 characters). */
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

export function hmacSha256Hex(secret: string, message: string | Buffer): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function signaturesMatch(expectedHex: string, providedHex: string): boolean {
  const provided = providedHex.toLowerCase();
  if (!SIGNATURE_PATTERN.test(provided)) {
    return false;
  }
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(provided, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Checkout signature returned to the app after payment:
 * HMAC_SHA256(order_id + "|" + razorpay_payment_id, key_secret).
 * `orderId` must come from our database, never from the client.
 */
export function isValidCheckoutSignature(params: {
  readonly orderId: string;
  readonly paymentId: string;
  readonly signature: string;
  readonly keySecret: string;
}): boolean {
  const expected = hmacSha256Hex(params.keySecret, `${params.orderId}|${params.paymentId}`);
  return signaturesMatch(expected, params.signature);
}

/**
 * Webhook signature (X-Razorpay-Signature): HMAC_SHA256(raw request body, webhook secret).
 * Accepts any configured secret so older events still verify during a secret rotation.
 * Every secret is checked, so timing does not reveal which one matched.
 */
export function isValidWebhookSignature(params: {
  readonly rawBody: Buffer;
  readonly signature: string;
  readonly secrets: readonly string[];
}): boolean {
  let valid = false;
  for (const secret of params.secrets) {
    if (signaturesMatch(hmacSha256Hex(secret, params.rawBody), params.signature)) {
      valid = true;
    }
  }
  return valid;
}
