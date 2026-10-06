import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { assertNotes, assertPattern, RazorpayHttpClient } from '../razorpay/razorpay-http-client';
import { RazorpayApiError } from '../razorpay/razorpay.errors';
import {
  RAZORPAY_PAYMENT_ID_PATTERN,
  razorpayPaymentCollectionSchema,
  toRazorpayPayment,
} from '../razorpay/razorpay.types';
import {
  CollectionLinkGateway,
  type CollectionLinkPayment,
  type CollectionLinkState,
  type CollectionLinkStatus,
  type CollectionProduct,
  type CreateCollectionLinkInput,
} from './collection-link.gateway';

export const PAYMENT_LINK_ID_PATTERN = /^plink_[A-Za-z0-9]{6,40}$/;
export const QR_CODE_ID_PATTERN = /^qr_[A-Za-z0-9]{6,40}$/;

/** Razorpay sometimes sends empty arrays where it documents objects (PHP serialization). */
const looseNotes = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullish();

const paymentLinkPaymentSchema = z.looseObject({
  payment_id: z.string().regex(RAZORPAY_PAYMENT_ID_PATTERN),
  amount: z.number().int().nonnegative(),
  status: z.string(),
  method: z.string().nullish(),
});

const paymentLinkSchema = z.looseObject({
  id: z.string().regex(PAYMENT_LINK_ID_PATTERN),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.string(),
  short_url: z.string().max(500).nullish(),
  expire_by: z.number().int().nullish(),
  order_id: z.string().nullish(),
  reference_id: z.string().nullish(),
  payments: z.array(paymentLinkPaymentSchema).nullish(),
  notes: looseNotes,
});

const qrCodeSchema = z.looseObject({
  id: z.string().regex(QR_CODE_ID_PATTERN),
  entity: z.literal('qr_code'),
  status: z.string(),
  image_url: z.string().max(500).nullish(),
  close_reason: z.string().nullish(),
  payment_amount: z.number().int().nonnegative().nullish(),
  payments_amount_received: z.number().int().nonnegative().nullish(),
  payments_count_received: z.number().int().nonnegative().nullish(),
  close_by: z.union([z.number().int(), z.string()]).nullish(),
  notes: looseNotes,
});

const qrCodeCollectionSchema = z.looseObject({
  entity: z.literal('collection'),
  items: z.array(z.looseObject({ id: z.string().regex(QR_CODE_ID_PATTERN) })),
});

const PAYMENT_LINK_STATUS: Readonly<Record<string, CollectionLinkStatus>> = {
  created: 'ACTIVE',
  partially_paid: 'PARTIALLY_PAID',
  paid: 'PAID',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
};

/**
 * Booking-linked collection through the documented Razorpay Payment Links and QR Codes APIs,
 * using the merchant's standard API keys. Partial payments are disabled and the amount is fixed
 * by the server, so the customer can only pay exactly the booking's confirmed fare.
 */
@Injectable()
export class RazorpayCollectionHttpGateway extends CollectionLinkGateway {
  private readonly http: RazorpayHttpClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.http = new RazorpayHttpClient({
      keyId: config.razorpay.keyId,
      keySecret: config.razorpay.keySecret,
      baseUrl: config.razorpay.apiBaseUrl,
      timeoutMs: config.razorpay.timeoutMs,
      name: RazorpayCollectionHttpGateway.name,
    });
  }

  async create(
    product: CollectionProduct,
    input: CreateCollectionLinkInput,
  ): Promise<CollectionLinkState> {
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100) {
      throw new RangeError('Collection amount must be at least 100 paise');
    }
    const notes = { collection_id: input.collectionId, booking_id: input.bookingId };
    assertNotes(notes);
    const expireBy = Math.floor(input.expiresAt.getTime() / 1000);
    const description = input.description.slice(0, 255);

    if (product === 'PAYMENT_LINK') {
      const json = await this.http.request('POST', '/v1/payment_links', {
        body: {
          amount: input.amountPaise,
          currency: 'INR',
          accept_partial: false,
          reference_id: input.collectionId,
          description,
          expire_by: expireBy,
          reminder_enable: false,
          notify: { sms: false, email: false },
          notes,
        },
      });
      return this.toPaymentLinkState(this.http.parse(paymentLinkSchema, json, 'payment link'));
    }

    const json = await this.http.request('POST', '/v1/payments/qr_codes', {
      body: {
        type: 'upi_qr',
        name: 'PickUp booking',
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: input.amountPaise,
        description,
        close_by: expireBy,
        notes,
      },
    });
    return this.toQrCodeState(this.http.parse(qrCodeSchema, json, 'QR code'));
  }

  async fetch(product: CollectionProduct, referenceId: string): Promise<CollectionLinkState> {
    if (product === 'PAYMENT_LINK') {
      assertPattern(referenceId, PAYMENT_LINK_ID_PATTERN, 'payment link id');
      const json = await this.http.request('GET', `/v1/payment_links/${referenceId}`);
      return this.toPaymentLinkState(this.http.parse(paymentLinkSchema, json, 'payment link'));
    }
    assertPattern(referenceId, QR_CODE_ID_PATTERN, 'QR code id');
    const json = await this.http.request('GET', `/v1/payments/qr_codes/${referenceId}`);
    return this.toQrCodeState(this.http.parse(qrCodeSchema, json, 'QR code'));
  }

  async cancel(product: CollectionProduct, referenceId: string): Promise<CollectionLinkState> {
    const path =
      product === 'PAYMENT_LINK'
        ? `/v1/payment_links/${referenceId}/cancel`
        : `/v1/payments/qr_codes/${referenceId}/close`;
    assertPattern(
      referenceId,
      product === 'PAYMENT_LINK' ? PAYMENT_LINK_ID_PATTERN : QR_CODE_ID_PATTERN,
      'collection id',
    );
    try {
      const json = await this.http.request('POST', path);
      return product === 'PAYMENT_LINK'
        ? this.toPaymentLinkState(this.http.parse(paymentLinkSchema, json, 'payment link'))
        : this.toQrCodeState(this.http.parse(qrCodeSchema, json, 'QR code'));
    } catch (error) {
      // 400: already paid, expired or cancelled. The current state is the answer.
      if (error instanceof RazorpayApiError && error.httpStatus === 400) {
        return this.fetch(product, referenceId);
      }
      throw error;
    }
  }

  async findQrCodeIdByPayment(paymentId: string): Promise<string | null> {
    assertPattern(paymentId, RAZORPAY_PAYMENT_ID_PATTERN, 'payment id');
    const json = await this.http.request('GET', '/v1/payments/qr_codes', {
      query: { payment_id: paymentId },
    });
    const collection = this.http.parse(qrCodeCollectionSchema, json, 'QR code collection');
    return collection.items[0]?.id ?? null;
  }

  private toPaymentLinkState(link: z.infer<typeof paymentLinkSchema>): CollectionLinkState {
    const orderId = link.order_id ? link.order_id : null;
    const payments: CollectionLinkPayment[] = (link.payments ?? []).map((payment) => ({
      id: payment.payment_id,
      amount: payment.amount,
      currency: link.currency,
      status: payment.status,
      method: payment.method ?? null,
      orderId,
    }));
    return {
      product: 'PAYMENT_LINK',
      referenceId: link.id,
      status: PAYMENT_LINK_STATUS[link.status] ?? 'ACTIVE',
      url: link.short_url?.startsWith('https://') ? link.short_url : null,
      amountPaise: link.amount,
      currency: link.currency,
      expiresAt: link.expire_by ? new Date(link.expire_by * 1000) : null,
      orderId,
      payments,
    };
  }

  private async toQrCodeState(qr: z.infer<typeof qrCodeSchema>): Promise<CollectionLinkState> {
    const received = qr.payments_count_received ?? 0;
    let status: CollectionLinkStatus;
    if (received > 0) {
      status =
        (qr.payments_amount_received ?? 0) >= (qr.payment_amount ?? 0) ? 'PAID' : 'PARTIALLY_PAID';
    } else if (qr.status === 'closed') {
      status = qr.close_reason === 'on_demand' ? 'CANCELLED' : 'EXPIRED';
    } else {
      status = 'ACTIVE';
    }

    let payments: CollectionLinkPayment[] = [];
    if (received > 0) {
      const json = await this.http.request('GET', `/v1/payments/qr_codes/${qr.id}/payments`, {
        query: { count: '10' },
      });
      payments = this.http
        .parse(razorpayPaymentCollectionSchema, json, 'QR code payments')
        .items.map(toRazorpayPayment);
    }
    const closeBy =
      typeof qr.close_by === 'string' ? Number.parseInt(qr.close_by, 10) : (qr.close_by ?? null);
    return {
      product: 'QR_CODE',
      referenceId: qr.id,
      status,
      url: qr.image_url?.startsWith('https://') ? qr.image_url : null,
      amountPaise: qr.payment_amount ?? 0,
      currency: 'INR',
      expiresAt: closeBy && Number.isFinite(closeBy) ? new Date(closeBy * 1000) : null,
      orderId: null,
      payments,
    };
  }
}
