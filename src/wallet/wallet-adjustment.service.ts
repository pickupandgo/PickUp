import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { numberToPaise } from '../common/money';
import type { DriverWallet, DriverWalletTransaction } from '../generated/prisma/client';
import type { LedgerDirection } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { WalletLedgerService } from './wallet-ledger.service';

export interface AdjustmentInput {
  readonly direction: LedgerDirection;
  readonly amountPaise: number;
  readonly reason: string;
}

export interface AdjustmentResult {
  readonly entry: DriverWalletTransaction;
  readonly wallet: DriverWallet;
  readonly replayed: boolean;
}

/**
 * PW 8: admin-only manual adjustments. Always a ledger entry with the acting admin and a
 * reason; there is deliberately no "set balance" operation. Debits never overdraw.
 */
@Injectable()
export class WalletAdjustmentService {
  private readonly logger = new Logger(WalletAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async adjust(
    admin: Principal,
    walletId: string,
    idempotencyKey: string,
    input: AdjustmentInput,
  ): Promise<AdjustmentResult> {
    const amount = numberToPaise(input.amountPaise);
    if (amount > this.config.wallet.adminAdjustmentMaxPaise) {
      throw new AppError(
        ErrorCode.AMOUNT_OUT_OF_RANGE,
        HttpStatus.BAD_REQUEST,
        'Adjustment exceeds the configured maximum',
        { maxPaise: Number(this.config.wallet.adminAdjustmentMaxPaise) },
      );
    }

    const result = await this.prisma.runInTransaction((tx) =>
      this.ledger.postEntry(tx, {
        walletId,
        type: 'ADJUSTMENT',
        direction: input.direction,
        amountPaise: amount,
        referenceType: 'ADMIN',
        referenceId: admin.userId,
        idempotencyKey: `admin-adjustment:${admin.userId}:${idempotencyKey}`,
        performedByUserId: admin.userId,
        reason: input.reason,
      }),
    );

    const wallet = await this.prisma.driverWallet.findUniqueOrThrow({ where: { id: walletId } });
    this.logger.log(
      {
        walletId,
        adminUserId: admin.userId,
        direction: input.direction,
        amountPaise: input.amountPaise,
        ledgerEntryId: result.entry.id,
        replayed: result.replayed,
      },
      'Admin wallet adjustment',
    );
    return { entry: result.entry, wallet, replayed: result.replayed };
  }
}
