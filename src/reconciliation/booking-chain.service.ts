import { HttpStatus, Injectable } from '@nestjs/common';
import { toAdminBookingStopView } from '../bookings/bookings.mapper';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { paiseToNumber } from '../common/money';
import { toEarningResponse, toEarningSourceView } from '../earnings/earnings.mapper';
import { EARNING_SOURCES } from '../earnings/earnings.service';
import type { PaymentSettlement } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);
const paise = (value: bigint | null | undefined): number | null =>
  value === null || value === undefined ? null : paiseToNumber(value);

/**
 * The whole money trail of one booking, for finance and support: confirmed fare and fee rule,
 * customer payment or collection, wallet fee debit, driver earning, and the payout that carried
 * it (batch, provider payout id, UTR, status). Answers "was the driver paid for this trip, how
 * much, when and through which transfer" from the database alone.
 */
@Injectable()
export class BookingChainService {
  constructor(private readonly prisma: PrismaService) {}

  async get(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        feeRule: true,
        trip: true,
        stops: { orderBy: { sequence: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
        collections: {
          orderBy: { createdAt: 'asc' },
          include: { walletTransaction: true, settlement: true, earningLink: true },
        },
        disputes: true,
        settlements: { orderBy: [{ settledAt: 'asc' }, { createdAt: 'asc' }] },
        earning: {
          include: {
            payoutItems: {
              orderBy: { createdAt: 'asc' },
              include: { payout: { include: { batch: true } } },
            },
            ...EARNING_SOURCES,
          },
        },
      },
    });
    if (!booking) {
      throw new AppError(ErrorCode.BOOKING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Booking not found');
    }
    const { earning } = booking;
    const activeItem = earning?.payoutItems.find(
      (item) => item.status === 'INCLUDED' || item.status === 'PAID',
    );

    return {
      booking: {
        bookingId: booking.id,
        externalRef: booking.externalRef,
        status: booking.status,
        paymentMethod: booking.paymentMethod,
        paymentStatus: booking.paymentStatus,
        paymentModel: booking.paymentModel,
        confirmedFarePaise: paiseToNumber(booking.fareEstimateMinor),
        finalFarePaise: paiseToNumber(booking.finalFareMinor),
        confirmedAt: booking.confirmedAt.toISOString(),
        completedAt: iso(booking.completedAt),
        cancelledAt: iso(booking.cancelledAt),
      },
      feeRule: {
        feeRuleId: booking.feeRule.id,
        category: booking.feeRule.category,
        ruleType: booking.feeRule.ruleType,
        value: booking.feeRule.value.toFixed(4),
        roundingMode: booking.feeRule.roundingMode,
      },
      trip: booking.trip
        ? {
            tripId: booking.trip.id,
            driverId: booking.trip.driverId,
            status: booking.trip.status,
            deliveredAt: iso(booking.trip.deliveredAt),
            paymentConfirmedAt: iso(booking.trip.paymentConfirmedAt),
            completedAt: iso(booking.trip.completedAt),
          }
        : null,
      /** Each drop with every lifecycle fact (bookings priced per drop; none for historical ones). */
      stops: booking.stops.map(toAdminBookingStopView),
      customerPayments: booking.payments.map((payment) => ({
        paymentId: payment.id,
        status: payment.status,
        amountPaise: paiseToNumber(payment.amountPaise),
        razorpayOrderId: payment.razorpayOrderId,
        razorpayPaymentId: payment.razorpayPaymentId,
        paymentMethod: payment.paymentMethod,
        createdAt: payment.createdAt.toISOString(),
      })),
      collections: booking.collections.map((collection) => ({
        collectionId: collection.id,
        stage: collection.stage,
        /** The drop it paid for (a booking paid drop by drop); null for the whole booking. */
        stopSequence: collection.bookingStopId
          ? (booking.stops.find((stop) => stop.id === collection.bookingStopId)?.sequence ?? null)
          : null,
        method: collection.method,
        status: collection.status,
        amountPaise: paiseToNumber(collection.amountPaise),
        platformFeePaise: paise(collection.platformFeePaise),
        providerProduct: collection.providerProduct,
        providerReferenceId: collection.providerReferenceId,
        providerPaymentId: collection.providerPaymentId,
        walletDebit: collection.walletTransaction
          ? {
              walletTransactionId: collection.walletTransaction.id,
              amountPaise: paiseToNumber(collection.walletTransaction.amountPaise),
              balanceAfterPaise: paiseToNumber(collection.walletTransaction.balanceAfterPaise),
              createdAt: collection.walletTransaction.createdAt.toISOString(),
            }
          : null,
        failureReason: collection.failureReason,
        completedAt: iso(collection.completedAt),
        /** Online only: Razorpay's settlement of this collection to Nikhil Enterprises, once known. */
        settlement: collection.settlement ? settlementView(collection.settlement) : null,
        /** The earning it funds, once the trip completed. */
        earningId: collection.earningLink?.earningId ?? null,
      })),
      disputes: booking.disputes.map((dispute) => ({
        providerDisputeId: dispute.providerDisputeId,
        providerPaymentId: dispute.providerPaymentId,
        status: dispute.status,
        amountPaise: paiseToNumber(dispute.amountPaise),
      })),
      /**
       * The booking's first merchant settlement, kept for older readers. A booking paid drop by
       * drop can have one per online collection: see merchantSettlements.
       */
      merchantSettlement: booking.settlements[0] ? settlementView(booking.settlements[0]) : null,
      /** Every merchant settlement of the booking's payments, one per settled payment. */
      merchantSettlements: booking.settlements.map(settlementView),
      earning: earning
        ? (() => {
            const view = toEarningResponse(earning);
            return {
              earningId: earning.id,
              settlement: earning.settlement,
              status: earning.status,
              grossAmountPaise: paiseToNumber(earning.grossAmountPaise),
              platformFeePaise: paiseToNumber(earning.platformFeePaise),
              otherDeductionsPaise: paiseToNumber(earning.otherDeductionsPaise),
              tdsAmountPaise: paiseToNumber(earning.tdsAmountPaise),
              tdsPolicy: earning.tdsPolicy,
              taxRuleId: earning.taxRuleId,
              netAmountPaise: paiseToNumber(earning.netAmountPaise),
              /** Where the money is: cash with the driver, online with Nikhil Enterprises. */
              cashCollectedPaise: view.cashCollectedPaise,
              onlineCollectedPaise: view.onlineCollectedPaise,
              cashFeePaise: view.cashFeePaise,
              onlineFeePaise: view.onlineFeePaise,
              netCashPaise: view.netCashPaise,
              netOnlinePaise: view.netOnlinePaise,
              /** What a payout carries for this earning. */
              payoutAmountPaise: view.payoutAmountPaise,
              onlineSettledPaise: view.onlineSettledPaise,
              /**
               * Every collection that funds the earning, with its method, amount, fee share and
               * settlement state (none for a prepaid earning, or one recorded before collections
               * were linked).
               */
              collections: earning.collectionLinks.map(toEarningSourceView),
              /** True once every online payment of the earning is settled. */
              merchantSettled: view.merchantSettled,
              paymentSettlementId: earning.paymentSettlementId,
              payableAt: iso(earning.payableAt),
              paidAt: iso(earning.paidAt),
              holdReason: earning.holdReason,
              /** True only when a processed payout carried this earning. */
              paidOut: earning.status === 'PAID',
              /** Every payout that carried the earning, failed ones included, with its amount. */
              payoutHistory: earning.payoutItems.map((item) => ({
                payoutItemStatus: item.status,
                payoutItemAmountPaise: paiseToNumber(item.amountPaise),
                payoutId: item.payout.id,
                payoutStatus: item.payout.status,
                providerPayoutId: item.payout.providerPayoutId,
                utr: item.payout.utr,
                batchId: item.payout.batch.id,
                cycleKey: item.payout.batch.cycleKey,
                processedAt: iso(item.payout.processedAt),
                failedAt: iso(item.payout.failedAt),
                failureReason: item.payout.failureReason,
              })),
              currentPayoutId: activeItem?.payout.id ?? null,
            };
          })()
        : null,
    };
  }
}

function settlementView(settlement: PaymentSettlement) {
  return {
    settlementId: settlement.id,
    providerPaymentId: settlement.providerPaymentId,
    providerSettlementId: settlement.providerSettlementId,
    settlementUtr: settlement.settlementUtr,
    settledAt: settlement.settledAt.toISOString(),
    amountPaise: paiseToNumber(settlement.amountPaise),
    feePaise: paiseToNumber(settlement.feePaise),
    taxPaise: paiseToNumber(settlement.taxPaise),
    /** The online collection settled (null for a prepaid booking payment). */
    collectionId: settlement.collectionId,
    paymentId: settlement.paymentId,
    source: settlement.source,
    recordedAt: settlement.createdAt.toISOString(),
  };
}
