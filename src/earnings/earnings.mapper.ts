import { paiseToNumber } from '../common/money';
import type {
  AdminEarningResponse,
  EarningResponse,
  EarningSourceView,
  EarningSummaryResponse,
} from './earnings.dto';
import { onlineSettlementProgress } from './earning-funding';
import type { EarningSummary, EarningWithSources } from './earnings.service';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * How much of the earning's online money is settled. One source: its single settlement link.
 * Several collections: each online collection's own settlement (payment flow Phase 5).
 */
function settlementOf(earning: EarningWithSources): {
  merchantSettled: boolean;
  onlineSettledPaise: bigint;
} {
  if (earning.settlement === 'CASH') {
    return { merchantSettled: false, onlineSettledPaise: 0n };
  }
  if (earning.paymentId !== null || earning.collectionId !== null) {
    const settled = earning.paymentSettlementId !== null;
    return {
      merchantSettled: settled,
      onlineSettledPaise: settled ? earning.onlineCollectedPaise : 0n,
    };
  }
  const progress = onlineSettlementProgress(
    earning.collectionLinks.map((link) => ({
      collectionId: link.collectionId,
      method: link.method,
      amountPaise: link.amountPaise,
      settledAt: link.collection.settlement?.settledAt ?? null,
    })),
  );
  return {
    merchantSettled: progress.fullySettled,
    onlineSettledPaise: progress.onlineSettledPaise,
  };
}

export function toEarningResponse(earning: EarningWithSources): EarningResponse {
  const settlement = settlementOf(earning);
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
    cashCollectedPaise: paiseToNumber(earning.cashCollectedPaise),
    onlineCollectedPaise: paiseToNumber(earning.onlineCollectedPaise),
    cashFeePaise: paiseToNumber(earning.cashFeePaise),
    onlineFeePaise: paiseToNumber(earning.onlineFeePaise),
    netCashPaise: paiseToNumber(earning.cashCollectedPaise - earning.cashFeePaise),
    netOnlinePaise: paiseToNumber(earning.onlineCollectedPaise - earning.onlineFeePaise),
    payoutAmountPaise: paiseToNumber(earning.payoutAmountPaise),
    onlineSettledPaise: paiseToNumber(settlement.onlineSettledPaise),
    merchantSettled: settlement.merchantSettled,
    payableAt: iso(earning.payableAt),
    paidAt: iso(earning.paidAt),
    holdReason: earning.holdReason,
    createdAt: earning.createdAt.toISOString(),
  };
}

export function toEarningSourceView(
  link: EarningWithSources['collectionLinks'][number],
): EarningSourceView {
  const settlement = link.method === 'ONLINE_QR' ? link.collection.settlement : null;
  return {
    collectionId: link.collectionId,
    stopSequence: link.collection.bookingStop?.sequence ?? null,
    method: link.method,
    amountPaise: paiseToNumber(link.amountPaise),
    platformFeePaise: paiseToNumber(link.platformFeePaise),
    netAmountPaise: paiseToNumber(link.netAmountPaise),
    settled: settlement !== null,
    settlementId: settlement?.id ?? null,
    providerSettlementId: settlement?.providerSettlementId ?? null,
    settledAt: iso(settlement?.settledAt ?? null),
  };
}

export function toAdminEarningResponse(earning: EarningWithSources): AdminEarningResponse {
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
    sources: earning.collectionLinks.map(toEarningSourceView),
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
