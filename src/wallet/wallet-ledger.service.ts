import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { DriverWalletTransaction } from '../generated/prisma/client';
import type { LedgerDirection, WalletEntryType, WalletStatus } from '../generated/prisma/enums';
import type { Tx } from '../prisma/prisma.service';

export type LedgerMetadata = Readonly<Record<string, string | number | boolean | null>>;

export interface LedgerEntryInput {
  readonly walletId: string;
  readonly type: WalletEntryType;
  readonly direction: LedgerDirection;
  /** Always positive; `direction` decides credit or debit. */
  readonly amountPaise: bigint;
  readonly referenceType: string;
  readonly referenceId: string;
  /** Globally unique. Replaying the same key returns the original entry instead of applying twice. */
  readonly idempotencyKey: string;
  readonly provider?: string;
  readonly providerOrderId?: string;
  readonly providerPaymentId?: string;
  readonly providerEventId?: string;
  readonly performedByUserId?: string;
  readonly reason?: string;
  readonly metadata?: LedgerMetadata;
}

export interface LedgerEntryResult {
  readonly entry: DriverWalletTransaction;
  /** True when the idempotency key had already been applied and nothing changed. */
  readonly replayed: boolean;
}

interface LockedWalletRow {
  readonly id: string;
  readonly balance_paise: bigint;
  readonly status: WalletStatus;
  readonly version: bigint;
}

/**
 * The only code path that changes a wallet balance (PW sections 3, 4.3, 7.2 and 8).
 *
 * Inside the caller's transaction it:
 *   1. locks the wallet row (SELECT ... FOR UPDATE), so concurrent changes run one at a time;
 *   2. checks the idempotency key AFTER the lock, so a concurrent duplicate always sees the
 *      committed original;
 *   3. validates the debit against the locked, authoritative balance and status;
 *   4. updates the balance with a conditional UPDATE guarded by the version it just read;
 *   5. inserts the append-only ledger row. There is no ON CONFLICT: any duplicate key, provider
 *      event or wallet version raises and rolls back the balance change with it. (PW's reference
 *      SQL updates the balance before an ON CONFLICT DO NOTHING insert, which can change the
 *      balance without writing a ledger row; this ordering removes that defect.)
 *
 * Never call external services while this runs.
 */
@Injectable()
export class WalletLedgerService {
  async postEntry(tx: Tx, input: LedgerEntryInput): Promise<LedgerEntryResult> {
    if (input.amountPaise <= 0n) {
      throw new RangeError('Ledger amounts must be positive');
    }

    const [wallet] = await tx.$queryRaw<LockedWalletRow[]>`
      SELECT id, balance_paise, status, version
      FROM driver_wallets
      WHERE id = ${input.walletId}::uuid
      FOR UPDATE`;
    if (!wallet) {
      throw new AppError(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND, 'Wallet not found');
    }
    // Raw rows are an unchecked type cast; pin money and version to bigint before any arithmetic.
    const balance = BigInt(wallet.balance_paise);
    const version = BigInt(wallet.version);

    const existing = await tx.driverWalletTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (!isSameOperation(existing, input)) {
        throw new AppError(
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
          HttpStatus.CONFLICT,
          'This idempotency key was already used for a different operation',
        );
      }
      return { entry: existing, replayed: true };
    }

    const isCredit = input.direction === 'CREDIT';
    if (!isCredit) {
      if (wallet.status === 'BLOCKED') {
        throw new AppError(ErrorCode.WALLET_BLOCKED, HttpStatus.CONFLICT, 'This wallet is blocked');
      }
      if (balance < input.amountPaise) {
        throw new AppError(
          ErrorCode.INSUFFICIENT_BALANCE,
          HttpStatus.CONFLICT,
          'Insufficient wallet balance',
        );
      }
    }

    const newBalance = isCredit ? balance + input.amountPaise : balance - input.amountPaise;
    const newVersion = version + 1n;
    // PW 4.3: a top-up lifts a LOW_BALANCE wallet back to ACTIVE.
    const restoreActive = input.type === 'TOPUP';

    const updated = await tx.$queryRaw<{ balance_paise: bigint }[]>`
      UPDATE driver_wallets
      SET balance_paise = ${newBalance},
          version = ${newVersion},
          updated_at = now(),
          status = CASE
            WHEN status = 'LOW_BALANCE'::wallet_status AND ${restoreActive}
              THEN 'ACTIVE'::wallet_status
            ELSE status
          END
      WHERE id = ${input.walletId}::uuid
        AND version = ${version}
        AND balance_paise = ${balance}
        AND (${isCredit} OR (status <> 'BLOCKED'::wallet_status AND balance_paise >= ${input.amountPaise}))
      RETURNING balance_paise`;
    if (updated.length !== 1) {
      // Unreachable while the row lock is held; refuse rather than guess.
      throw new Error('Wallet changed underneath its row lock');
    }

    const entry = await tx.driverWalletTransaction.create({
      data: {
        walletId: input.walletId,
        type: input.type,
        direction: input.direction,
        amountPaise: input.amountPaise,
        balanceAfterPaise: newBalance,
        walletVersion: newVersion,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        provider: input.provider ?? null,
        providerOrderId: input.providerOrderId ?? null,
        providerPaymentId: input.providerPaymentId ?? null,
        providerEventId: input.providerEventId ?? null,
        performedByUserId: input.performedByUserId ?? null,
        reason: input.reason ?? null,
        metadata: input.metadata ?? {},
      },
    });

    return { entry, replayed: false };
  }
}

function isSameOperation(existing: DriverWalletTransaction, input: LedgerEntryInput): boolean {
  return (
    existing.walletId === input.walletId &&
    existing.type === input.type &&
    existing.direction === input.direction &&
    existing.amountPaise === input.amountPaise
  );
}
