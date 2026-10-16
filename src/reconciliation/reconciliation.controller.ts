import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminOnly } from '../auth/decorators';
import { BookingChainService } from './booking-chain.service';
import {
  type DriverPayableSummary,
  EarningsReconciliationService,
  type Finding,
} from './earnings-reconciliation.service';
import {
  type DuplicateProviderPayment,
  type PendingPaymentSummary,
  ReconciliationService,
  type WalletMismatch,
  type WebhookEventSummary,
} from './reconciliation.service';

export class PendingPaymentsQuery {
  /** Only list payments created more than this many minutes ago. Defaults to 30. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_080)
  olderThanMinutes?: number;
}

/** Finance and ops integrity reports. Every list should normally be empty. */
@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin', version: '1' })
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly earnings: EarningsReconciliationService,
    private readonly chains: BookingChainService,
  ) {}

  /** Wallets whose balance does not equal their ledger. */
  @Get('reconciliation/wallet-mismatches')
  walletMismatches(): Promise<WalletMismatch[]> {
    return this.reconciliation.findWalletMismatches();
  }

  /** Verified Razorpay webhooks not processed yet. */
  @Get('reconciliation/unprocessed-webhooks')
  unprocessedWebhooks(): Promise<WebhookEventSummary[]> {
    return this.reconciliation.findUnprocessedWebhooks();
  }

  /** Webhooks that were processed but recorded a problem needing manual review. */
  @Get('reconciliation/webhook-anomalies')
  webhookAnomalies(): Promise<WebhookEventSummary[]> {
    return this.reconciliation.findWebhookAnomalies();
  }

  /** Payments still waiting for confirmation. */
  @Get('reconciliation/pending-payments')
  pendingPayments(@Query() query: PendingPaymentsQuery): Promise<PendingPaymentSummary[]> {
    return this.reconciliation.findPendingPayments(query.olderThanMinutes ?? 30);
  }

  /** Provider payment ids that appear on more than one ledger entry. */
  @Get('reconciliation/duplicate-provider-payments')
  duplicateProviderPayments(): Promise<DuplicateProviderPayment[]> {
    return this.reconciliation.findDuplicateProviderPayments();
  }

  /** Earnings that disagree with their booking, trip or payout items. */
  @Get('reconciliation/earning-mismatches')
  earningMismatches(): Promise<Finding[]> {
    return this.earnings.findEarningMismatches();
  }

  /** Payouts that disagree with their items or are stuck. */
  @Get('reconciliation/payout-mismatches')
  payoutMismatches(): Promise<Finding[]> {
    return this.earnings.findPayoutMismatches();
  }

  @Get('reconciliation/failed-payouts')
  failedPayouts(): Promise<Finding[]> {
    return this.earnings.findFailedPayouts();
  }

  /** Cancelled bookings that were paid, for what is not refunded yet: refund review. */
  @Get('reconciliation/paid-cancelled-bookings')
  paidCancelledBookings(): Promise<Finding[]> {
    return this.earnings.findPaidCancelledBookings();
  }

  /**
   * Refunds that need a human: stuck at the provider, refunded after a payout or on a cash
   * earning (L-21, nothing recovered automatically), or totals that disagree (Phase 6).
   */
  @Get('reconciliation/refund-anomalies')
  refundAnomalies(): Promise<Finding[]> {
    return this.earnings.findRefundAnomalies();
  }

  /** Cash collections whose platform fee and wallet debit disagree. */
  /** Settled payments that matched none of ours, or another amount: never applied (Phase 5). */
  @Get('reconciliation/settlement-anomalies')
  settlementAnomalies(): Promise<Finding[]> {
    return this.earnings.findSettlementAnomalies();
  }

  @Get('reconciliation/cash-fee-mismatches')
  cashFeeMismatches(): Promise<Finding[]> {
    return this.earnings.findCashFeeMismatches();
  }

  /** QR collections still pending after expiry. */
  @Get('reconciliation/stale-collections')
  staleCollections(): Promise<Finding[]> {
    return this.earnings.findStaleCollections();
  }

  /** Drivers owed money who have no verified bank account. */
  @Get('reconciliation/payable-without-bank-account')
  payableWithoutBankAccount(): Promise<DriverPayableSummary[]> {
    return this.earnings.findPayableWithoutBankAccount();
  }

  @Get('reconciliation/unprocessed-payout-webhooks')
  unprocessedPayoutWebhooks(): Promise<Finding[]> {
    return this.earnings.findUnprocessedPayoutWebhooks();
  }

  @Get('reconciliation/payout-webhook-anomalies')
  payoutWebhookAnomalies(): Promise<Finding[]> {
    return this.earnings.findPayoutWebhookAnomalies();
  }

  /** The full money trail of one booking: payment, fee, earning, payout. */
  @Get('bookings/:bookingId')
  bookingChain(@Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string) {
    return this.chains.get(bookingId);
  }
}
