import { RazorpayApiError, RazorpayUnavailableError } from '../../src/razorpay/razorpay.errors';
import {
  type CreateRefundInput,
  type ProviderRefund,
  RefundGateway,
} from '../../src/refunds/refund.gateway';
import { newId } from './fake-razorpay.gateway';

/**
 * What the next createRefund call does instead of (or besides) answering normally:
 *   unavailable    nothing is created; Razorpay could not be reached
 *   reject         nothing is created; Razorpay rejects the request (HTTP 400)
 *   lose-response  the refund is created, but the reply never arrives (timeout, crash)
 *   unparseable    the refund is created, but the reply can't be read (HTTP 200, odd body)
 */
export type CreateRefundBehaviour = 'unavailable' | 'reject' | 'lose-response' | 'unparseable';

/**
 * In-memory Razorpay refunds with the documented behaviours: X-Refund-Idempotency returns the
 * original refund for a repeated key, a payment can't be refunded beyond what was captured, new
 * refunds start `pending`, and states are moved explicitly by the test (refund.processed /
 * refund.failed happen later at Razorpay).
 */
export class FakeRefundGateway extends RefundGateway {
  /** Switch off to test REFUND_PROVIDER=disabled behaviour. */
  enabled = true;
  readonly refunds = new Map<string, ProviderRefund>();
  readonly calls = { createRefund: 0, fetchRefund: 0, listPaymentRefunds: 0 };
  unavailable = false;
  /** Status a new refund starts in. Razorpay reports most normal refunds as pending first. */
  initialStatus = 'pending';
  /** Captured amount per payment id, when a test wants Razorpay's "more than captured" check. */
  readonly captured = new Map<string, number>();
  private readonly behaviours: CreateRefundBehaviour[] = [];
  private readonly byKey = new Map<string, string>();

  queueCreateBehaviour(behaviour: CreateRefundBehaviour): void {
    this.behaviours.push(behaviour);
  }

  createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    this.calls.createRefund += 1;
    return this.run(() => {
      const behaviour = this.behaviours.shift();
      if (behaviour === 'unavailable') {
        throw new RazorpayUnavailableError('simulated outage');
      }
      if (behaviour === 'reject') {
        throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'simulated rejection');
      }
      const existingId = this.byKey.get(input.refundId);
      if (existingId) {
        return { ...this.require(existingId) };
      }
      const captured = this.captured.get(input.providerPaymentId);
      if (captured !== undefined) {
        const refunded = [...this.refunds.values()]
          .filter((refund) => refund.paymentId === input.providerPaymentId)
          .filter((refund) => refund.status !== 'failed')
          .reduce((sum, refund) => sum + refund.amount, 0);
        if (refunded + input.amountPaise > captured) {
          throw new RazorpayApiError(
            400,
            'BAD_REQUEST_ERROR',
            'The refund amount provided is greater than amount captured',
          );
        }
      }
      const refund: ProviderRefund = {
        id: newId('rfnd_'),
        paymentId: input.providerPaymentId,
        amount: input.amountPaise,
        currency: 'INR',
        status: this.initialStatus,
        receipt: input.refundId,
        notes: { ...input.notes },
        reference: null,
      };
      this.refunds.set(refund.id, refund);
      this.byKey.set(input.refundId, refund.id);
      if (behaviour === 'lose-response') {
        throw new RazorpayUnavailableError('simulated lost response');
      }
      if (behaviour === 'unparseable') {
        throw new RazorpayApiError(502, 'UNEXPECTED_RESPONSE', 'Unexpected refund response');
      }
      return { ...refund };
    });
  }

  fetchRefund(providerRefundId: string): Promise<ProviderRefund> {
    this.calls.fetchRefund += 1;
    return this.run(() => ({ ...this.require(providerRefundId) }));
  }

  listPaymentRefunds(providerPaymentId: string): Promise<ProviderRefund[]> {
    this.calls.listPaymentRefunds += 1;
    return this.run(() =>
      [...this.refunds.values()]
        .filter((refund) => refund.paymentId === providerPaymentId)
        .map((refund) => ({ ...refund })),
    );
  }

  /** Moves a refund the way Razorpay does over time (processed with a bank reference, failed). */
  setStatus(providerRefundId: string, status: string, reference?: string): ProviderRefund {
    const refund = this.require(providerRefundId);
    const moved: ProviderRefund = {
      ...refund,
      status,
      reference: reference ?? (status === 'processed' ? newId('ARN') : refund.reference),
    };
    this.refunds.set(providerRefundId, moved);
    return { ...moved };
  }

  /** A refund made outside this service (e.g. on the Razorpay dashboard): no receipt or notes. */
  createExternal(providerPaymentId: string, amount: number, status = 'processed'): ProviderRefund {
    const refund: ProviderRefund = {
      id: newId('rfnd_'),
      paymentId: providerPaymentId,
      amount,
      currency: 'INR',
      status,
      receipt: null,
      notes: {},
      reference: status === 'processed' ? newId('ARN') : null,
    };
    this.refunds.set(refund.id, refund);
    return { ...refund };
  }

  /** The provider refund created for our refund id, if any. */
  forRefund(refundId: string): ProviderRefund | undefined {
    const id = this.byKey.get(refundId);
    return id ? { ...this.require(id) } : undefined;
  }

  private require(providerRefundId: string): ProviderRefund {
    const refund = this.refunds.get(providerRefundId);
    if (!refund) {
      throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
    }
    return refund;
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
