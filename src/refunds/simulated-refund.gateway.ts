import { HttpStatus } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { RazorpayApiError } from '../razorpay/razorpay.errors';
import {
  type CreateRefundInput,
  type ProviderRefund,
  ProviderRefundStatus,
  RefundGateway,
} from './refund.gateway';

/**
 * In-memory stand-in for Razorpay refunds (REFUND_PROVIDER=simulated, only allowed outside
 * production with test keys). It behaves like the Razorpay refunds API: X-Refund-Idempotency
 * returns the original refund for a repeated key, and new refunds stay `pending` until moved
 * through /v1/dev/simulate/refunds, which returns the refund entity for a test to deliver as a
 * signed refund.* webhook. Results reach the backend only through the normal paths (webhook,
 * admin sync), never by writing to the database.
 */
export class SimulatedRefundGateway extends RefundGateway {
  readonly enabled = true;
  private readonly refunds = new Map<string, ProviderRefund>();
  private readonly byKey = new Map<string, string>();

  createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    const existing = this.byKey.get(input.refundId);
    if (existing) {
      return this.fetchRefund(existing);
    }
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      return Promise.reject(
        new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The amount must be at least INR 1.00'),
      );
    }
    const refund: ProviderRefund = {
      id: `rfnd_sim${randomBytes(7).toString('hex')}`,
      paymentId: input.providerPaymentId,
      amount: input.amountPaise,
      currency: 'INR',
      status: ProviderRefundStatus.PENDING,
      receipt: input.refundId,
      notes: { ...input.notes },
      reference: null,
    };
    this.refunds.set(refund.id, refund);
    this.byKey.set(input.refundId, refund.id);
    return Promise.resolve({ ...refund });
  }

  fetchRefund(providerRefundId: string): Promise<ProviderRefund> {
    const refund = this.refunds.get(providerRefundId);
    return refund
      ? Promise.resolve({ ...refund })
      : Promise.reject(
          new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The id provided does not exist'),
        );
  }

  listPaymentRefunds(providerPaymentId: string): Promise<ProviderRefund[]> {
    return Promise.resolve(
      [...this.refunds.values()]
        .filter((refund) => refund.paymentId === providerPaymentId)
        .map((refund) => ({ ...refund })),
    );
  }

  /** Moves a refund the way Razorpay does: processed (with a bank reference) or failed. */
  setRefundStatus(providerRefundId: string, status: 'processed' | 'failed'): ProviderRefund | null {
    const refund = this.refunds.get(providerRefundId);
    if (!refund) {
      return null;
    }
    if (refund.status !== ProviderRefundStatus.PENDING) {
      // Razorpay never moves a finished refund again.
      return { ...refund };
    }
    const moved: ProviderRefund = {
      ...refund,
      status,
      reference:
        status === 'processed' ? String(10_000_000_000 + randomBytes(4).readUInt32BE()) : null,
    };
    this.refunds.set(providerRefundId, moved);
    return { ...moved };
  }
}

/** The refund entity Razorpay sends in refund.* webhooks and returns from the refunds API. */
export function refundEntity(refund: ProviderRefund): Record<string, unknown> {
  return {
    id: refund.id,
    entity: 'refund',
    amount: refund.amount,
    currency: refund.currency,
    payment_id: refund.paymentId,
    notes: Object.keys(refund.notes).length > 0 ? refund.notes : [],
    receipt: refund.receipt,
    acquirer_data: { arn: refund.reference },
    created_at: Math.floor(Date.now() / 1000),
    batch_id: null,
    status: refund.status,
    speed_processed: 'normal',
    speed_requested: 'normal',
  };
}

/** REFUND_PROVIDER=disabled: provider refunds are refused; cash returns are still recorded. */
export class DisabledRefundGateway extends RefundGateway {
  readonly enabled = false;

  createRefund(): Promise<ProviderRefund> {
    return Promise.reject(refundsNotConfigured());
  }

  fetchRefund(): Promise<ProviderRefund> {
    return Promise.reject(refundsNotConfigured());
  }

  listPaymentRefunds(): Promise<ProviderRefund[]> {
    return Promise.reject(refundsNotConfigured());
  }
}

export function refundsNotConfigured(): AppError {
  return new AppError(
    ErrorCode.REFUND_PROVIDER_NOT_CONFIGURED,
    HttpStatus.SERVICE_UNAVAILABLE,
    'Provider refunds are not enabled on this server',
  );
}
