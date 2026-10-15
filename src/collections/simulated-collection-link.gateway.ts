import { randomBytes } from 'node:crypto';
import { RazorpayApiError } from '../razorpay/razorpay.errors';
import {
  CollectionLinkGateway,
  type CollectionLinkPayment,
  type CollectionLinkState,
  type CollectionLinkStatus,
  type CollectionProduct,
  type CreateCollectionLinkInput,
} from './collection-link.gateway';

interface SimulatedQrCode {
  readonly id: string;
  readonly collectionId: string;
  readonly bookingId: string;
  readonly notes: Readonly<Record<string, string>>;
  readonly amountPaise: number;
  readonly expiresAt: Date;
  status: CollectionLinkStatus;
  readonly payments: CollectionLinkPayment[];
}

/** A simulated customer payment, with the Razorpay entities a qr_code.credited webhook carries. */
export interface SimulatedQrPayment {
  readonly qrCode: Record<string, unknown>;
  readonly payment: Record<string, unknown>;
}

/**
 * In-memory stand-in for Razorpay QR Codes (COLLECTION_LINK_PROVIDER=simulated). Razorpay test
 * mode can't pay a QR code, so local end-to-end runs pay one through
 * /v1/dev/simulate/qr-codes/:id/payments and then deliver the signed qr_code.credited webhook;
 * the backend re-reads the QR here, exactly as it would from Razorpay. Fixed amount, single use,
 * closed once paid or cancelled. Only allowed outside production with test keys (config
 * validation).
 */
export class SimulatedCollectionLinkGateway extends CollectionLinkGateway {
  private readonly qrCodes = new Map<string, SimulatedQrCode>();

  create(
    product: CollectionProduct,
    input: CreateCollectionLinkInput,
  ): Promise<CollectionLinkState> {
    if (product !== 'QR_CODE') {
      return Promise.reject(new Error('The simulated collection provider makes QR codes only'));
    }
    const id = simulatedId('qr_sim');
    const qrCode: SimulatedQrCode = {
      id,
      collectionId: input.collectionId,
      bookingId: input.bookingId,
      notes: {
        collection_id: input.collectionId,
        booking_id: input.bookingId,
        stage: input.stage,
        ...(input.stop
          ? { booking_stop_id: input.stop.id, stop_sequence: String(input.stop.sequence) }
          : {}),
      },
      amountPaise: input.amountPaise,
      expiresAt: input.expiresAt,
      status: 'ACTIVE',
      payments: [],
    };
    this.qrCodes.set(id, qrCode);
    return Promise.resolve(toState(qrCode));
  }

  fetch(_product: CollectionProduct, referenceId: string): Promise<CollectionLinkState> {
    return this.run(() => toState(this.require(referenceId)));
  }

  cancel(_product: CollectionProduct, referenceId: string): Promise<CollectionLinkState> {
    return this.run(() => {
      const qrCode = this.require(referenceId);
      if (qrCode.status === 'ACTIVE') {
        qrCode.status = 'CANCELLED';
      }
      return toState(qrCode);
    });
  }

  findQrCodeIdByPayment(paymentId: string): Promise<string | null> {
    const qrCode = [...this.qrCodes.values()].find((candidate) =>
      candidate.payments.some((payment) => payment.id === paymentId),
    );
    return Promise.resolve(qrCode?.id ?? null);
  }

  /**
   * The customer pays a QR (once: a single-use QR that is paid, closed or expired takes nothing
   * more). Returns the qr_code and payment entities of the qr_code.credited webhook Razorpay
   * would send.
   */
  pay(referenceId: string, amountPaise?: number): SimulatedQrPayment | null {
    const qrCode = this.qrCodes.get(referenceId);
    if (!qrCode || toState(qrCode).status !== 'ACTIVE') {
      return null;
    }
    const payment: CollectionLinkPayment = {
      id: simulatedId('pay_sim'),
      amount: amountPaise ?? qrCode.amountPaise,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      orderId: null,
    };
    qrCode.payments.push(payment);
    qrCode.status = payment.amount >= qrCode.amountPaise ? 'PAID' : 'PARTIALLY_PAID';
    const received = qrCode.payments.reduce((sum, candidate) => sum + candidate.amount, 0);
    return {
      qrCode: {
        id: qrCode.id,
        entity: 'qr_code',
        type: 'upi_qr',
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: qrCode.amountPaise,
        payments_amount_received: received,
        payments_count_received: qrCode.payments.length,
        status: 'closed',
        close_reason: 'paid',
        notes: qrCode.notes,
      },
      payment: {
        id: payment.id,
        entity: 'payment',
        amount: payment.amount,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        order_id: null,
        notes: qrCode.notes,
      },
    };
  }

  private run<T>(fn: () => T): Promise<T> {
    try {
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private require(referenceId: string): SimulatedQrCode {
    const qrCode = this.qrCodes.get(referenceId);
    if (!qrCode) {
      throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
    }
    return qrCode;
  }
}

function toState(qrCode: SimulatedQrCode): CollectionLinkState {
  const expired = qrCode.status === 'ACTIVE' && qrCode.expiresAt.getTime() <= Date.now();
  return {
    product: 'QR_CODE',
    referenceId: qrCode.id,
    status: expired ? 'EXPIRED' : qrCode.status,
    url: `https://rzp.io/qr/${qrCode.id}.png`,
    amountPaise: qrCode.amountPaise,
    currency: 'INR',
    expiresAt: qrCode.expiresAt,
    orderId: null,
    payments: qrCode.payments.map((payment) => ({ ...payment })),
  };
}

function simulatedId(prefix: string): string {
  return `${prefix}${randomBytes(7).toString('hex')}`;
}
