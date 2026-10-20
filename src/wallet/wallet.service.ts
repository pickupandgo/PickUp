import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { DriverWallet, DriverWalletTransaction } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_PAGE_SIZE = 20;

export interface TransactionPage {
  readonly items: DriverWalletTransaction[];
  readonly nextCursor: string | null;
}

/** Read side of the wallet plus lazy wallet creation. Balance changes go through WalletLedgerService. */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the driver's wallet, creating it with a zero balance on first use (race-safe). */
  async ensureWalletForDriver(driverId: string): Promise<DriverWallet> {
    await this.prisma.$executeRaw`
      INSERT INTO driver_wallets (driver_id)
      VALUES (${driverId}::uuid)
      ON CONFLICT (driver_id) DO NOTHING`;
    return this.prisma.driverWallet.findUniqueOrThrow({ where: { driverId } });
  }

  async getWallet(walletId: string): Promise<DriverWallet> {
    const wallet = await this.prisma.driverWallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      throw new AppError(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND, 'Wallet not found');
    }
    return wallet;
  }

  async findWalletByDriver(driverId: string): Promise<DriverWallet> {
    const wallet = await this.prisma.driverWallet.findUnique({ where: { driverId } });
    if (!wallet) {
      throw new AppError(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND, 'Wallet not found');
    }
    return wallet;
  }

  /** Ledger entries newest first, paged by the gap-free wallet version (exact, index-backed). */
  async listTransactions(
    walletId: string,
    options: { limit?: number; cursor?: string },
  ): Promise<TransactionPage> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const before = options.cursor ? BigInt(options.cursor) : undefined;

    const rows = await this.prisma.driverWalletTransaction.findMany({
      where: { walletId, ...(before !== undefined ? { walletVersion: { lt: before } } : {}) },
      orderBy: { walletVersion: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return { items, nextCursor: hasMore && last ? last.walletVersion.toString() : null };
  }
}
