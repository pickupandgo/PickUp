import type { AppConfig } from '../config/app-config';
import { assertNotes, assertPattern, RazorpayHttpClient } from '../razorpay/razorpay-http-client';
import {
  RAZORPAY_PAYMENT_ID_PATTERN,
  RAZORPAY_REFUND_ID_PATTERN,
  razorpayRefundCollectionSchema,
  razorpayRefundSchema,
} from '../razorpay/razorpay.types';
import {
  type CreateRefundInput,
  type ProviderRefund,
  RefundGateway,
  toProviderRefund,
} from './refund.gateway';

/** Our refund ids (UUIDs). Razorpay's receipt allows at most 40 characters. */
const REFUND_KEY_PATTERN = /^[A-Za-z0-9_-]{4,40}$/;
/** Razorpay's maximum page size for a payment's refunds. */
const LIST_COUNT = 100;

/**
 * Razorpay refunds through the documented REST API:
 *   POST /v1/payments/:id/refund   (X-Refund-Idempotency: our refund id)
 *   GET  /v1/refunds/:id
 *   GET  /v1/payments/:id/refunds
 * Every refund carries our refund id as the idempotency key and the receipt, so a retried or
 * duplicated submission returns the original refund instead of refunding twice, and a lost reply
 * can be found again. Speed is `normal` (no instant-refund charges); a faster speed would be a
 * business decision. Responses are validated (zod) before anything uses them.
 */
export class RazorpayRefundHttpGateway extends RefundGateway {
  readonly enabled = true;
  private readonly http: RazorpayHttpClient;

  constructor(config: AppConfig) {
    super();
    this.http = new RazorpayHttpClient({
      keyId: config.razorpay.keyId,
      keySecret: config.razorpay.keySecret,
      baseUrl: config.razorpay.apiBaseUrl,
      timeoutMs: config.razorpay.timeoutMs,
      name: RazorpayRefundHttpGateway.name,
    });
  }

  async createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    assertPattern(input.providerPaymentId, RAZORPAY_PAYMENT_ID_PATTERN, 'payment id');
    assertPattern(input.refundId, REFUND_KEY_PATTERN, 'refund idempotency key');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new RangeError('Refund amount must be a positive whole number of paise');
    }
    assertNotes(input.notes);
    const json = await this.http.request('POST', `/v1/payments/${input.providerPaymentId}/refund`, {
      headers: { 'X-Refund-Idempotency': input.refundId },
      body: {
        amount: input.amountPaise,
        speed: 'normal',
        receipt: input.refundId,
        notes: input.notes,
      },
    });
    return toProviderRefund(this.http.parse(razorpayRefundSchema, json, 'refund'));
  }

  async fetchRefund(providerRefundId: string): Promise<ProviderRefund> {
    assertPattern(providerRefundId, RAZORPAY_REFUND_ID_PATTERN, 'refund id');
    const json = await this.http.request('GET', `/v1/refunds/${providerRefundId}`);
    return toProviderRefund(this.http.parse(razorpayRefundSchema, json, 'refund'));
  }

  async listPaymentRefunds(providerPaymentId: string): Promise<ProviderRefund[]> {
    assertPattern(providerPaymentId, RAZORPAY_PAYMENT_ID_PATTERN, 'payment id');
    const json = await this.http.request('GET', `/v1/payments/${providerPaymentId}/refunds`, {
      query: { count: String(LIST_COUNT) },
    });
    return this.http
      .parse(razorpayRefundCollectionSchema, json, 'refund collection')
      .items.map(toProviderRefund);
  }
}
