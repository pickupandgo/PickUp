import { paiseToNumber } from '../common/money';
import type { DriverWallet, DriverWalletTransaction } from '../generated/prisma/client';
import type {
  AdminWalletResponse,
  AdminWalletTransactionResponse,
  WalletResponse,
  WalletTransactionResponse,
} from './wallet.dto';

export function toWalletResponse(wallet: DriverWallet): WalletResponse {
  return {
    walletId: wallet.id,
    status: wallet.status,
    balancePaise: paiseToNumber(wallet.balancePaise),
    currency: 'INR',
    updatedAt: wallet.updatedAt.toISOString(),
  };
}

export function toAdminWalletResponse(wallet: DriverWallet): AdminWalletResponse {
  return {
    ...toWalletResponse(wallet),
    driverId: wallet.driverId,
    version: paiseToNumber(wallet.version),
    createdAt: wallet.createdAt.toISOString(),
  };
}

export function toWalletTransactionResponse(
  entry: DriverWalletTransaction,
): WalletTransactionResponse {
  return {
    id: entry.id,
    type: entry.type,
    direction: entry.direction,
    amountPaise: paiseToNumber(entry.amountPaise),
    balanceAfterPaise: paiseToNumber(entry.balanceAfterPaise),
    sequence: paiseToNumber(entry.walletVersion),
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    providerPaymentId: entry.providerPaymentId,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function toAdminWalletTransactionResponse(
  entry: DriverWalletTransaction,
): AdminWalletTransactionResponse {
  return {
    ...toWalletTransactionResponse(entry),
    providerOrderId: entry.providerOrderId,
    providerEventId: entry.providerEventId,
    performedByUserId: entry.performedByUserId,
    idempotencyKey: entry.idempotencyKey,
  };
}
