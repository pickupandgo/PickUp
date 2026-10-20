import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { EVENT_ID_PATTERN } from '../payments/razorpay-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { isValidWebhookSignature } from '../razorpay/razorpay-signatures';
import { BankAccountsService } from './bank-accounts.service';
import { notConfigured } from './disabled-payout.gateway';
import { PayoutGateway } from './payout.gateway';
import { PAYOUT_ANOMALIES, PayoutStatusService } from './payout-status.service';
import {
  razorpayxPayoutSchema,
  razorpayxValidationSchema,
  toProviderBankValidation,
  toProviderPayout,
} from './razorpayx-http.gateway';
import type { WebhookRequest, WebhookResult } from '../payments/razorpay-webhook.service';

const envelopeSchema = z.looseObject({
  entity: z.literal('event'),
  event: z.string().min(1).max(100),
  payload: z.looseObject({
    payout: z.looseObject({ entity: z.unknown() }).optional(),
    'fund_account.validation': z.looseObject({ entity: z.unknown() }).optional(),
  }),
});
type Envelope = z.infer<typeof envelopeSchema>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Decision {
  readonly outcome: string;
  readonly payoutId?: string;
  readonly problem?: string;
}

/**
 * RazorpayX payout webhooks: same pipeline as the Razorpay payment webhook (verify the signature
 * over the raw body, store the event once by id, process idempotently, record the outcome).
 * Repeated deliveries never change a payout twice.
 */
@Injectable()
export class RazorpayXWebhookService {
  private readonly logger = new Logger(RazorpayXWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly status: PayoutStatusService,
    private readonly bankAccounts: BankAccountsService,
    private readonly gateway: PayoutGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async handle(request: WebhookRequest): Promise<WebhookResult> {
    const secrets = this.config.payouts.webhookSecrets;
    if (secrets.length === 0) {
      throw notConfigured();
    }
    const { rawBody, signature } = request;
    if (!rawBody || rawBody.length === 0) {
      throw new AppError(
        ErrorCode.WEBHOOK_MALFORMED,
        HttpStatus.BAD_REQUEST,
        'Webhook body is missing',
      );
    }
    if (!signature || !isValidWebhookSignature({ rawBody, signature, secrets })) {
      this.logger.warn(
        { bytes: rawBody.length },
        'Rejected RazorpayX webhook with an invalid signature',
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
    const envelope = envelopeSchema.safeParse(parsed);
    const eventType = envelope.success ? envelope.data.event : 'unknown';
    const eventId =
      request.eventIdHeader && EVENT_ID_PATTERN.test(request.eventIdHeader)
        ? request.eventIdHeader
        : `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;

    await this.prisma.$executeRaw`
      INSERT INTO payout_events (event_id, event_type, provider, payload, signature_valid)
      VALUES (${eventId}, ${eventType}, ${this.gateway.provider}, ${rawText}::jsonb, TRUE)
      ON CONFLICT (event_id) DO NOTHING`;

    const stored = await this.prisma.payoutEvent.findUniqueOrThrow({ where: { eventId } });
    if (stored.processedAt) {
      return { eventId, outcome: stored.outcome ?? 'DUPLICATE', duplicate: true };
    }
    await this.prisma.payoutEvent.update({
      where: { eventId },
      data: { attempts: { increment: 1 } },
    });

    let decision: Decision;
    try {
      decision = await this.decide(envelope.success ? envelope.data : null);
    } catch (error) {
      await this.prisma.payoutEvent
        .update({
          where: { eventId },
          data: { processingError: error instanceof Error ? error.name : 'UnknownError' },
        })
        .catch(() => undefined);
      this.logger.error(
        { err: error, eventId },
        'RazorpayX webhook processing failed; it will be retried',
      );
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Webhook could not be processed, please retry',
      );
    }

    await this.prisma.payoutEvent.updateMany({
      where: { eventId, processedAt: null },
      data: {
        processedAt: new Date(),
        outcome: decision.outcome,
        payoutId: decision.payoutId ?? null,
        processingError: decision.problem ?? null,
      },
    });
    if (decision.problem) {
      this.logger.error(
        {
          eventId,
          outcome: decision.outcome,
          payoutId: decision.payoutId,
          alert: 'PAYOUT_ANOMALY',
        },
        'RazorpayX webhook needs manual review',
      );
    }
    return { eventId, outcome: decision.outcome, duplicate: false };
  }

  private async decide(envelope: Envelope | null): Promise<Decision> {
    if (!envelope) {
      return { outcome: 'UNSUPPORTED_PAYLOAD', problem: 'Unexpected webhook envelope' };
    }
    if (
      envelope.event === 'fund_account.validation.completed' ||
      envelope.event === 'fund_account.validation.failed'
    ) {
      return this.decideValidation(envelope);
    }
    if (!envelope.event.startsWith('payout.') || envelope.event.startsWith('payout.downtime')) {
      return { outcome: 'IGNORED_EVENT_TYPE' };
    }
    const entity = razorpayxPayoutSchema.safeParse(envelope.payload.payout?.entity);
    if (!entity.success) {
      return { outcome: 'UNSUPPORTED_PAYLOAD', problem: 'Payout entity missing or malformed' };
    }
    const provider = toProviderPayout(entity.data);

    const byReference =
      provider.referenceId && UUID_PATTERN.test(provider.referenceId)
        ? await this.prisma.driverPayout.findUnique({
            where: { id: provider.referenceId },
            select: { id: true },
          })
        : null;
    const payout =
      byReference ??
      (await this.prisma.driverPayout.findFirst({
        where: { provider: this.gateway.provider, providerPayoutId: provider.id },
        select: { id: true },
      }));
    if (!payout) {
      return {
        outcome: 'UNKNOWN_PAYOUT',
        problem: 'A payout this service did not create changed state',
      };
    }

    const result = await this.status.apply(payout.id, provider, 'WEBHOOK');
    return {
      outcome: result.outcome,
      payoutId: payout.id,
      problem: PAYOUT_ANOMALIES.has(result.outcome) ? result.outcome : undefined,
    };
  }

  /** fund_account.validation.completed / .failed: records the bank's answer for the admin. */
  private async decideValidation(envelope: Envelope): Promise<Decision> {
    const entity = razorpayxValidationSchema.safeParse(
      envelope.payload['fund_account.validation']?.entity,
    );
    if (!entity.success) {
      return { outcome: 'UNSUPPORTED_PAYLOAD', problem: 'Validation entity missing or malformed' };
    }
    const { outcome } = await this.bankAccounts.applyValidation(
      toProviderBankValidation(entity.data),
    );
    switch (outcome) {
      case 'UNKNOWN_VALIDATION':
        return {
          outcome: 'UNKNOWN_BANK_VALIDATION',
          problem: 'A bank validation this service did not start changed state',
        };
      case 'CONFLICTING_RESULT':
        return { outcome: 'BANK_VALIDATION_CONFLICT', problem: 'BANK_VALIDATION_CONFLICT' };
      default:
        return { outcome: `BANK_VALIDATION_${outcome}` };
    }
  }
}
