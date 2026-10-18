import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { Payment } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayApiError, RazorpayUnavailableError } from '../razorpay/razorpay.errors';
import { RazorpayGateway } from '../razorpay/razorpay.gateway';
import type { RazorpayOrder } from '../razorpay/razorpay.types';
import { toProviderAppError } from './provider-errors';

/**
 * Razorpay order handling shared by wallet top-ups and customer booking payments. The order is
 * always created by the server, for the amount on our payment row, with our payment id as the
 * receipt. No database locks are held while Razorpay is called.
 */
@Injectable()
export class PaymentOrderService {
  private readonly logger = new Logger(PaymentOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RazorpayGateway,
  ) {}

  /**
   * Creates the order and attaches it to the payment exactly once. Returns the current payment
   * row (its order id may come from a concurrent retry that attached first).
   */
  async ensureOrder(
    payment: Payment,
    mayAlreadyExist: boolean,
    notes: Readonly<Record<string, string>>,
  ): Promise<Payment> {
    const order = await this.obtainOrder(payment, mayAlreadyExist, notes);
    const claimed = await this.prisma.withFinancialContext(
      this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'PENDING', razorpayOrderId: null },
        data: { razorpayOrderId: order.id },
      }),
    );
    const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (claimed.count === 0 && current.razorpayOrderId !== order.id) {
      // A concurrent retry attached its own order first. Ours is never shown to anyone and
      // Razorpay orders cost nothing, so it simply stays unused.
      this.logger.warn(
        { paymentId: payment.id, unusedOrderId: order.id },
        'Concurrent request attached a different order',
      );
    }
    return current;
  }

  /**
   * Creates the Razorpay order, or recovers one created by an earlier attempt whose response was
   * lost (receipt = our payment id). Definitive rejections mark the payment FAILED; temporary
   * failures leave it PENDING so the client can retry with the same Idempotency-Key.
   */
  private async obtainOrder(
    payment: Payment,
    mayAlreadyExist: boolean,
    notes: Readonly<Record<string, string>>,
  ): Promise<RazorpayOrder> {
    try {
      if (mayAlreadyExist) {
        const recovered = await this.gateway.findOrderByReceipt(payment.id);
        if (recovered) {
          return this.assertOrderMatches(recovered, payment);
        }
      }
      const order = await this.gateway.createOrder({
        amountPaise: Number(payment.amountPaise),
        receipt: payment.id,
        notes,
      });
      return this.assertOrderMatches(order, payment);
    } catch (error) {
      if (error instanceof RazorpayApiError) {
        const recovered = await this.gateway.findOrderByReceipt(payment.id).catch(() => null);
        if (recovered) {
          return this.assertOrderMatches(recovered, payment);
        }
        await this.prisma.withFinancialContext(
          this.prisma.payment.updateMany({
            where: { id: payment.id, status: 'PENDING', razorpayOrderId: null },
            data: { status: 'FAILED' },
          }),
        );
        this.logger.error(
          { paymentId: payment.id, status: error.httpStatus, code: error.errorCode },
          'Razorpay rejected order creation',
        );
      }
      if (error instanceof RazorpayApiError || error instanceof RazorpayUnavailableError) {
        throw toProviderAppError(error);
      }
      throw error;
    }
  }

  private assertOrderMatches(order: RazorpayOrder, payment: Payment): RazorpayOrder {
    if (
      order.amount !== Number(payment.amountPaise) ||
      order.currency !== payment.currency ||
      order.receipt !== payment.id
    ) {
      this.logger.error(
        { paymentId: payment.id, orderId: order.id, alert: 'PAYMENT_ANOMALY' },
        'Razorpay order does not match the payment record',
      );
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        HttpStatus.BAD_GATEWAY,
        'Payment provider returned an unexpected order',
      );
    }
    return order;
  }
}
