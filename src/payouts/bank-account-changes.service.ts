import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { checkStepUp, maskPhone, STEP_UP_METHOD, type StepUpProblem } from '../auth/step-up';
import { recordAdminAction } from '../audit/admin-actions';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type {
  BankAccountChangeRequest,
  BankAccountVerification,
  DriverBankAccount,
} from '../generated/prisma/client';
import type { DriverApprovalStatus } from '../generated/prisma/enums';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  type BankAccountInput,
  BankAccountsService,
  changePending,
  exists,
  lockAccount,
  REPLACED_BY_NEW_ACCOUNT,
  toPayoutProviderError,
} from './bank-accounts.service';
import { notConfigured } from './disabled-payout.gateway';
import { PayoutGateway } from './payout.gateway';

const TARGET = 'BANK_ACCOUNT_CHANGE_REQUEST';

export interface ChangeRequestChallenge {
  readonly request: BankAccountChangeRequest;
  /** The registered phone the OTP must be sent to, masked. */
  readonly phoneNumberHint: string;
}

export interface ConfirmedChange {
  readonly account: DriverBankAccount;
  readonly validation: BankAccountVerification | null;
}

/** The request was closed or expired by someone else between our read and our claim. */
class ClaimLost extends Error {}

/**
 * Adding or changing the payout bank account, with step-up authentication (OPEN_DECISIONS D-61):
 *
 *   1. the driver's session creates a change request (no bank details yet);
 *   2. the app re-authenticates the Firebase user with a phone OTP sent to the registered number,
 *      which yields an ID token whose auth_time is after the request (a token refresh never
 *      moves auth_time, so a stolen session cannot produce one);
 *   3. that fresh token confirms the request with the new details. In one transaction the
 *      request is verified, the old VERIFIED account suspended (REPLACED_BY_NEW_ACCOUNT), the new
 *      account added as PENDING_VERIFICATION and the request completed.
 *
 * The new account still needs a bank validation and an admin approval before it receives
 * payouts (BankAccountsService). The database enforces the binding: an account is inserted only
 * for a step-up verified request of the same driver, verified within the request's 10-minute
 * window by a sign-in after the request on the registered phone.
 */
@Injectable()
export class BankAccountChangesService {
  private readonly logger = new Logger(BankAccountChangesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PayoutGateway,
    private readonly bankAccounts: BankAccountsService,
  ) {}

  /** Step 1. Replaces the driver's open request, if any. */
  async create(principal: Principal): Promise<ChangeRequestChallenge> {
    const driver = requireDriver(principal);
    this.assertCanChange(driver.approvalStatus);
    if (await this.hasPendingAccount(driver.id)) {
      throw changePending();
    }
    const phone = await this.registeredPhone(principal.userId);
    try {
      const request = await this.prisma.runInTransaction(async (tx) => {
        const open = await tx.$queryRaw<{ id: string; expired: boolean }[]>`
          SELECT id, expires_at <= clock_timestamp() AS expired
          FROM bank_account_change_requests
          WHERE driver_id = ${driver.id}::uuid AND status = 'PENDING_STEP_UP'
          FOR UPDATE`;
        for (const row of open) {
          await tx.bankAccountChangeRequest.update({
            where: { id: row.id },
            data: row.expired
              ? { status: 'EXPIRED' }
              : { status: 'CANCELLED', closeReason: 'SUPERSEDED' },
          });
        }
        const created = await tx.bankAccountChangeRequest.create({
          data: { driverId: driver.id },
        });
        await recordAdminAction(tx, {
          actorUserId: principal.userId,
          action: 'BANK_ACCOUNT_CHANGE_REQUESTED',
          targetType: TARGET,
          targetId: created.id,
          details: { driverId: driver.id, replacedRequests: open.length },
        });
        return created;
      });
      return { request, phoneNumberHint: maskPhone(phone) };
    } catch (error) {
      // A concurrent request, or a confirmation in flight, holds the driver's one open slot.
      if (isUniqueViolation(error)) {
        throw changePending('A bank account change is already in progress, please try again');
      }
      throw error;
    }
  }

  /**
   * Step 3. `principal` must come from a token issued by a phone OTP re-authentication after the
   * request was created. Validation errors and provider rejections leave the request open, so the
   * driver can correct the details within the window without another OTP.
   */
  async confirm(
    principal: Principal,
    changeRequestId: string,
    input: BankAccountInput,
  ): Promise<ConfirmedChange> {
    const driver = requireDriver(principal);
    const request = await this.findOwn(driver.id, changeRequestId);
    await this.assertOpen(request);
    const phone = await this.registeredPhone(principal.userId);
    const problem = checkStepUp(principal.session, phone, request.createdAt);
    const authenticatedAt = principal.session.authenticatedAt;
    if (problem || !authenticatedAt) {
      return this.refuseStepUp(
        principal,
        driver.id,
        request,
        problem ?? 'REAUTHENTICATION_REQUIRED',
      );
    }
    this.assertCanChange(driver.approvalStatus);

    const last4 = input.accountNumber.slice(-4);
    const live = await this.prisma.driverBankAccount.findMany({
      where: { driverId: driver.id, status: { in: ['PENDING_VERIFICATION', 'VERIFIED'] } },
    });
    if (live.some((account) => account.status === 'PENDING_VERIFICATION')) {
      throw changePending();
    }
    const verified = live.find((account) => account.status === 'VERIFIED') ?? null;
    if (verified && verified.ifsc === input.ifsc && verified.accountNumberLast4 === last4) {
      throw exists('This bank account is already linked and verified');
    }

    // Provider objects first: no database lock is ever held during a provider call. A provider
    // rejection leaves the request open for corrected details.
    let contactId: string;
    let fundAccountId: string;
    try {
      ({ contactId } = await this.gateway.createContact({
        driverId: driver.id,
        name: input.accountHolderName,
      }));
      ({ fundAccountId } = await this.gateway.createBankFundAccount({
        contactId,
        holderName: input.accountHolderName,
        ifsc: input.ifsc,
        accountNumber: input.accountNumber,
      }));
    } catch (error) {
      throw toPayoutProviderError(error);
    }

    const accountId = randomUUID();
    let account: DriverBankAccount;
    try {
      account = await this.prisma.runInTransaction(async (tx) => {
        // The trigger re-checks the evidence: sign-in after the request, registered phone,
        // inside the window. Only one confirmation can claim the request.
        const claimed = await tx.$executeRaw`
          UPDATE bank_account_change_requests
          SET status = 'STEP_UP_VERIFIED',
              step_up_auth_time = ${authenticatedAt.toISOString()}::timestamptz,
              step_up_phone = ${phone},
              updated_at = clock_timestamp()
          WHERE id = ${request.id}::uuid
            AND driver_id = ${driver.id}::uuid
            AND status = 'PENDING_STEP_UP'
            AND expires_at > clock_timestamp()`;
        if (claimed !== 1) {
          throw new ClaimLost();
        }
        if (verified) {
          const current = await lockAccount(tx, verified.id);
          if (current.status === 'VERIFIED') {
            await tx.driverBankAccount.update({
              where: { id: verified.id },
              data: {
                status: 'SUSPENDED',
                statusReason: `${REPLACED_BY_NEW_ACCOUNT}: the driver submitted bank account ${accountId}`,
                statusChangedByUserId: principal.userId,
              },
            });
            await recordAdminAction(tx, {
              actorUserId: principal.userId,
              action: 'BANK_ACCOUNT_SUSPENDED',
              targetType: 'DRIVER_BANK_ACCOUNT',
              targetId: verified.id,
              reason: REPLACED_BY_NEW_ACCOUNT,
              details: { replacedBy: accountId, changeRequestId: request.id },
            });
          }
        }
        const created = await tx.driverBankAccount.create({
          data: {
            id: accountId,
            driverId: driver.id,
            accountHolderName: input.accountHolderName,
            ifsc: input.ifsc,
            accountNumberLast4: last4,
            provider: this.gateway.provider,
            providerContactId: contactId,
            providerFundAccountId: fundAccountId,
            changeRequestId: request.id,
          },
        });
        await tx.bankAccountChangeRequest.update({
          where: { id: request.id },
          data: { status: 'COMPLETED' },
        });
        await recordAdminAction(tx, {
          actorUserId: principal.userId,
          action: 'BANK_ACCOUNT_SUBMITTED',
          targetType: 'DRIVER_BANK_ACCOUNT',
          targetId: accountId,
          details: {
            changeRequestId: request.id,
            stepUpMethod: STEP_UP_METHOD,
            stepUpAuthTime: authenticatedAt.toISOString(),
            replacedAccountId: verified?.id ?? null,
            ifsc: input.ifsc,
            last4,
          },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof ClaimLost) {
        this.logger.warn(
          { changeRequestId: request.id, driverId: driver.id, fundAccountId },
          'Bank change request closed during confirmation; provider fund account left unused',
        );
        const current = await this.findOwn(driver.id, request.id);
        await this.assertOpen(current);
        throw requestClosed(current);
      }
      if (isUniqueViolation(error)) {
        throw changePending();
      }
      throw error;
    }
    this.logger.log(
      {
        bankAccountId: account.id,
        driverId: driver.id,
        changeRequestId: request.id,
        replaced: verified?.id ?? null,
      },
      'Bank account submitted after step-up; waiting for validation and admin approval',
    );
    const validation = await this.bankAccounts.startInitialValidation(account);
    return { account, validation };
  }

  /** Idempotent for an already cancelled request. */
  async cancel(principal: Principal, changeRequestId: string): Promise<BankAccountChangeRequest> {
    const driver = requireDriver(principal);
    const request = await this.findOwn(driver.id, changeRequestId);
    if (request.status === 'CANCELLED') {
      return request;
    }
    if (request.status !== 'PENDING_STEP_UP') {
      throw requestClosed(request);
    }
    const cancelled = await this.prisma.runInTransaction(async (tx) => {
      const result = await tx.bankAccountChangeRequest.updateMany({
        where: { id: request.id, status: 'PENDING_STEP_UP' },
        data: { status: 'CANCELLED', closeReason: 'DRIVER_CANCELLED' },
      });
      if (result.count !== 1) {
        return null;
      }
      await recordAdminAction(tx, {
        actorUserId: principal.userId,
        action: 'BANK_ACCOUNT_CHANGE_CANCELLED',
        targetType: TARGET,
        targetId: request.id,
        details: { driverId: driver.id },
      });
      return tx.bankAccountChangeRequest.findUniqueOrThrow({ where: { id: request.id } });
    });
    if (cancelled) {
      return cancelled;
    }
    const current = await this.findOwn(driver.id, request.id);
    if (current.status === 'CANCELLED') {
      return current;
    }
    throw requestClosed(current);
  }

  private async refuseStepUp(
    principal: Principal,
    driverId: string,
    request: BankAccountChangeRequest,
    problem: StepUpProblem,
  ): Promise<never> {
    // Evidence for the admin who later reviews this driver's bank account. No phone numbers.
    await recordAdminAction(this.prisma, {
      actorUserId: principal.userId,
      action: 'BANK_ACCOUNT_CHANGE_STEP_UP_REFUSED',
      targetType: TARGET,
      targetId: request.id,
      reason: problem,
      details: {
        driverId,
        signInProvider: principal.session.signInProvider,
        authenticatedAt: principal.session.authenticatedAt?.toISOString() ?? null,
      },
    });
    this.logger.warn(
      { changeRequestId: request.id, driverId, reason: problem },
      'Bank account change refused: no valid step-up re-authentication',
    );
    throw new AppError(
      ErrorCode.STEP_UP_REQUIRED,
      HttpStatus.FORBIDDEN,
      'Verify your phone number again with an OTP to change the payout bank account',
      { reason: problem, method: STEP_UP_METHOD, changeRequestId: request.id },
    );
  }

  private assertCanChange(approvalStatus: DriverApprovalStatus): void {
    if (approvalStatus !== 'APPROVED') {
      throw new AppError(
        ErrorCode.DRIVER_NOT_APPROVED,
        HttpStatus.FORBIDDEN,
        'Only approved drivers can add a bank account',
      );
    }
    if (!this.gateway.enabled) {
      throw notConfigured();
    }
  }

  private async hasPendingAccount(driverId: string): Promise<boolean> {
    const pending = await this.prisma.driverBankAccount.findFirst({
      where: { driverId, status: 'PENDING_VERIFICATION' },
      select: { id: true },
    });
    return pending !== null;
  }

  private async registeredPhone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phone: true },
    });
    return user.phone;
  }

  private async findOwn(driverId: string, changeRequestId: string) {
    const request = await this.prisma.bankAccountChangeRequest.findFirst({
      where: { id: changeRequestId, driverId },
    });
    if (!request) {
      throw new AppError(
        ErrorCode.BANK_CHANGE_REQUEST_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Bank account change request not found',
      );
    }
    return request;
  }

  /** Open = PENDING_STEP_UP and not expired by the database clock (expired ones are closed). */
  private async assertOpen(request: BankAccountChangeRequest): Promise<void> {
    if (request.status !== 'PENDING_STEP_UP') {
      throw requestClosed(request);
    }
    const [row] = await this.prisma.$queryRaw<{ expired: boolean }[]>`
      SELECT expires_at <= clock_timestamp() AS expired
      FROM bank_account_change_requests
      WHERE id = ${request.id}::uuid`;
    if (row?.expired) {
      await this.prisma.bankAccountChangeRequest.updateMany({
        where: { id: request.id, status: 'PENDING_STEP_UP' },
        data: { status: 'EXPIRED' },
      });
      throw new AppError(
        ErrorCode.BANK_CHANGE_REQUEST_EXPIRED,
        HttpStatus.CONFLICT,
        'This bank account change request has expired. Start again',
        { changeRequestId: request.id },
      );
    }
  }
}

function requestClosed(request: BankAccountChangeRequest): AppError {
  const messages: Record<string, string> = {
    COMPLETED: 'This bank account change request was already used',
    CANCELLED: 'This bank account change request was cancelled',
    EXPIRED: 'This bank account change request has expired. Start again',
  };
  return new AppError(
    request.status === 'EXPIRED'
      ? ErrorCode.BANK_CHANGE_REQUEST_EXPIRED
      : ErrorCode.BANK_CHANGE_REQUEST_CLOSED,
    HttpStatus.CONFLICT,
    messages[request.status] ?? 'This bank account change request is no longer open',
    { changeRequestId: request.id, status: request.status },
  );
}
