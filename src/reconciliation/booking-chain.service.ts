import { HttpStatus, Injectable } from '@nestjs/common';
import { toAdminBookingStopView } from '../bookings/bookings.mapper';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { paiseToNumber } from '../common/money';
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
        collections: { orderBy: { createdAt: 'asc' }, include: { walletTransaction: true } },
        disputes: true,
        settlements: { orderBy: { createdAt: 'asc' } },
        earning: {
          include: {
            payoutItems: {
              orderBy: { createdAt: 'asc' },
              include: { payout: { include: { batch: true } } },
            },
            collectionLinks: { orderBy: { createdAt: 'asc' } },
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
      })),
      disputes: booking.disputes.map((dispute) => ({
        providerDisputeId: dispute.providerDisputeId,
        providerPaymentId: dispute.providerPaymentId,
        status: dispute.status,
        amountPaise: paiseToNumber(dispute.amountPaise),
      })),
      /** Razorpay's settlement of the customer payment to Nikhil Enterprises, once known. */
      merchantSettlement: (() => {
        const settlement = booking.settlements[0];
        return settlement
          ? {
              settlementId: settlement.id,
              providerPaymentId: settlement.providerPaymentId,
              providerSettlementId: settlement.providerSettlementId,
              settlementUtr: settlement.settlementUtr,
              settledAt: settlement.settledAt.toISOString(),
              amountPaise: paiseToNumber(settlement.amountPaise),
              feePaise: paiseToNumber(settlement.feePaise),
              taxPaise: paiseToNumber(settlement.taxPaise),
              source: settlement.source,
              recordedAt: settlement.createdAt.toISOString(),
            }
          : null;
      })(),
      earning: earning
        ? {
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
            /**
             * Every collection that funds the earning, with its method, amount and fee share (none
             * for a prepaid earning, or one recorded before collections were linked).
             */
            collections: earning.collectionLinks.map((link) => ({
              collectionId: link.collectionId,
              method: link.method,
              amountPaise: paiseToNumber(link.amountPaise),
              platformFeePaise: paiseToNumber(link.platformFeePaise),
            })),
            /** ONLINE: true once the customer payment's merchant settlement is recorded. */
            merchantSettled: earning.paymentSettlementId !== null,
            paymentSettlementId: earning.paymentSettlementId,
            payableAt: iso(earning.payableAt),
            paidAt: iso(earning.paidAt),
            holdReason: earning.holdReason,
            /** True only when a processed payout carried this earning. */
            paidOut: earning.status === 'PAID',
            payoutHistory: earning.payoutItems.map((item) => ({
              payoutItemStatus: item.status,
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
          }
        : null,
    };
  }
}
