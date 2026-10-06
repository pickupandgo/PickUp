import { Injectable, Logger } from '@nestjs/common';
import { type DisputeHoldOutcome, EarningsService } from '../earnings/earnings.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER_RAZORPAY, PaymentPurpose } from './payment.constants';

export interface ProviderDispute {
  readonly id: string;
  readonly paymentId: string;
  readonly amount: number;
  /** open, under_review, won, lost, closed */
  readonly status: string;
  readonly reasonCode: string | null;
}

export interface DisputeResult {
  readonly bookingId: string | null;
  readonly hold: DisputeHoldOutcome | 'NOT_A_BOOKING_PAYMENT' | 'NOT_HELD_RESOLVED';
}

/** Dispute states after which Razorpay no longer pursues the chargeback. */
const RESOLVED_STATUSES: ReadonlySet<string> = new Set(['won', 'closed']);

/**
 * Records Razorpay disputes (chargebacks) and keeps the disputed payment's driver earning out of
 * payouts. Holds are never lifted automatically, even when a dispute is won: an admin releases
 * the earning (V1 rule: no automatic payout for disputed transactions).
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly earnings: EarningsService,
  ) {}

  async record(dispute: ProviderDispute, eventType: string): Promise<DisputeResult> {
    const bookingId = await this.findBooking(dispute.paymentId);
    const result = await this.prisma.runInTransaction(async (tx) => {
      await tx.paymentDispute.upsert({
        where: {
          provider_providerDisputeId: {
            provider: PAYMENT_PROVIDER_RAZORPAY,
            providerDisputeId: dispute.id,
          },
        },
        create: {
          provider: PAYMENT_PROVIDER_RAZORPAY,
          providerDisputeId: dispute.id,
          providerPaymentId: dispute.paymentId,
          bookingId,
          amountPaise: BigInt(dispute.amount),
          status: dispute.status,
          reasonCode: dispute.reasonCode,
        },
        update: {
          amountPaise: BigInt(dispute.amount),
          status: dispute.status,
          reasonCode: dispute.reasonCode,
        },
      });
      if (!bookingId) {
        return { bookingId, hold: 'NOT_A_BOOKING_PAYMENT' as const };
      }
      if (RESOLVED_STATUSES.has(dispute.status)) {
        return { bookingId, hold: 'NOT_HELD_RESOLVED' as const };
      }
      const hold = await this.earnings.holdForDispute(
        tx,
        bookingId,
        `PAYMENT_DISPUTED: ${dispute.id} (${dispute.status})`,
      );
      return { bookingId, hold };
    });

    this.logger.error(
      {
        disputeId: dispute.id,
        providerPaymentId: dispute.paymentId,
        status: dispute.status,
        eventType,
        bookingId: result.bookingId,
        hold: result.hold,
        alert: 'PAYMENT_DISPUTE',
      },
      'Payment dispute recorded; manual review needed',
    );
    return result;
  }

  /** The booking a disputed payment belongs to: a prepaid payment or an online collection. */
  private async findBooking(providerPaymentId: string): Promise<string | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { razorpayPaymentId: providerPaymentId },
      select: { purpose: true, bookingId: true },
    });
    if (payment) {
      return payment.purpose === PaymentPurpose.BOOKING ? payment.bookingId : null;
    }
    const collection = await this.prisma.paymentCollection.findFirst({
      where: { provider: PAYMENT_PROVIDER_RAZORPAY, providerPaymentId },
      select: { bookingId: true },
    });
    return collection?.bookingId ?? null;
  }
}
