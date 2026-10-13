import { STEP_UP_METHOD } from '../auth/step-up';
import { paiseToNumber } from '../common/money';
import type {
  BankAccountChangeRequest,
  BankAccountVerification,
  DriverBankAccount,
  DriverPayout,
  PayoutBatch,
  PayoutItem,
} from '../generated/prisma/client';
import type { BankAccountDetail } from './bank-accounts.service';
import type {
  AdminBankAccountDetailResponse,
  AdminBankAccountResponse,
  AdminPayoutResponse,
  BankAccountChangeEvidenceResponse,
  BankAccountChangeRequestResponse,
  BankAccountResponse,
  BankValidationResponse,
  DriverPayoutResponse,
  PayoutBatchResponse,
  PayoutItemResponse,
} from './payouts.dto';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function validationStatus(validation: BankAccountVerification | null | undefined): string {
  if (!validation) {
    return 'NOT_STARTED';
  }
  return validation.status === 'CREATED' ? 'IN_PROGRESS' : validation.status;
}

/** Driver view. The bank's registered name is deliberately not returned to the driver. */
export function toBankAccountResponse(
  account: DriverBankAccount,
  latestValidation?: BankAccountVerification | null,
): BankAccountResponse {
  return {
    bankAccountId: account.id,
    accountHolderName: account.accountHolderName,
    ifsc: account.ifsc,
    accountNumberLast4: account.accountNumberLast4,
    status: account.status,
    payoutsEnabled: account.status === 'VERIFIED',
    validationStatus: validationStatus(latestValidation),
    verifiedAt: iso(account.verifiedAt),
    statusReason: account.statusReason,
    createdAt: account.createdAt.toISOString(),
  };
}

/** `phoneNumberHint` is only known (and only needed) right after the request is created. */
export function toChangeRequestResponse(
  request: BankAccountChangeRequest,
  phoneNumberHint?: string,
): BankAccountChangeRequestResponse {
  return {
    changeRequestId: request.id,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    stepUp:
      request.status === 'PENDING_STEP_UP' && phoneNumberHint
        ? {
            method: STEP_UP_METHOD,
            phoneNumberHint,
            notBefore: request.createdAt.toISOString(),
          }
        : null,
  };
}

function toChangeEvidence(request: BankAccountChangeRequest): BankAccountChangeEvidenceResponse {
  return {
    changeRequestId: request.id,
    stepUpMethod: request.stepUpMethod,
    stepUpAuthTime: iso(request.stepUpAuthTime),
    stepUpVerifiedAt: iso(request.stepUpVerifiedAt),
    requestedAt: request.createdAt.toISOString(),
  };
}

export function toBankValidationResponse(
  validation: BankAccountVerification,
): BankValidationResponse {
  return {
    validationId: validation.id,
    provider: validation.provider,
    providerValidationId: validation.providerValidationId,
    method: validation.method,
    status: validation.status,
    accountStatus: validation.accountStatus,
    registeredName: validation.registeredName,
    nameMatchScore: validation.nameMatchScore,
    nameMatchResult: validation.nameMatchResult,
    comparedName: validation.comparedName,
    utr: validation.utr,
    failureReason: validation.failureReason,
    requestedByUserId: validation.requestedByUserId,
    completedAt: iso(validation.completedAt),
    createdAt: validation.createdAt.toISOString(),
  };
}

export function toAdminBankAccountResponse(
  account: DriverBankAccount,
  latestValidation?: BankAccountVerification | null,
): AdminBankAccountResponse {
  return {
    ...toBankAccountResponse(account, latestValidation),
    driverId: account.driverId,
    provider: account.provider,
    providerContactId: account.providerContactId,
    providerFundAccountId: account.providerFundAccountId,
    changeRequestId: account.changeRequestId,
    verifiedByUserId: account.verifiedByUserId,
    verificationReference: account.verificationReference,
    approvedVerificationId: account.approvedVerificationId,
    nameMatchResolution: account.nameMatchResolution,
    statusChangedByUserId: account.statusChangedByUserId,
  };
}

export function toAdminBankAccountDetailResponse(
  detail: BankAccountDetail,
): AdminBankAccountDetailResponse {
  return {
    ...toAdminBankAccountResponse(detail.account, detail.verifications[0] ?? null),
    driverLegalName: detail.driverLegalName,
    changeRequest: detail.changeRequest ? toChangeEvidence(detail.changeRequest) : null,
    validations: detail.verifications.map(toBankValidationResponse),
  };
}

function toItemResponse(item: PayoutItem): PayoutItemResponse {
  return {
    earningId: item.earningId,
    amountPaise: paiseToNumber(item.amountPaise),
    status: item.status,
  };
}

export function toDriverPayoutResponse(
  payout: DriverPayout & { items: PayoutItem[]; bankAccount: DriverBankAccount },
): DriverPayoutResponse {
  return {
    payoutId: payout.id,
    grossAmountPaise: paiseToNumber(payout.grossAmountPaise),
    tdsAmountPaise: paiseToNumber(payout.tdsAmountPaise),
    otherDeductionsPaise: paiseToNumber(payout.otherDeductionsPaise),
    amountPaise: paiseToNumber(payout.amountPaise),
    status: payout.status,
    utr: payout.utr,
    bankAccountLast4: payout.bankAccount.accountNumberLast4,
    processedAt: iso(payout.processedAt),
    failedAt: iso(payout.failedAt),
    createdAt: payout.createdAt.toISOString(),
    items: payout.items.map(toItemResponse),
  };
}

export function toAdminPayoutResponse(
  payout: DriverPayout,
  items: PayoutItem[] = [],
): AdminPayoutResponse {
  return {
    payoutId: payout.id,
    batchId: payout.batchId,
    driverId: payout.driverId,
    bankAccountId: payout.bankAccountId,
    grossAmountPaise: paiseToNumber(payout.grossAmountPaise),
    tdsAmountPaise: paiseToNumber(payout.tdsAmountPaise),
    otherDeductionsPaise: paiseToNumber(payout.otherDeductionsPaise),
    tdsPolicy: payout.tdsPolicy,
    taxRuleId: payout.taxRuleId,
    amountPaise: paiseToNumber(payout.amountPaise),
    mode: payout.mode,
    status: payout.status,
    provider: payout.provider,
    providerPayoutId: payout.providerPayoutId,
    providerStatus: payout.providerStatus,
    utr: payout.utr,
    failureReason: payout.failureReason,
    attempts: payout.attempts,
    submittedAt: iso(payout.submittedAt),
    processedAt: iso(payout.processedAt),
    failedAt: iso(payout.failedAt),
    reversedAt: iso(payout.reversedAt),
    createdAt: payout.createdAt.toISOString(),
    items: items.map(toItemResponse),
  };
}

export function toPayoutBatchResponse(batch: PayoutBatch): PayoutBatchResponse {
  return {
    batchId: batch.id,
    cycleKey: batch.cycleKey,
    origin: batch.origin,
    cutoffAt: batch.cutoffAt.toISOString(),
    status: batch.status,
    payoutCount: batch.payoutCount,
    totalAmountPaise: paiseToNumber(batch.totalAmountPaise),
    createdByUserId: batch.createdByUserId,
    executedAt: iso(batch.executedAt),
    completedAt: iso(batch.completedAt),
    createdAt: batch.createdAt.toISOString(),
  };
}
