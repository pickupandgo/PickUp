import { paiseToNumber } from '../common/money';
import type { DriverEarning } from '../generated/prisma/client';
import type { AdminEarningResponse, EarningResponse, EarningSummaryResponse } from './earnings.dto';
import type { EarningSummary } from './earnings.service';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toEarningResponse(earning: DriverEarning): EarningResponse {
  return {
    earningId: earning.id,
    bookingId: earning.bookingId,
    tripId: earning.tripId,
    settlement: earning.settlement,
    status: earning.status,
    grossAmountPaise: paiseToNumber(earning.grossAmountPaise),
    platformFeePaise: paiseToNumber(earning.platformFeePaise),
    otherDeductionsPaise: paiseToNumber(earning.otherDeductionsPaise),
    tdsAmountPaise: paiseToNumber(earning.tdsAmountPaise),
    tdsPolicy: earning.tdsPolicy,
    netAmountPaise: paiseToNumber(earning.netAmountPaise),
    merchantSettled: earning.paymentSettlementId !== null,
    payableAt: iso(earning.payableAt),
    paidAt: iso(earning.paidAt),
    holdReason: earning.holdReason,
    createdAt: earning.createdAt.toISOString(),
  };
}

export function toAdminEarningResponse(earning: DriverEarning): AdminEarningResponse {
  return {
    ...toEarningResponse(earning),
    driverId: earning.driverId,
    feeRuleId: earning.feeRuleId,
    taxRuleId: earning.taxRuleId,
    paymentId: earning.paymentId,
    collectionId: earning.collectionId,
    paymentSettlementId: earning.paymentSettlementId,
    heldAt: iso(earning.heldAt),
    heldByUserId: earning.heldByUserId,
  };
}

export function toEarningSummaryResponse(summary: EarningSummary): EarningSummaryResponse {
  return {
    awaitingSettlementPaise: paiseToNumber(summary.awaitingSettlementPaise),
    payablePaise: paiseToNumber(summary.payablePaise),
    inPayoutPaise: paiseToNumber(summary.inPayoutPaise),
    onHoldPaise: paiseToNumber(summary.onHoldPaise),
    paidPaise: paiseToNumber(summary.paidPaise),
    settledInCashPaise: paiseToNumber(summary.settledInCashPaise),
    grossPaise: paiseToNumber(summary.grossPaise),
    platformFeePaise: paiseToNumber(summary.platformFeePaise),
    tripCount: summary.tripCount,
  };
}
