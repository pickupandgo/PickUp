import type { EarningSettlement } from '../generated/prisma/enums';

/** One collection that funds an earning, with the platform fee on it. */
export interface FundingCollection {
  readonly collectionId: string;
  readonly method: 'CASH' | 'ONLINE_QR';
  readonly amountPaise: bigint;
  /** Cash: the fee debited from the wallet for it. Online: the fee share owed on it. */
  readonly platformFeePaise: bigint;
}

/** How a trip's collections fund its earning (payment flow Phase 4). */
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
}

/**
 * Splits a trip's completed collections into the earning they fund. One collection keeps today's
 * single-source earning; several (a booking paid drop by drop) fund one earning together, each
 * collection's source, amount and fee kept on its own row. The database checks the same sums and
 * settlement (check_earning_sources).
 */
export function earningFunding(collections: readonly FundingCollection[]): EarningFunding {
  const [first, ...rest] = collections;
  if (!first) {
    throw new Error('An earning needs at least one completed collection');
  }
  const cash = collections.some((collection) => collection.method === 'CASH');
  const online = collections.some((collection) => collection.method === 'ONLINE_QR');
  return {
    grossPaise: collections.reduce((sum, collection) => sum + collection.amountPaise, 0n),
    platformFeePaise: collections.reduce(
      (sum, collection) => sum + collection.platformFeePaise,
      0n,
    ),
    settlement: cash && online ? 'MIXED' : cash ? 'CASH' : 'ONLINE',
    collectionId: rest.length === 0 ? first.collectionId : null,
    collections,
  };
}
