import { Injectable, Logger } from '@nestjs/common';
import { isHistoricalPrepaid } from '../bookings/booking-payment-state';
import type { Payment } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayApiError } from '../razorpay/razorpay.errors';
import { RazorpayGateway } from '../razorpay/razorpay.gateway';
import { type RazorpayPayment, RazorpayPaymentState } from '../razorpay/razorpay.types';
import { BookingPaymentFinalizerService } from './booking-payment-finalizer.service';
import {
  ANOMALY_OUTCOMES,
  type ConfirmationOutcome,
  ConfirmationOutcome as Outcome,
  type ConfirmationSource,
  PaymentPurpose,
} from './payment.constants';
import { TopUpFinalizerService } from './top-up-finalizer.service';

export interface ConfirmationContext {
  readonly source: ConfirmationSource;
  readonly providerEventId?: string;
  /**
   * Provider state we already trust: a signature-verified webhook payload or an authenticated
   * API response. When absent, the state is fetched from Razorpay.
   */
  readonly knownPayment?: RazorpayPayment;
}

export interface ConfirmationResult {
  readonly outcome: ConfirmationOutcome;
  /** Razorpay's state for the payment, e.g. captured, failed. */
  readonly providerStatus: string;
}

/**
 * Turns a Razorpay payment for one of our orders into its effect: a wallet credit (driver
 * top-up) or a paid booking (customer prepaid payment). Shared by the app verify calls, the
 * webhook and the admin sync, so every path applies the same checks:
 *
 *   - state comes from Razorpay (API or signed webhook), never from a mobile app;
 *   - the payment must belong to our order, with exactly the server-side amount and currency;
 *   - authorized payments are captured for the order amount (no-op if auto-capture won), but
 *     never for a booking that is no longer payable;
 *   - the effect itself is applied once, under row locks, by the purpose's finalizer.
 *
 * External calls happen here, outside any database transaction.
 */
@Injectable()
export class PaymentConfirmationService {
  private readonly logger = new Logger(PaymentConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RazorpayGateway,
    private readonly topUps: TopUpFinalizerService,
    private readonly bookings: BookingPaymentFinalizerService,
  ) {}

  async confirm(
    paymentId: string,
    providerPaymentId: string,
    context: ConfirmationContext,
  ): Promise<ConfirmationResult> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.status === 'PAID' && payment.razorpayPaymentId === providerPaymentId) {
      return { outcome: Outcome.ALREADY_APPLIED, providerStatus: RazorpayPaymentState.CAPTURED };
    }

    let providerPayment =
      context.knownPayment ?? (await this.gateway.fetchPayment(providerPaymentId));

    const mismatch = this.checkAgainstOrder(payment, providerPaymentId, providerPayment);
    if (mismatch) {
      return this.report(paymentId, providerPayment, mismatch, context);
    }

    if (providerPayment.status === RazorpayPaymentState.AUTHORIZED) {
      if (payment.status !== 'PENDING') {
        // Never capture a second payment for an order that is already settled: leaving it
        // authorized lets Razorpay refund it automatically.
        const outcome =
          payment.status === 'PAID' ? Outcome.DUPLICATE_ORDER_PAYMENT : Outcome.PAYMENT_NOT_PENDING;
        return this.report(paymentId, providerPayment, outcome, context);
      }
      if (!(await this.isCapturable(payment))) {
        // Same reasoning for a booking that was cancelled, completed or paid another way.
        return this.report(paymentId, providerPayment, Outcome.BOOKING_NOT_PAYABLE, context);
      }
      providerPayment = await this.capture(providerPayment, Number(payment.amountPaise));
    }

    if (providerPayment.status !== RazorpayPaymentState.CAPTURED) {
      return { outcome: Outcome.NOT_CAPTURED, providerStatus: providerPayment.status };
    }

    const finalizeContext = { source: context.source, providerEventId: context.providerEventId };
    const outcome =
      payment.purpose === PaymentPurpose.BOOKING
        ? await this.bookings.finalizeCapturedBookingPayment(
            paymentId,
            providerPayment,
            finalizeContext,
          )
        : await this.topUps.finalizeCapturedTopUp(paymentId, providerPayment, finalizeContext);
    return this.report(paymentId, providerPayment, outcome, context);
  }

  /**
   * A booking payment may only be captured while its booking still needs paying, and only for a
   * historical PREPAID_UPI booking: no other booking is ever paid in the app.
   */
  private async isCapturable(payment: Payment): Promise<boolean> {
    if (payment.purpose !== PaymentPurpose.BOOKING || !payment.bookingId) {
      return true;
    }
    const booking = await this.prisma.booking.findUnique({
      where: { id: payment.bookingId },
      select: { status: true, paymentStatus: true, paymentMethod: true, paymentModel: true },
    });
    return (
      booking !== null &&
      isHistoricalPrepaid(booking) &&
      booking.paymentStatus === 'UNPAID' &&
      booking.status !== 'CANCELLED' &&
      booking.status !== 'COMPLETED'
    );
  }

  private checkAgainstOrder(
    payment: { razorpayOrderId: string | null; amountPaise: bigint; currency: string },
    providerPaymentId: string,
    providerPayment: RazorpayPayment,
  ): ConfirmationOutcome | null {
    if (
      providerPayment.id !== providerPaymentId ||
      !payment.razorpayOrderId ||
      providerPayment.orderId !== payment.razorpayOrderId
    ) {
      return Outcome.ORDER_MISMATCH;
    }
    if (
      providerPayment.currency !== payment.currency ||
      BigInt(providerPayment.amount) !== payment.amountPaise
    ) {
      return Outcome.AMOUNT_MISMATCH;
    }
    return null;
  }

  private async capture(
    providerPayment: RazorpayPayment,
    amountPaise: number,
  ): Promise<RazorpayPayment> {
    try {
      return await this.gateway.capturePayment(providerPayment.id, amountPaise);
    } catch (error) {
      if (error instanceof RazorpayApiError && error.httpStatus === 400) {
        // Usually "already captured" (auto-capture got there first). Re-read the real state.
        return this.gateway.fetchPayment(providerPayment.id);
      }
      throw error;
    }
  }

  private report(
    paymentId: string,
    providerPayment: RazorpayPayment,
    outcome: ConfirmationOutcome,
    context: ConfirmationContext,
  ): ConfirmationResult {
    const fields = {
      paymentId,
      providerPaymentId: providerPayment.id,
      providerStatus: providerPayment.status,
      outcome,
      source: context.source,
      providerEventId: context.providerEventId,
    };
    if (ANOMALY_OUTCOMES.has(outcome)) {
      this.logger.error({ ...fields, alert: 'PAYMENT_ANOMALY' }, 'Payment needs manual review');
    } else {
      this.logger.log(fields, 'Payment confirmation processed');
    }
    return { outcome, providerStatus: providerPayment.status };
  }
}
