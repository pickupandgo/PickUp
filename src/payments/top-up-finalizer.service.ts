import { Injectable } from '@nestjs/common';
import type { PaymentStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { RazorpayPayment } from '../razorpay/razorpay.types';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';
import { WalletService } from '../wallet/wallet.service';
import {
  type ConfirmationOutcome,
  ConfirmationOutcome as Outcome,
  type ConfirmationSource,
  PAYMENT_PROVIDER_RAZORPAY,
  PaymentPurpose,
} from './payment.constants';
import { normalizeMethod } from './payment-method';

export interface FinalizeContext {
  readonly source: ConfirmationSource;
  readonly providerEventId?: string;
}

interface LockedPaymentRow {
  readonly id: string;
  readonly status: PaymentStatus;
  readonly amount_paise: bigint;
  readonly currency: string;
  readonly razorpay_order_id: string | null;
  readonly razorpay_payment_id: string | null;
}

/**
 * Applies a captured, already-verified Razorpay payment to the driver's wallet exactly once
 * (PW 4.3). Runs entirely inside one transaction:
 *
 *   lock wallet -> lock payment -> re-check status, order and amount -> ledger credit -> mark PAID
 *
 * Lock order follows PW 3.3 (wallet before payment rows) everywhere it is used.
 */
@Injectable()
export class TopUpFinalizerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly wallets: WalletService,
  ) {}

  async finalizeCapturedTopUp(
    paymentId: string,
    providerPayment: RazorpayPayment,
    context: FinalizeContext,
  ): Promise<ConfirmationOutcome> {
    const owner = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { purpose: true, user: { select: { driver: { select: { id: true } } } } },
    });
    const driverId = owner.user.driver?.id;
    if (owner.purpose !== PaymentPurpose.DRIVER_WALLET_TOPUP || !driverId) {
      throw new Error('Payment is not a driver wallet top-up');
    }
    // Normally created when the top-up started; ensured again so a credit is never lost.
    const wallet = await this.wallets.ensureWalletForDriver(driverId);

    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM driver_wallets WHERE id = ${wallet.id}::uuid FOR UPDATE`;
      const [locked] = await tx.$queryRaw<LockedPaymentRow[]>`
        SELECT id, status, amount_paise, currency, razorpay_order_id, razorpay_payment_id
        FROM payments
        WHERE id = ${paymentId}::uuid
        FOR UPDATE`;
      if (!locked) {
        throw new Error('Payment disappeared during finalization');
      }
      // Raw rows are an unchecked type cast; pin the amount to bigint before comparing.
      const orderAmount = BigInt(locked.amount_paise);

      if (locked.status === 'PAID') {
        return locked.razorpay_payment_id === providerPayment.id
          ? Outcome.ALREADY_APPLIED
          : Outcome.DUPLICATE_ORDER_PAYMENT;
      }
      if (locked.status !== 'PENDING') {
        return Outcome.PAYMENT_NOT_PENDING;
      }
      if (!locked.razorpay_order_id || locked.razorpay_order_id !== providerPayment.orderId) {
        return Outcome.ORDER_MISMATCH;
      }
      if (
        providerPayment.currency !== locked.currency ||
        BigInt(providerPayment.amount) !== orderAmount
      ) {
        return Outcome.AMOUNT_MISMATCH;
      }

      await this.ledger.postEntry(tx, {
        walletId: wallet.id,
        type: 'TOPUP',
        direction: 'CREDIT',
        amountPaise: orderAmount,
        referenceType: 'RAZORPAY_PAYMENT',
        referenceId: providerPayment.id,
        idempotencyKey: `razorpay-topup:${providerPayment.id}`,
        provider: PAYMENT_PROVIDER_RAZORPAY,
        providerOrderId: locked.razorpay_order_id,
        providerPaymentId: providerPayment.id,
        providerEventId: context.providerEventId,
        metadata: { paymentId, source: context.source },
      });

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          razorpayPaymentId: providerPayment.id,
          paymentMethod: normalizeMethod(providerPayment.method),
        },
      });
      return Outcome.APPLIED;
    });
  }
}
