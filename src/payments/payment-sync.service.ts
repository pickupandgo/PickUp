import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { Payment } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayGateway } from '../razorpay/razorpay.gateway';
import { type RazorpayPayment, RazorpayPaymentState } from '../razorpay/razorpay.types';
import { PaymentPurpose } from './payment.constants';
import { PaymentConfirmationService } from './payment-confirmation.service';
import { toProviderAppError } from './provider-errors';

export interface SyncAttempt {
  readonly providerPaymentId: string;
  readonly providerStatus: string;
  readonly outcome: string;
}

/**
 * Admin recovery for a top-up or booking payment whose webhook never arrived and whose app never
 * called verify: reads the order's payments from Razorpay and runs them through the normal
 * confirmation path.
 */
@Injectable()
export class PaymentSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RazorpayGateway,
    private readonly confirmation: PaymentConfirmationService,
  ) {}

  async getPayment(paymentId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Payment not found');
    }
    return payment;
  }

  async sync(paymentId: string): Promise<{ payment: Payment; attempts: SyncAttempt[] }> {
    const payment = await this.getPayment(paymentId);
    if (
      payment.purpose !== PaymentPurpose.DRIVER_WALLET_TOPUP &&
      payment.purpose !== PaymentPurpose.BOOKING
    ) {
      throw new AppError(
        ErrorCode.PAYMENT_NOT_PAYABLE,
        HttpStatus.CONFLICT,
        'This payment cannot be synced',
      );
    }
    if (!payment.razorpayOrderId) {
      return { payment, attempts: [] };
    }

    let providerPayments: RazorpayPayment[];
    try {
      providerPayments = await this.gateway.fetchOrderPayments(payment.razorpayOrderId);
    } catch (error) {
      throw toProviderAppError(error);
    }

    // Captured payments first, so a real payment is applied before any stray authorization.
    const ordered = [...providerPayments].sort((a, b) => rank(a) - rank(b));
    const attempts: SyncAttempt[] = [];
    for (const providerPayment of ordered) {
      if (
        providerPayment.status !== RazorpayPaymentState.CAPTURED &&
        providerPayment.status !== RazorpayPaymentState.AUTHORIZED
      ) {
        attempts.push({
          providerPaymentId: providerPayment.id,
          providerStatus: providerPayment.status,
          outcome: 'SKIPPED',
        });
        continue;
      }
      try {
        const result = await this.confirmation.confirm(payment.id, providerPayment.id, {
          source: 'ADMIN_SYNC',
          knownPayment: providerPayment,
        });
        attempts.push({
          providerPaymentId: providerPayment.id,
          providerStatus: result.providerStatus,
          outcome: result.outcome,
        });
      } catch (error) {
        throw toProviderAppError(error);
      }
    }

    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { payment: fresh, attempts };
  }
}

function rank(payment: RazorpayPayment): number {
  if (payment.status === RazorpayPaymentState.CAPTURED) {
    return 0;
  }
  return payment.status === RazorpayPaymentState.AUTHORIZED ? 1 : 2;
}
