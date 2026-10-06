import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { assertNotes, assertPattern, RazorpayHttpClient } from './razorpay-http-client';
import { RazorpayGateway } from './razorpay.gateway';
import {
  type CreateOrderInput,
  RAZORPAY_ORDER_ID_PATTERN,
  RAZORPAY_PAYMENT_ID_PATTERN,
  razorpayOrderCollectionSchema,
  razorpayOrderSchema,
  razorpayPaymentCollectionSchema,
  razorpayPaymentSchema,
  type RazorpayOrder,
  type RazorpayPayment,
  toRazorpayOrder,
  toRazorpayPayment,
} from './razorpay.types';

const MAX_RECEIPT_LENGTH = 40;

/** Orders and payments through the documented Razorpay REST API. */
@Injectable()
export class RazorpayHttpGateway extends RazorpayGateway {
  private readonly http: RazorpayHttpClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.http = new RazorpayHttpClient({
      keyId: config.razorpay.keyId,
      keySecret: config.razorpay.keySecret,
      baseUrl: config.razorpay.apiBaseUrl,
      timeoutMs: config.razorpay.timeoutMs,
      name: RazorpayHttpGateway.name,
    });
  }

  async createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new RangeError('Order amount must be a positive integer number of paise');
    }
    if (input.receipt.length === 0 || input.receipt.length > MAX_RECEIPT_LENGTH) {
      throw new RangeError('Order receipt must be 1-40 characters');
    }
    assertNotes(input.notes);

    const json = await this.http.request('POST', '/v1/orders', {
      body: {
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes,
      },
    });
    return toRazorpayOrder(this.http.parse(razorpayOrderSchema, json, 'order'));
  }

  async findOrderByReceipt(receipt: string): Promise<RazorpayOrder | null> {
    if (receipt.length === 0 || receipt.length > MAX_RECEIPT_LENGTH) {
      throw new RangeError('Order receipt must be 1-40 characters');
    }
    const json = await this.http.request('GET', '/v1/orders', { query: { receipt, count: '10' } });
    const collection = this.http.parse(razorpayOrderCollectionSchema, json, 'order collection');
    const match = collection.items.find((order) => order.receipt === receipt);
    return match ? toRazorpayOrder(match) : null;
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    assertPattern(paymentId, RAZORPAY_PAYMENT_ID_PATTERN, 'payment id');
    const json = await this.http.request('GET', `/v1/payments/${paymentId}`);
    return toRazorpayPayment(this.http.parse(razorpayPaymentSchema, json, 'payment'));
  }

  async capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment> {
    assertPattern(paymentId, RAZORPAY_PAYMENT_ID_PATTERN, 'payment id');
    const json = await this.http.request('POST', `/v1/payments/${paymentId}/capture`, {
      body: { amount: amountPaise, currency: 'INR' },
    });
    return toRazorpayPayment(this.http.parse(razorpayPaymentSchema, json, 'payment'));
  }

  async fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
    assertPattern(orderId, RAZORPAY_ORDER_ID_PATTERN, 'order id');
    const json = await this.http.request('GET', `/v1/orders/${orderId}/payments`);
    const collection = this.http.parse(razorpayPaymentCollectionSchema, json, 'payment collection');
    return collection.items.map(toRazorpayPayment);
  }

  async fetchOrder(orderId: string): Promise<RazorpayOrder> {
    assertPattern(orderId, RAZORPAY_ORDER_ID_PATTERN, 'order id');
    const json = await this.http.request('GET', `/v1/orders/${orderId}`);
    return toRazorpayOrder(this.http.parse(razorpayOrderSchema, json, 'order'));
  }
}
