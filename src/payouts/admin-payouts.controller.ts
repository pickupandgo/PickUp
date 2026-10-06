import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AdminOnly, CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKey } from '../common/http/idempotency-key.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { Clock } from '../common/clock';
import { BankAccountsService } from './bank-accounts.service';
import { PayoutBatchesService } from './payout-batches.service';
import { PayoutExecutionService } from './payout-execution.service';
import { PayoutSchedulerService } from './payout-scheduler.service';
import {
  AdminBankAccountDetailResponse,
  AdminBankAccountResponse,
  AdminPayoutResponse,
  ApproveBankAccountRequest,
  BankAccountDecisionRequest,
  BankValidationResponse,
  ExecuteBatchResponse,
  ListBankAccountsQuery,
  ListPayoutsQuery,
  PayoutBatchDetailResponse,
  PayoutBatchResponse,
  PayoutScheduleResponse,
  PrepareBatchRequest,
  PrepareBatchResponse,
  RunScheduleResponse,
  SyncPayoutResponse,
} from './payouts.dto';
import {
  toAdminBankAccountDetailResponse,
  toAdminBankAccountResponse,
  toAdminPayoutResponse,
  toBankValidationResponse,
  toPayoutBatchResponse,
} from './payouts.mapper';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Payout operations: beneficiaries, weekly batches, execution and recovery. */
@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin', version: '1' })
export class AdminPayoutsController {
  constructor(
    private readonly bankAccounts: BankAccountsService,
    private readonly batches: PayoutBatchesService,
    private readonly execution: PayoutExecutionService,
    private readonly scheduler: PayoutSchedulerService,
    private readonly clock: Clock,
    private readonly prisma: PrismaService,
  ) {}

  @Get('bank-accounts')
  async listBankAccounts(
    @Query() query: ListBankAccountsQuery,
  ): Promise<AdminBankAccountResponse[]> {
    return (await this.bankAccounts.list(query.status)).map((account) =>
      toAdminBankAccountResponse(account),
    );
  }

  /** The account, the driver's KYC name and every bank validation, newest first. */
  @Get('bank-accounts/:bankAccountId')
  async getBankAccount(
    @Param('bankAccountId', uuid) bankAccountId: string,
  ): Promise<AdminBankAccountDetailResponse> {
    return toAdminBankAccountDetailResponse(await this.bankAccounts.getDetail(bankAccountId));
  }

  /**
   * Approves the account (or reinstates a suspended one) on a completed bank validation of an
   * active account. A bank name that is not an exact KYC match needs a mismatchResolution.
   * Payouts only ever go to approved (VERIFIED) accounts.
   */
  @Post('bank-accounts/:bankAccountId/approve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async approveBankAccount(
    @CurrentPrincipal() principal: Principal,
    @Param('bankAccountId', uuid) bankAccountId: string,
    @Body() body: ApproveBankAccountRequest,
  ): Promise<AdminBankAccountDetailResponse> {
    await this.bankAccounts.approve(principal, bankAccountId, body);
    return toAdminBankAccountDetailResponse(await this.bankAccounts.getDetail(bankAccountId));
  }

  /** Starts a new bank validation (penny drop) for a pending or suspended account. */
  @Post('bank-accounts/:bankAccountId/validations')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async revalidateBankAccount(
    @CurrentPrincipal() principal: Principal,
    @Param('bankAccountId', uuid) bankAccountId: string,
  ): Promise<BankValidationResponse> {
    return toBankValidationResponse(await this.bankAccounts.revalidate(principal, bankAccountId));
  }

  /** Re-reads a validation from the provider (when its webhook was missed). */
  @Post('bank-accounts/:bankAccountId/validations/:validationId/refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refreshValidation(
    @Param('bankAccountId', uuid) bankAccountId: string,
    @Param('validationId', uuid) validationId: string,
  ): Promise<BankValidationResponse> {
    return toBankValidationResponse(
      await this.bankAccounts.refreshValidation(bankAccountId, validationId),
    );
  }

  @Post('bank-accounts/:bankAccountId/reject')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async rejectBankAccount(
    @CurrentPrincipal() principal: Principal,
    @Param('bankAccountId', uuid) bankAccountId: string,
    @Body() body: BankAccountDecisionRequest,
  ): Promise<AdminBankAccountResponse> {
    return toAdminBankAccountResponse(
      await this.bankAccounts.reject(principal, bankAccountId, body.reason),
    );
  }

  /** Stops payouts to the account. Prepared payouts to it fail safely and are paid later. */
  @Post('bank-accounts/:bankAccountId/suspend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async suspendBankAccount(
    @CurrentPrincipal() principal: Principal,
    @Param('bankAccountId', uuid) bankAccountId: string,
    @Body() body: BankAccountDecisionRequest,
  ): Promise<AdminBankAccountResponse> {
    return toAdminBankAccountResponse(
      await this.bankAccounts.suspend(principal, bankAccountId, body.reason),
    );
  }

  /** The weekly payout schedule in force (system configuration) and its last/next runs. */
  @Get('payout-schedule')
  getSchedule(): PayoutScheduleResponse {
    return this.scheduler.view();
  }

  /**
   * Runs the weekly schedule now: if this week's run time has passed and its batch does not exist
   * yet, pulls settlements and prepares it (same idempotency key as the scheduler).
   */
  @Post('payout-schedule/run')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async runSchedule(): Promise<RunScheduleResponse> {
    const batch = await this.scheduler.tick();
    return { batch: batch ? toPayoutBatchResponse(batch) : null };
  }

  /** Prepares a payout batch now (the scheduler does this weekly when enabled). */
  @Post('payout-batches')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader({ name: IDEMPOTENCY_KEY_HEADER, required: true })
  async prepareBatch(
    @CurrentPrincipal() principal: Principal,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: PrepareBatchRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PrepareBatchResponse> {
    const result = await this.batches.prepare({
      origin: 'ADMIN',
      idempotencyKey: `admin:${principal.userId}:${idempotencyKey}`,
      cutoffAt: body.cutoffAt ? new Date(body.cutoffAt) : this.clock.now(),
      actorUserId: principal.userId,
    });
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return { batch: toPayoutBatchResponse(result.batch), created: result.created };
  }

  @Get('payout-batches')
  async listBatches(): Promise<PayoutBatchResponse[]> {
    return (await this.batches.list()).map(toPayoutBatchResponse);
  }

  @Get('payout-batches/:batchId')
  async getBatch(@Param('batchId', uuid) batchId: string): Promise<PayoutBatchDetailResponse> {
    const { batch, payouts } = await this.batches.get(batchId);
    return {
      ...toPayoutBatchResponse(batch),
      payouts: payouts.map((payout) => toAdminPayoutResponse(payout)),
    };
  }

  /** Sends the batch's payouts to the provider. Safe to repeat: each payout is sent once. */
  @Post('payout-batches/:batchId/execute')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async executeBatch(
    @CurrentPrincipal() principal: Principal,
    @Param('batchId', uuid) batchId: string,
  ): Promise<ExecuteBatchResponse> {
    const result = await this.execution.executeBatch(batchId, principal.userId);
    return { batch: toPayoutBatchResponse(result.batch), results: [...result.results] };
  }

  @Get('payouts')
  async listPayouts(@Query() query: ListPayoutsQuery): Promise<AdminPayoutResponse[]> {
    const payouts = await this.prisma.driverPayout.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.driverId ? { driverId: query.driverId } : {}),
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
    });
    return payouts.map((payout) => toAdminPayoutResponse(payout, payout.items));
  }

  @Get('payouts/:payoutId')
  async getPayout(@Param('payoutId', uuid) payoutId: string): Promise<AdminPayoutResponse> {
    const payout = await this.prisma.driverPayout.findUnique({
      where: { id: payoutId },
      include: { items: true },
    });
    if (!payout) {
      throw new AppError(ErrorCode.PAYOUT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Payout not found');
    }
    return toAdminPayoutResponse(payout, payout.items);
  }

  /** Re-reads the payout from the provider and applies a state the webhook missed. */
  @Post('payouts/:payoutId/sync')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async syncPayout(
    @CurrentPrincipal() principal: Principal,
    @Param('payoutId', uuid) payoutId: string,
  ): Promise<SyncPayoutResponse> {
    const result = await this.execution.sync(payoutId, principal.userId);
    const items = await this.prisma.payoutItem.findMany({ where: { payoutId } });
    return { payout: toAdminPayoutResponse(result.payout, items), outcome: result.outcome };
  }
}
