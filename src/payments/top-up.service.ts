import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { numberToPaise } from '../common/money';
import type { DriverWallet, Payment } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { isValidCheckoutSignature } from '../razorpay/razorpay-signatures';
import { WalletService } from '../wallet/wallet.service';
import { ANOMALY_OUTCOMES, PaymentPurpose } from './payment.constants';
import { PaymentConfirmationService } from './payment-confirmation.service';
import { PaymentOrderService } from './payment-orders.service';
import type { VerifyTopUpRequest } from './payments.dto';
import { toProviderAppError } from './provider-errors';

export interface VerifyResult {
  readonly payment: Payment;
  readonly providerStatus: string;
  readonly wallet: DriverWallet | null;
}

/**
 * Driver wallet top-ups (PW 4): the server creates the Razorpay order for a server-validated
 * amount, the app pays through Razorpay Checkout, and the wallet is credited only after the
 * server has verified the payment with Razorpay (verify call, webhook or admin sync).
 */
@Injectable()
export class TopUpService {
  private readonly logger = new Logger(TopUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: PaymentOrderService,
    private readonly wallets: WalletService,
    private readonly confirmation: PaymentConfirmationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates (or, for a repeated Idempotency-Key, returns) a pending top-up and its Razorpay
   * order. Retrying with the same key never creates a second payment record.
   */
  async createTopUp(
    principal: Principal,
    idempotencyKey: string,
    amountPaise: number,
  ): Promise<Payment> {
    const driver = requireDriver(principal);
    if (driver.approvalStatus !== 'APPROVED') {
      throw new AppError(
        ErrorCode.DRIVER_NOT_APPROVED,
        HttpStatus.FORBIDDEN,
        'Only approved drivers can add money to their wallet',
      );
    }

    const amount = numberToPaise(amountPaise);
    const { topUpMinPaise, topUpMaxPaise } = this.config.wallet;
    if (amount < topUpMinPaise || amount > topUpMaxPaise) {
      throw new AppError(
        ErrorCode.AMOUNT_OUT_OF_RANGE,
        HttpStatus.BAD_REQUEST,
        'Top-up amount is out of range',
        {
          minPaise: Number(topUpMinPaise),
          maxPaise: Number(topUpMaxPaise),
        },
      );
    }

    const wallet = await this.wallets.ensureWalletForDriver(driver.id);
    if (wallet.status === 'BLOCKED') {
      throw new AppError(ErrorCode.WALLET_BLOCKED, HttpStatus.CONFLICT, 'This wallet is blocked');
    }

    const { payment, created } = await this.findOrCreatePayment(
      principal.userId,
      idempotencyKey,
      amount,
    );
    if (payment.purpose !== PaymentPurpose.DRIVER_WALLET_TOPUP || payment.amountPaise !== amount) {
      throw new AppError(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        HttpStatus.CONFLICT,
        'This idempotency key was already used for a different request',
      );
    }
    if (payment.razorpayOrderId) {
      return payment;
    }
    if (payment.status !== 'PENDING') {
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        HttpStatus.BAD_GATEWAY,
        'This top-up could not be started. Start a new one with a new Idempotency-Key',
        { paymentId: payment.id },
      );
    }

    // No database locks are held while talking to Razorpay.
    const current = await this.orders.ensureOrder(payment, !created, {
      payment_id: payment.id,
      purpose: payment.purpose,
    });
    this.logger.log(
      { paymentId: current.id, orderId: current.razorpayOrderId, amountPaise },
      'Wallet top-up order created',
    );
    return current;
  }

  async getTopUp(principal: Principal, paymentId: string): Promise<Payment> {
    return this.findOwnedTopUp(principal.userId, paymentId);
  }

  /**
   * Checks the Checkout signature, then confirms the payment state with Razorpay itself before
   * crediting. The app's "success" callback alone never credits a wallet.
   */
  async verifyTopUp(
    principal: Principal,
    paymentId: string,
    body: VerifyTopUpRequest,
  ): Promise<VerifyResult> {
    const payment = await this.findOwnedTopUp(principal.userId, paymentId);
    if (!payment.razorpayOrderId || payment.razorpayOrderId !== body.razorpayOrderId) {
      throw new AppError(
        ErrorCode.PAYMENT_ORDER_MISMATCH,
        HttpStatus.BAD_REQUEST,
        'This payment does not belong to this top-up',
      );
    }

    const signatureValid = isValidCheckoutSignature({
      orderId: payment.razorpayOrderId, // from our database, never from the request
      paymentId: body.razorpayPaymentId,
      signature: body.razorpaySignature,
      keySecret: this.config.razorpay.keySecret,
    });
    if (!signatureValid) {
      this.logger.warn(
        { paymentId, userId: principal.userId },
        'Rejected top-up verification with an invalid signature',
      );
      throw new AppError(
        ErrorCode.INVALID_PAYMENT_SIGNATURE,
        HttpStatus.BAD_REQUEST,
        'Payment signature is invalid',
      );
    }

    let result;
    try {
      result = await this.confirmation.confirm(payment.id, body.razorpayPaymentId, {
        source: 'CHECKOUT_VERIFY',
      });
    } catch (error) {
      throw toProviderAppError(error);
    }

    if (ANOMALY_OUTCOMES.has(result.outcome)) {
      throw new AppError(
        ErrorCode.PAYMENT_VERIFICATION_FAILED,
        HttpStatus.CONFLICT,
        'This payment could not be applied automatically. Support has been alerted',
        { paymentId: payment.id },
      );
    }

    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const wallet =
      fresh.status === 'PAID'
        ? await this.wallets.findWalletByDriver(requireDriver(principal).id)
        : null;
    return { payment: fresh, providerStatus: result.providerStatus, wallet };
  }

  private async findOwnedTopUp(userId: string, paymentId: string): Promise<Payment> {
    // Ownership is part of the query, so another user's payment id behaves like a missing one.
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId, purpose: PaymentPurpose.DRIVER_WALLET_TOPUP },
    });
    if (!payment) {
      throw new AppError(ErrorCode.PAYMENT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Top-up not found');
    }
    return payment;
  }

  private async findOrCreatePayment(
    userId: string,
    idempotencyKey: string,
    amount: bigint,
  ): Promise<{ payment: Payment; created: boolean }> {
    const where = { userId_idempotencyKey: { userId, idempotencyKey } };
    const existing = await this.prisma.payment.findUnique({ where });
    if (existing) {
      return { payment: existing, created: false };
    }
    try {
      const payment = await this.prisma.withFinancialContext(
        this.prisma.payment.create({
          data: {
            userId,
            purpose: PaymentPurpose.DRIVER_WALLET_TOPUP,
            amountPaise: amount,
            idempotencyKey,
          },
        }),
      );
      return { payment, created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent request with the same key won the insert.
        return { payment: await this.prisma.payment.findUniqueOrThrow({ where }), created: false };
      }
      throw error;
    }
  }
}
