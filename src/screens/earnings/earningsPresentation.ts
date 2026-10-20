import type { PillVariant } from '../../components/atoms/StatusPill';
import type {
  BankAccountDto,
  EarningStatusDto,
  PayoutStatusDto,
} from '../../services/payments/earningsDto';

/** How each server-side earning state is shown. The app never derives these states. */
export interface StatusView {
  readonly labelKey: string;
  readonly hintKey: string;
  readonly variant: PillVariant;
  readonly icon: string;
}

export const EARNING_STATUS_VIEW: Readonly<
  Record<EarningStatusDto, StatusView>
> = {
  AWAITING_SETTLEMENT: {
    labelKey: 'earnings.awaitingSettlement',
    hintKey: 'earnings.awaitingSettlementHint',
    variant: 'info',
    icon: 'hourglass_empty',
  },
  PAYABLE: {
    labelKey: 'earnings.payable',
    hintKey: 'earnings.payableHint',
    variant: 'success',
    icon: 'savings',
  },
  IN_PAYOUT: {
    labelKey: 'earnings.inPayout',
    hintKey: 'earnings.inPayoutHint',
    variant: 'info',
    icon: 'sync',
  },
  PAID: {
    labelKey: 'earnings.paid',
    hintKey: 'earnings.paidHint',
    variant: 'neutral',
    icon: 'check_circle',
  },
  ON_HOLD: {
    labelKey: 'earnings.onHold',
    hintKey: 'earnings.onHoldHint',
    variant: 'warning',
    icon: 'pause_circle',
  },
  SETTLED_IN_CASH: {
    labelKey: 'earnings.cashKept',
    hintKey: 'earnings.cashKeptHint',
    variant: 'neutral',
    icon: 'payments',
  },
};

/** Summary tiles, in the order a driver follows the money. Payable is the hero card. */
export const SUMMARY_TILES: readonly {
  readonly status: Exclude<EarningStatusDto, 'PAYABLE'>;
  readonly field:
    | 'awaitingSettlementPaise'
    | 'inPayoutPaise'
    | 'paidPaise'
    | 'onHoldPaise'
    | 'settledInCashPaise';
}[] = [
  { status: 'AWAITING_SETTLEMENT', field: 'awaitingSettlementPaise' },
  { status: 'IN_PAYOUT', field: 'inPayoutPaise' },
  { status: 'PAID', field: 'paidPaise' },
  { status: 'ON_HOLD', field: 'onHoldPaise' },
  { status: 'SETTLED_IN_CASH', field: 'settledInCashPaise' },
];

export const PAYOUT_STATUS_VIEW: Readonly<
  Record<
    PayoutStatusDto,
    { readonly labelKey: string; readonly variant: PillVariant }
  >
> = {
  PREPARED: { labelKey: 'earnings.payoutPending', variant: 'info' },
  SUBMITTING: { labelKey: 'earnings.payoutPending', variant: 'info' },
  SUBMITTED: { labelKey: 'earnings.payoutPending', variant: 'info' },
  PROCESSED: { labelKey: 'earnings.payoutProcessed', variant: 'success' },
  FAILED: { labelKey: 'earnings.payoutFailed', variant: 'error' },
  REVERSED: { labelKey: 'earnings.payoutReversed', variant: 'warning' },
};

export interface BankNotice {
  readonly key: string;
  readonly vars?: Readonly<Record<string, string>>;
  /** False when payouts can't reach the driver yet. */
  readonly ok: boolean;
}

/** Where payouts go, or why they can't go anywhere yet. */
export function bankNotice(account: BankAccountDto | null): BankNotice {
  if (!account) {
    return { key: 'earnings.bankMissing', ok: false };
  }
  const vars = { ifsc: account.ifsc, last4: account.accountNumberLast4 };
  switch (account.status) {
    case 'VERIFIED':
      return { key: 'earnings.bankVerified', vars, ok: true };
    case 'PENDING_VERIFICATION':
      return { key: 'earnings.bankPending', vars, ok: false };
    default:
      return { key: 'earnings.bankInactive', vars, ok: false };
  }
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
