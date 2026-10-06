import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountResponse, DriverPayoutResponse, SubmitBankAccountRequest } from './payouts.dto';
import { toBankAccountResponse, toDriverPayoutResponse } from './payouts.mapper';

/**
 * The driver's payout beneficiary and weekly payouts. Read-only apart from submitting a bank
 * account: there is no withdrawal, transfer or "pay me now" endpoint. Weekly payouts are not
 * wallet withdrawals; the wallet only funds cash-trip platform fees.
 */
@ApiTags('payouts')
@DriverOnly()
@Controller({ version: '1' })
export class DriverPayoutsController {
  constructor(
    private readonly bankAccounts: BankAccountsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('bank-account')
  async getBankAccount(@CurrentPrincipal() principal: Principal): Promise<BankAccountResponse> {
    const current = await this.bankAccounts.getForDriver(principal);
    if (!current) {
      throw new AppError(
        ErrorCode.BANK_ACCOUNT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'No bank account is linked yet',
      );
    }
    return toBankAccountResponse(current.account, current.validation);
  }

  /**
   * Links (or changes) the payout bank account. The bank validates it and an admin approves it
   * before it receives payouts. Changing it suspends the previous account immediately.
   */
  @Post('bank-account')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async submitBankAccount(
    @CurrentPrincipal() principal: Principal,
    @Body() body: SubmitBankAccountRequest,
  ): Promise<BankAccountResponse> {
    if (body.accountNumber !== body.confirmAccountNumber) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'The account numbers do not match',
      );
    }
    const { account, validation } = await this.bankAccounts.submit(principal, {
      accountHolderName: body.accountHolderName,
      ifsc: body.ifsc,
      accountNumber: body.accountNumber,
    });
    return toBankAccountResponse(account, validation);
  }

  @Get('payouts')
  async listPayouts(@CurrentPrincipal() principal: Principal): Promise<DriverPayoutResponse[]> {
    const driver = requireDriver(principal);
    const payouts = await this.prisma.driverPayout.findMany({
      where: { driverId: driver.id },
      include: { items: true, bankAccount: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return payouts.map(toDriverPayoutResponse);
  }

  @Get('payouts/:payoutId')
  async getPayout(
    @CurrentPrincipal() principal: Principal,
    @Param('payoutId', new ParseUUIDPipe({ version: '4' })) payoutId: string,
  ): Promise<DriverPayoutResponse> {
    const driver = requireDriver(principal);
    const payout = await this.prisma.driverPayout.findFirst({
      where: { id: payoutId, driverId: driver.id },
      include: { items: true, bankAccount: true },
    });
    if (!payout) {
      throw new AppError(ErrorCode.PAYOUT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Payout not found');
    }
    return toDriverPayoutResponse(payout);
  }
}
