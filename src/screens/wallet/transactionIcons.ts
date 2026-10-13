import type { TransactionCategory } from '../../types/wallet';

/** Material icon for each wallet transaction category. */
export const TRANSACTION_ICON: Readonly<Record<TransactionCategory, string>> = {
  trip_earning: 'route',
  recharge: 'account_balance_wallet',
  platform_commission: 'percent',
  deduction: 'remove_circle',
  bonus: 'redeem',
  refund: 'undo',
  withdrawal: 'account_balance',
  adjustment: 'tune',
};
