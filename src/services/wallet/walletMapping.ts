import type {
  LedgerEntryTypeDto,
  WalletDto,
  WalletTransactionDto,
} from '../payments/paymentsApi';
import { paiseToRupees } from '../payments/money';
import type {
  Transaction,
  TransactionCategory,
  WalletBalance,
} from '../../types/wallet';

/** Maps payments-backend wallet data (integer paise) to the shapes the wallet screens use. */

export const RUPEE_SYMBOL = '₹';

const CATEGORY: Readonly<Record<LedgerEntryTypeDto, TransactionCategory>> = {
  TOPUP: 'recharge',
  CASH_RIDE_FEE: 'platform_commission',
  REFUND_REVERSAL: 'refund',
  ADJUSTMENT: 'adjustment',
};

export function toWalletBalance(wallet: WalletDto): WalletBalance {
  return {
    balance: paiseToRupees(wallet.balancePaise),
    currency: RUPEE_SYMBOL,
    // No minimum-balance rule has been decided yet, so none is shown.
    minimumBalance: null,
    isLowBalance: wallet.status === 'LOW_BALANCE',
    status: wallet.status,
  };
}

export function toTransaction(entry: WalletTransactionDto): Transaction {
  const createdAt = new Date(entry.createdAt);
  const validDate = !Number.isNaN(createdAt.getTime());
  return {
    id: entry.id,
    type: entry.direction === 'CREDIT' ? 'credit' : 'debit',
    category: CATEGORY[entry.type],
    amount: paiseToRupees(entry.amountPaise),
    currency: RUPEE_SYMBOL,
    title: titleFor(entry),
    description: descriptionFor(entry),
    date: validDate
      ? createdAt.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '',
    time: validDate
      ? createdAt.toLocaleTimeString('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
        })
      : '',
    referenceId: entry.providerPaymentId ?? undefined,
  };
}

function titleFor(entry: WalletTransactionDto): string {
  switch (entry.type) {
    case 'TOPUP':
      return 'Wallet Recharge';
    case 'CASH_RIDE_FEE':
      return 'Cash Trip Fee';
    case 'REFUND_REVERSAL':
      return entry.direction === 'CREDIT' ? 'Refund' : 'Reversal';
    case 'ADJUSTMENT':
      return 'Wallet Adjustment';
  }
}

function descriptionFor(entry: WalletTransactionDto): string | undefined {
  if (entry.type === 'TOPUP' && entry.providerPaymentId) {
    return `Ref ${entry.providerPaymentId}`;
  }
  return entry.reason ?? undefined;
}
