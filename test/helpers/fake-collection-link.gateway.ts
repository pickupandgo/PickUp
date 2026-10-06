import {
  CollectionLinkGateway,
  type CollectionLinkPayment,
  type CollectionLinkState,
  type CollectionLinkStatus,
  type CollectionProduct,
  type CreateCollectionLinkInput,
} from '../../src/collections/collection-link.gateway';
import { RazorpayApiError, RazorpayUnavailableError } from '../../src/razorpay/razorpay.errors';
import { newId } from './fake-razorpay.gateway';

interface StoredLink {
  product: CollectionProduct;
  referenceId: string;
  collectionId: string;
  bookingId: string;
  amount: number;
  status: CollectionLinkStatus;
  url: string;
  expiresAt: Date;
  orderId: string | null;
  payments: CollectionLinkPayment[];
}

export interface CollectionPayOptions {
  readonly amount?: number;
  readonly method?: string;
}

/**
 * In-memory Razorpay Payment Links / QR Codes with the documented behaviours: fixed amount,
 * cancel refuses a paid link and returns its state, only captured payments are listed.
 */
export class FakeCollectionLinkGateway extends CollectionLinkGateway {
  readonly links = new Map<string, StoredLink>();
  readonly calls = { create: 0, fetch: 0, cancel: 0, findQrCodeIdByPayment: 0 };
  unavailable = false;

  create(
    product: CollectionProduct,
    input: CreateCollectionLinkInput,
  ): Promise<CollectionLinkState> {
    this.calls.create += 1;
    return this.run(() => {
      const referenceId = newId(product === 'PAYMENT_LINK' ? 'plink_' : 'qr_');
      const link: StoredLink = {
        product,
        referenceId,
        collectionId: input.collectionId,
        bookingId: input.bookingId,
        amount: input.amountPaise,
        status: 'ACTIVE',
        url:
          product === 'PAYMENT_LINK'
            ? `https://rzp.io/i/${referenceId.slice(6, 14)}`
            : `https://rzp.io/qr/${referenceId}.png`,
        expiresAt: input.expiresAt,
        orderId: product === 'PAYMENT_LINK' ? newId('order_') : null,
        payments: [],
      };
      this.links.set(referenceId, link);
      return toState(link);
    });
  }

  fetch(_product: CollectionProduct, referenceId: string): Promise<CollectionLinkState> {
    this.calls.fetch += 1;
    return this.run(() => toState(this.require(referenceId)));
  }

  cancel(_product: CollectionProduct, referenceId: string): Promise<CollectionLinkState> {
    this.calls.cancel += 1;
    return this.run(() => {
      const link = this.require(referenceId);
      if (link.status === 'ACTIVE') {
        link.status = 'CANCELLED';
      }
      return toState(link);
    });
  }

  findQrCodeIdByPayment(paymentId: string): Promise<string | null> {
    this.calls.findQrCodeIdByPayment += 1;
    return this.run(() => {
      const link = [...this.links.values()].find(
        (candidate) =>
          candidate.product === 'QR_CODE' &&
          candidate.payments.some((payment) => payment.id === paymentId),
      );
      return link?.referenceId ?? null;
    });
  }

  /** Simulates the customer paying the QR / link. */
  pay(referenceId: string, options: CollectionPayOptions = {}): CollectionLinkPayment {
    const link = this.require(referenceId);
    const payment: CollectionLinkPayment = {
      id: newId('pay_'),
      amount: options.amount ?? link.amount,
      currency: 'INR',
      status: 'captured',
      method: options.method ?? 'upi',
      orderId: link.orderId,
    };
    link.payments.push(payment);
    link.status = payment.amount >= link.amount ? 'PAID' : 'PARTIALLY_PAID';
    return { ...payment };
  }

  expire(referenceId: string): void {
    const link = this.require(referenceId);
    if (link.status === 'ACTIVE') {
      link.status = 'EXPIRED';
    }
  }

  byCollection(collectionId: string): StoredLink {
    const link = [...this.links.values()].find(
      (candidate) => candidate.collectionId === collectionId,
    );
    if (!link) {
      throw new Error(`No fake link for collection ${collectionId}`);
    }
    return link;
  }

  private require(referenceId: string): StoredLink {
    const link = this.links.get(referenceId);
    if (!link) {
      throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
    }
    return link;
  }

  private run<T>(work: () => T): Promise<T> {
    if (this.unavailable) {
      return Promise.reject(new RazorpayUnavailableError('simulated outage'));
    }
    try {
      return Promise.resolve(work());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function toState(link: StoredLink): CollectionLinkState {
  return {
    product: link.product,
    referenceId: link.referenceId,
    status: link.status,
    url: link.url,
    amountPaise: link.amount,
    currency: 'INR',
    expiresAt: link.expiresAt,
    orderId: link.orderId,
    payments: link.payments.map((payment) => ({ ...payment })),
  };
}
