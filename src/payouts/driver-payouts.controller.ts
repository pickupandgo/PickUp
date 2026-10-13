import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { BankAccountChangesService } from './bank-account-changes.service';
import { BankAccountsService } from './bank-accounts.service';
import {
  BankAccountChangeRequestResponse,
  BankAccountResponse,
  DriverPayoutResponse,
  SubmitBankAccountRequest,
} from './payouts.dto';
import {
  toBankAccountResponse,
  toChangeRequestResponse,
  toDriverPayoutResponse,
} from './payouts.mapper';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * The driver's payout beneficiary and weekly payouts. There is no withdrawal, transfer or "pay me
 * now" endpoint: weekly payouts are not wallet withdrawals; the wallet only funds cash-trip
 * platform fees.
 *
 * Adding or changing the bank account is a step-up flow (OPEN_DECISIONS D-61):
 *   POST bank-account/change-requests              (normal session)
 *   re-authenticate with a Firebase phone OTP       (in the app)
 *   POST bank-account/change-requests/:id/confirm   (with the fresh ID token + the details)
 * The new account is then validated by the bank and approved by an admin before any payout.
 */
@ApiTags('payouts')
@DriverOnly()
@Controller({ version: '1' })
export class DriverPayoutsController {
  constructor(
    private readonly bankAccounts: BankAccountsService,
    private readonly changes: BankAccountChangesService,
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
   * Step 1 of adding or changing the payout bank account. Returns the step-up challenge: the app
   * must re-authenticate with a phone OTP before confirming. Replaces any open request.
   */
  @Post('bank-account/change-requests')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async createChangeRequest(
    @CurrentPrincipal() principal: Principal,
  ): Promise<BankAccountChangeRequestResponse> {
    const { request, phoneNumberHint } = await this.changes.create(principal);
    return toChangeRequestResponse(request, phoneNumberHint);
  }

  /**
   * Step 3: the new details, sent with an ID token from a phone OTP re-authentication after the
   * request was created (403 STEP_UP_REQUIRED otherwise). Suspends the current account at once;
   * the new one receives payouts only after bank validation and admin approval.
   */
  @Post('bank-account/change-requests/:changeRequestId/confirm')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async confirmChangeRequest(
    @CurrentPrincipal() principal: Principal,
    @Param('changeRequestId', uuid) changeRequestId: string,
    @Body() body: SubmitBankAccountRequest,
  ): Promise<BankAccountResponse> {
    if (body.accountNumber !== body.confirmAccountNumber) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'The account numbers do not match',
      );
    }
    const { account, validation } = await this.changes.confirm(principal, changeRequestId, {
      accountHolderName: body.accountHolderName,
      ifsc: body.ifsc,
      accountNumber: body.accountNumber,
    });
    return toBankAccountResponse(account, validation);
  }

  @Post('bank-account/change-requests/:changeRequestId/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async cancelChangeRequest(
    @CurrentPrincipal() principal: Principal,
    @Param('changeRequestId', uuid) changeRequestId: string,
  ): Promise<BankAccountChangeRequestResponse> {
    return toChangeRequestResponse(await this.changes.cancel(principal, changeRequestId));
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
    @Param('payoutId', uuid) payoutId: string,
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
