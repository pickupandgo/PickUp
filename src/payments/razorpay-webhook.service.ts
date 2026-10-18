import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { FinancialContext } from '../audit/financial-context';
import { CollectionsService } from '../collections/collections.service';
import { isAnomaly } from '../collections/collection-finalizer.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayApiError } from '../razorpay/razorpay.errors';
import { RazorpayGateway } from '../razorpay/razorpay.gateway';
import { isValidWebhookSignature } from '../razorpay/razorpay-signatures';
import { MerchantSettlementsService } from '../settlements/merchant-settlements.service';
import {
  RAZORPAY_ORDER_ID_PATTERN,
  RAZORPAY_PAYMENT_ID_PATTERN,
  razorpayPaymentSchema,
  razorpayRefundSchema,
  toRazorpayPayment,
} from '../razorpay/razorpay.types';
import { toProviderRefund } from '../refunds/refund.gateway';
import {
  REFUND_ANOMALIES,
  RefundFinalizerService,
  RefundOutcome,
} from '../refunds/refund-finalizer.service';
import { DisputesService } from './disputes.service';
import {
  ANOMALY_OUTCOMES,
  ConfirmationOutcome,
  PAYMENT_PROVIDER_RAZORPAY,
  WebhookOutcome,
} from './payment.constants';
import { PaymentConfirmationService } from './payment-confirmation.service';

/** Razorpay sends a unique id per event in X-Razorpay-Event-Id. */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

const wrapped = z.looseObject({ entity: z.unknown() }).optional();

const webhookEnvelopeSchema = z.looseObject({
  entity: z.literal('event'),
  event: z.string().min(1).max(100),
  payload: z.looseObject({
    payment: wrapped,
    order: wrapped,
    payment_link: wrapped,
    qr_code: wrapped,
    dispute: wrapped,
    settlement: wrapped,
    refund: wrapped,
  }),
});
type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

const idOnly = (pattern: RegExp) => z.looseObject({ id: z.string().regex(pattern) });
const notesSchema = z.looseObject({ notes: z.unknown().optional() });
const orderReceiptSchema = z.looseObject({ receipt: z.string().nullish() });
const disputeSchema = z.looseObject({
  id: z.string().regex(/^disp_[A-Za-z0-9]{6,40}$/),
  payment_id: z.string().regex(RAZORPAY_PAYMENT_ID_PATTERN),
  amount: z.number().int().nonnegative(),
  status: z.string().min(1).max(30),
  reason_code: z.string().max(100).nullish(),
});

const COLLECTION_EVENTS: ReadonlySet<string> = new Set([
  'payment_link.paid',
  'payment_link.partially_paid',
  'payment_link.expired',
  'payment_link.cancelled',
  'qr_code.credited',
  'qr_code.closed',
]);

export interface WebhookRequest {
  readonly rawBody: Buffer | undefined;
  readonly signature: string | undefined;
  readonly eventIdHeader: string | undefined;
}

export interface WebhookResult {
  readonly eventId: string;
  readonly outcome: string;
  readonly duplicate: boolean;
}

interface Decision {
  readonly outcome: string;
  readonly paymentId?: string;
  /** Set when a human needs to look at this event. */
  readonly problem?: string;
}

/**
 * Razorpay webhook processing (PW 4.2 and MP section 13):
 *   1. verify X-Razorpay-Signature over the raw body (forgeries are rejected and never stored);
 *   2. store the event once, keyed by its event id;
 *   3. process it idempotently through the same confirmation paths the apps use;
 *   4. record the outcome. Temporary failures return 5xx so Razorpay retries.
 *
 * Handles wallet top-ups and booking payments (orders), pickup/delivery QR collections
 * (payment links and QR codes), disputes and refunds (refund.*, payment flow Phase 6).
 */
@Injectable()
export class RazorpayWebhookService {
  private readonly logger = new Logger(RazorpayWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmation: PaymentConfirmationService,
    private readonly collections: CollectionsService,
    private readonly disputes: DisputesService,
    private readonly settlements: MerchantSettlementsService,
    private readonly gateway: RazorpayGateway,
    private readonly refunds: RefundFinalizerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async handle(request: WebhookRequest): Promise<WebhookResult> {
    const { rawBody, signature } = request;
    if (!rawBody || rawBody.length === 0) {
      throw new AppError(
        ErrorCode.WEBHOOK_MALFORMED,
        HttpStatus.BAD_REQUEST,
        'Webhook body is missing',
      );
    }
    if (
      !signature ||
      !isValidWebhookSignature({ rawBody, signature, secrets: this.config.razorpay.webhookSecrets })
    ) {
      this.logger.warn(
        { bytes: rawBody.length },
        'Rejected Razorpay webhook with an invalid signature',
      );
      throw new AppError(
        ErrorCode.WEBHOOK_SIGNATURE_INVALID,
        HttpStatus.BAD_REQUEST,
        'Webhook signature is invalid',
      );
    }

    const rawText = rawBody.toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new AppError(
        ErrorCode.WEBHOOK_MALFORMED,
        HttpStatus.BAD_REQUEST,
        'Webhook body is not JSON',
      );
    }
    const envelope = webhookEnvelopeSchema.safeParse(parsed);
    const eventType = envelope.success ? envelope.data.event : 'unknown';

    // The header is the documented dedupe key. A hash of the signed body is a deterministic
    // fallback, so a retried delivery without the header still dedupes.
    const eventId =
      request.eventIdHeader && EVENT_ID_PATTERN.test(request.eventIdHeader)
        ? request.eventIdHeader
        : `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
    // Signed: every financial change this event causes is the provider's, with its event id.
    FinancialContext.annotate({
      actorType: 'PROVIDER',
      origin: `webhook razorpay ${eventType}`,
      providerEventId: eventId,
    });

    await this.prisma.$executeRaw`
      INSERT INTO payment_events (event_id, event_type, provider, payload, signature_valid)
      VALUES (${eventId}, ${eventType}, ${PAYMENT_PROVIDER_RAZORPAY}, ${rawText}::jsonb, TRUE)
      ON CONFLICT (event_id) DO NOTHING`;

    return this.process(eventId, envelope.success ? envelope.data : null);
  }

  private async process(eventId: string, envelope: WebhookEnvelope | null): Promise<WebhookResult> {
    const stored = await this.prisma.paymentEvent.findUniqueOrThrow({ where: { eventId } });
    if (stored.processedAt) {
      return { eventId, outcome: stored.outcome ?? 'DUPLICATE', duplicate: true };
    }
    await this.prisma.paymentEvent.update({
      where: { eventId },
      data: { attempts: { increment: 1 } },
    });

    let decision: Decision;
    try {
      decision = await this.decide(eventId, envelope);
    } catch (error) {
      // Leave the event unprocessed; Razorpay retries non-2xx deliveries for 24 hours and ops can
      // see it in /admin/reconciliation/unprocessed-webhooks.
      await this.prisma.paymentEvent
        .update({ where: { eventId }, data: { processingError: describeError(error) } })
        .catch(() => undefined);
      this.logger.error(
        { err: error, eventId },
        'Razorpay webhook processing failed; it will be retried',
      );
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Webhook could not be processed, please retry',
      );
    }

    const data = {
      processedAt: new Date(),
      outcome: decision.outcome,
      paymentId: decision.paymentId ?? null,
      processingError: decision.problem ?? null,
    };
    if (
      decision.outcome === ConfirmationOutcome.APPLIED ||
      decision.outcome === RefundOutcome.APPLIED
    ) {
      // APPLIED happens at most once per payment (or refund state), so it may overwrite a
      // concurrent duplicate's ALREADY_APPLIED that finished first.
      await this.prisma.paymentEvent.update({ where: { eventId }, data });
    } else {
      await this.prisma.paymentEvent.updateMany({ where: { eventId, processedAt: null }, data });
    }

    if (decision.problem) {
      this.logger.error(
        {
          eventId,
          outcome: decision.outcome,
          paymentId: decision.paymentId,
          alert: 'PAYMENT_ANOMALY',
        },
        'Razorpay webhook needs manual review',
      );
    }
    return { eventId, outcome: decision.outcome, duplicate: false };
  }

  private async decide(eventId: string, envelope: WebhookEnvelope | null): Promise<Decision> {
    if (!envelope) {
      return {
        outcome: WebhookOutcome.UNSUPPORTED_PAYLOAD,
        problem: 'Unexpected webhook envelope',
      };
    }
    if (envelope.event.startsWith('payment.dispute.')) {
      return this.decideDispute(envelope);
    }
    if (envelope.event.startsWith('refund.')) {
      // refund.created / processed / failed / speed_changed (payment flow Phase 6).
      return this.decideRefund(envelope);
    }
    if (COLLECTION_EVENTS.has(envelope.event)) {
      return this.decideCollectionEvent(eventId, envelope);
    }
    switch (envelope.event) {
      case 'payment.captured':
      case 'payment.authorized':
      case 'order.paid':
        return this.decidePaymentEvent(eventId, envelope);
      case 'payment.failed':
        return this.decideFailedAttempt(envelope);
      case 'settlement.processed':
        // Only a hint: the settlement's payments are read from Razorpay's recon API, and only
        // what that reports as settled can make an earning payable.
        return this.settlements.handleSettlementWebhook(envelope.payload.settlement?.entity);
      default:
        return { outcome: WebhookOutcome.IGNORED_EVENT_TYPE };
    }
  }

  private async decidePaymentEvent(eventId: string, envelope: WebhookEnvelope): Promise<Decision> {
    const entity = razorpayPaymentSchema.safeParse(envelope.payload.payment?.entity);
    if (!entity.success) {
      return {
        outcome: WebhookOutcome.UNSUPPORTED_PAYLOAD,
        problem: 'Payment entity missing or malformed',
      };
    }
    const providerPayment = toRazorpayPayment(entity.data);
    const noteCollectionId = readNote(envelope.payload.payment?.entity, 'collection_id');

    if (!providerPayment.orderId) {
      // QR code payments carry no order.
      const result = await this.collections.handlePaymentWithoutOrder(
        providerPayment.id,
        noteCollectionId,
        eventId,
      );
      if (result.outcome === WebhookOutcome.UNKNOWN_COLLECTION) {
        return {
          outcome: WebhookOutcome.MISSING_ORDER_ID,
          problem: 'Payment is not linked to an order or a known collection',
        };
      }
      return collectionDecision(result.outcome);
    }

    const payment = await this.prisma.payment.findUnique({
      where: { razorpayOrderId: providerPayment.orderId },
    });
    if (!payment) {
      return this.decideCollectionOrder(
        eventId,
        envelope,
        providerPayment.orderId,
        noteCollectionId,
      );
    }

    // The signed payload is trusted provider state, so no extra API round trip is needed.
    const result = await this.confirmation.confirm(payment.id, providerPayment.id, {
      source: 'WEBHOOK',
      providerEventId: eventId,
      knownPayment: providerPayment,
    });
    return {
      outcome: result.outcome,
      paymentId: payment.id,
      problem: ANOMALY_OUTCOMES.has(result.outcome) ? result.outcome : undefined,
    };
  }

  /**
   * An order we did not create through /orders: a payment link's internal order. The link's
   * reference id (our collection id) is the order receipt; Razorpay is asked when the event
   * doesn't carry it.
   */
  private async decideCollectionOrder(
    eventId: string,
    envelope: WebhookEnvelope,
    orderId: string,
    noteCollectionId: string | null,
  ): Promise<Decision> {
    const receipt = orderReceiptSchema.safeParse(envelope.payload.order?.entity);
    const hint = {
      collectionId: noteCollectionId ?? (receipt.success ? (receipt.data.receipt ?? null) : null),
      providerOrderId: orderId,
    };
    if (
      !(await this.collections.isKnownCollection(hint)) &&
      RAZORPAY_ORDER_ID_PATTERN.test(orderId)
    ) {
      try {
        hint.collectionId = (await this.gateway.fetchOrder(orderId)).receipt;
      } catch (error) {
        // A definitive "no such order" means it isn't ours; outages propagate so Razorpay retries.
        if (!(error instanceof RazorpayApiError)) {
          throw error;
        }
      }
    }
    if (!(await this.collections.isKnownCollection(hint))) {
      return {
        outcome: WebhookOutcome.UNKNOWN_ORDER,
        problem: 'Money was received for an order this service did not create',
      };
    }
    const result = await this.collections.handleWebhookHint(hint, eventId);
    return collectionDecision(result.outcome);
  }

  private async decideCollectionEvent(
    eventId: string,
    envelope: WebhookEnvelope,
  ): Promise<Decision> {
    const isLink = envelope.event.startsWith('payment_link.');
    const reference = isLink
      ? idOnly(/^plink_[A-Za-z0-9]{6,40}$/).safeParse(envelope.payload.payment_link?.entity)
      : idOnly(/^qr_[A-Za-z0-9]{6,40}$/).safeParse(envelope.payload.qr_code?.entity);
    if (!reference.success) {
      return {
        outcome: WebhookOutcome.UNSUPPORTED_PAYLOAD,
        problem: 'Collection entity missing or malformed',
      };
    }
    const result = await this.collections.handleWebhookHint(
      { providerReferenceId: reference.data.id },
      eventId,
    );
    if (result.outcome === WebhookOutcome.UNKNOWN_COLLECTION) {
      const paid = envelope.event === 'payment_link.paid' || envelope.event === 'qr_code.credited';
      return {
        outcome: WebhookOutcome.UNKNOWN_COLLECTION,
        problem: paid
          ? 'Money was received for a collection this service did not create'
          : undefined,
      };
    }
    return collectionDecision(result.outcome);
  }

  private async decideDispute(envelope: WebhookEnvelope): Promise<Decision> {
    const dispute = disputeSchema.safeParse(envelope.payload.dispute?.entity);
    if (!dispute.success) {
      return {
        outcome: WebhookOutcome.UNSUPPORTED_PAYLOAD,
        problem: 'Dispute entity missing or malformed',
      };
    }
    const result = await this.disputes.record(
      {
        id: dispute.data.id,
        paymentId: dispute.data.payment_id,
        amount: dispute.data.amount,
        status: dispute.data.status,
        reasonCode: dispute.data.reason_code ?? null,
      },
      envelope.event,
    );
    // Every dispute needs a human: record it as a problem so it shows in the anomaly report.
    return {
      outcome: WebhookOutcome.DISPUTE_RECORDED,
      problem: `DISPUTE_${dispute.data.status.toUpperCase()}:${result.hold}`.slice(0, 200),
    };
  }

  /**
   * A refund state from Razorpay. The signed payload is trusted provider state; the refund
   * finalizer checks it is exactly one of ours (payment, amount, currency, ids) and applies it
   * forward only, the same way as the submission reply and admin syncs.
   */
  private async decideRefund(envelope: WebhookEnvelope): Promise<Decision> {
    const entity = razorpayRefundSchema.safeParse(envelope.payload.refund?.entity);
    if (!entity.success) {
      return {
        outcome: WebhookOutcome.UNSUPPORTED_PAYLOAD,
        problem: 'Refund entity missing or malformed',
      };
    }
    const result = await this.refunds.applyWebhook(toProviderRefund(entity.data));
    return {
      outcome: result.outcome,
      paymentId: result.refund?.sourcePaymentId ?? undefined,
      problem: REFUND_ANOMALIES.has(result.outcome)
        ? result.outcome === RefundOutcome.UNKNOWN
          ? `${result.outcome}: a Razorpay refund this service did not request`
          : result.outcome
        : undefined,
    };
  }

  private async decideFailedAttempt(envelope: WebhookEnvelope): Promise<Decision> {
    // A failed attempt does not fail the order: the customer can retry on the same order.
    const entity = razorpayPaymentSchema.safeParse(envelope.payload.payment?.entity);
    const orderId = entity.success ? entity.data.order_id : null;
    const payment = orderId
      ? await this.prisma.payment.findUnique({
          where: { razorpayOrderId: orderId },
          select: { id: true },
        })
      : null;
    return { outcome: WebhookOutcome.PAYMENT_ATTEMPT_FAILED, paymentId: payment?.id };
  }
}

function collectionDecision(outcome: string): Decision {
  return {
    outcome,
    problem: isAnomaly(outcome as Parameters<typeof isAnomaly>[0])
      ? `COLLECTION_${outcome}`
      : undefined,
  };
}

/** Reads a string note we set on a Razorpay object (notes may arrive as an empty array). */
function readNote(entity: unknown, key: string): string | null {
  const parsed = notesSchema.safeParse(entity);
  if (!parsed.success) {
    return null;
  }
  const notes = parsed.data.notes;
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    return null;
  }
  const value = (notes as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length <= 100 ? value : null;
}

function describeError(error: unknown): string {
  if (error instanceof AppError) {
    return `${error.name}:${error.code}`;
  }
  return error instanceof Error ? error.name : 'UnknownError';
}
