import type { EarningSettlement } from '../generated/prisma/enums';

/** One collection that funds an earning, with the platform fee on it. */
export interface FundingCollection {
  readonly collectionId: string;
  readonly method: 'CASH' | 'ONLINE_QR';
  readonly amountPaise: bigint;
  /** Cash: the fee debited from the wallet for it. Online: the fee share owed on it. */
  readonly platformFeePaise: bigint;
}

/**
 * Where an earning's money is and what a payout owes (payment flow Phase 5). Cash is already in
 * the driver's hand, its fee debited from the wallet; online money is with Nikhil Enterprises,
 * and its net is what a payout carries once every online collection is settled.
 */
export interface EarningSplit {
  readonly cashCollectedPaise: bigint;
  readonly onlineCollectedPaise: bigint;
  readonly cashFeePaise: bigint;
  readonly onlineFeePaise: bigint;
  /** Payout amount: 0 for CASH, the net for ONLINE, the online part net of its fee for MIXED. */
  readonly payoutAmountPaise: bigint;
}

/** How a trip's collections fund its earning (payment flow Phases 4 and 5). */
export interface EarningFunding {
  /** Everything collected for the trip, in paise. */
  readonly grossPaise: bigint;
  /** The platform fee on everything collected. */
  readonly platformFeePaise: bigint;
  /** CASH when every collection was cash, ONLINE when every one was online, else MIXED. */
  readonly settlement: EarningSettlement;
  /** The collection, when exactly one funds the earning (it is then the earning's own source). */
  readonly collectionId: string | null;
  /** Every funding collection, in the order given: one earning_collections row each. */
  readonly collections: readonly FundingCollection[];
  readonly split: EarningSplit;
}

/**
 * Splits a trip's completed collections into the earning they fund. One collection keeps the
 * single-source earning; several (a booking paid drop by drop) fund one earning together, each
 * collection's source, amount and fee kept on its own row. The database checks the same sums,
 * split and settlement (check_earning_sources, earnings_split_* CHECKs).
 */
export function earningFunding(collections: readonly FundingCollection[]): EarningFunding {
  const [first, ...rest] = collections;
  if (!first) {
    throw new Error('An earning needs at least one completed collection');
  }
  const sum = (method: FundingCollection['method'], field: 'amountPaise' | 'platformFeePaise') =>
    collections
      .filter((collection) => collection.method === method)
      .reduce((total, collection) => total + collection[field], 0n);
  const cashCollected = sum('CASH', 'amountPaise');
  const onlineCollected = sum('ONLINE_QR', 'amountPaise');
  const cashFee = sum('CASH', 'platformFeePaise');
  const onlineFee = sum('ONLINE_QR', 'platformFeePaise');
  const settlement: EarningSettlement =
    cashCollected > 0n && onlineCollected > 0n ? 'MIXED' : onlineCollected > 0n ? 'ONLINE' : 'CASH';
  return {
    grossPaise: cashCollected + onlineCollected,
    platformFeePaise: cashFee + onlineFee,
    settlement,
    collectionId: rest.length === 0 ? first.collectionId : null,
    collections,
    split: {
      cashCollectedPaise: cashCollected,
      onlineCollectedPaise: onlineCollected,
      cashFeePaise: cashFee,
      onlineFeePaise: onlineFee,
      // No deduction exists besides the platform fee (TDS DISABLED, D-57), so every part's net is
      // its amount minus its fee.
      payoutAmountPaise: settlement === 'CASH' ? 0n : onlineCollected - onlineFee,
    },
  };
}

/** A prepaid booking payment: all online, paid out in full net once settled. */
export function prepaidSplit(grossPaise: bigint, platformFeePaise: bigint): EarningSplit {
  return {
    cashCollectedPaise: 0n,
    onlineCollectedPaise: grossPaise,
    cashFeePaise: 0n,
    onlineFeePaise: platformFeePaise,
    payoutAmountPaise: grossPaise - platformFeePaise,
  };
}

/** One source of an earning as stored: a linked collection and whether it has been settled. */
export interface SourceSettlement {
  readonly collectionId: string;
  readonly method: string;
  readonly amountPaise: bigint;
  /** When Razorpay settled it to Nikhil Enterprises; null while unsettled (and always for cash). */
  readonly settledAt: Date | null;
}

/** How much of an earning's online money Razorpay has settled to Nikhil Enterprises. */
export interface OnlineSettlementProgress {
  readonly onlineCollectedPaise: bigint;
  readonly onlineSettledPaise: bigint;
  /** Online collections still waiting for their merchant settlement. */
  readonly unsettledCollectionIds: readonly string[];
  /** True once every online collection is settled (false when there is no online money). */
  readonly fullySettled: boolean;
  /** The latest settlement, once every online collection is settled. */
  readonly settledAt: Date | null;
}

/**
 * Settlement progress of an earning funded by several collections: it becomes payable only once
 * every online collection is settled, never on the first one alone (trg_earnings_settled).
 */
export function onlineSettlementProgress(
  sources: readonly SourceSettlement[],
): OnlineSettlementProgress {
  const online = sources.filter((source) => source.method === 'ONLINE_QR');
  const settled = online.filter((source) => source.settledAt !== null);
  const fullySettled = online.length > 0 && settled.length === online.length;
  return {
    onlineCollectedPaise: online.reduce((total, source) => total + source.amountPaise, 0n),
    onlineSettledPaise: settled.reduce((total, source) => total + source.amountPaise, 0n),
    unsettledCollectionIds: online
      .filter((source) => source.settledAt === null)
      .map((source) => source.collectionId),
    fullySettled,
    settledAt: fullySettled
      ? settled.reduce<Date | null>(
          (latest, source) =>
            latest === null || (source.settledAt as Date) > latest ? source.settledAt : latest,
          null,
        )
      : null,
  };
}
