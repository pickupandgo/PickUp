import { paiseToNumber } from '../common/money';
import type { FEE_TREATMENTS, REFUND_KINDS, REFUND_STATUSES, RefundResponse } from './refunds.dto';
import type { RefundWithStop } from './refunds.service';

export function toRefundResponse(refund: RefundWithStop): RefundResponse {
  return {
    refundId: refund.id,
    bookingId: refund.bookingId,
    stopSequence: refund.bookingStop?.sequence ?? null,
    sourceCollectionId: refund.sourceCollectionId,
    sourcePaymentId: refund.sourcePaymentId,
    kind: refund.kind as (typeof REFUND_KINDS)[number],
    status: refund.status as (typeof REFUND_STATUSES)[number],
    refundCase: refund.refundCase,
    amountPaise: paiseToNumber(refund.amountPaise),
    currency: refund.currency,
    reason: refund.reason,
    requestedByUserId: refund.requestedByUserId,
    provider: refund.provider,
    providerPaymentId: refund.providerPaymentId,
    providerRefundId: refund.providerRefundId,
    providerStatus: refund.providerStatus,
    providerReference: refund.providerReference,
    feeTreatment: refund.feeTreatment as (typeof FEE_TREATMENTS)[number] | null,
    feeCreditPaise: refund.feeCreditPaise === null ? null : paiseToNumber(refund.feeCreditPaise),
    walletTransactionId: refund.walletTransactionId,
    failureReason: refund.failureReason,
    submitAttempts: refund.submitAttempts,
    lastSubmittedAt: refund.lastSubmittedAt?.toISOString() ?? null,
    completedAt: refund.completedAt?.toISOString() ?? null,
    failedAt: refund.failedAt?.toISOString() ?? null,
    cancelledAt: refund.cancelledAt?.toISOString() ?? null,
    cancelledByUserId: refund.cancelledByUserId,
    cancellationReason: refund.cancellationReason,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
  };
}
