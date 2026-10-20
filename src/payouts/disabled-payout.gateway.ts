import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import {
  PAYOUT_PROVIDER_RAZORPAYX,
  PayoutGateway,
  type ProviderBankValidation,
  type ProviderPayout,
} from './payout.gateway';

/** Used until a payout provider is configured (PAYOUT_PROVIDER=disabled). Every call fails. */
export class DisabledPayoutGateway extends PayoutGateway {
  readonly enabled = false;
  readonly provider = PAYOUT_PROVIDER_RAZORPAYX;

  createContact(): Promise<{ contactId: string }> {
    return Promise.reject(notConfigured());
  }

  createBankFundAccount(): Promise<{ fundAccountId: string }> {
    return Promise.reject(notConfigured());
  }

  validateBankAccount(): Promise<ProviderBankValidation> {
    return Promise.reject(notConfigured());
  }

  fetchBankValidation(): Promise<ProviderBankValidation> {
    return Promise.reject(notConfigured());
  }

  createPayout(): Promise<ProviderPayout> {
    return Promise.reject(notConfigured());
  }

  fetchPayout(): Promise<ProviderPayout> {
    return Promise.reject(notConfigured());
  }

  findPayoutByReference(): Promise<ProviderPayout | null> {
    return Promise.reject(notConfigured());
  }
}

export function notConfigured(): AppError {
  return new AppError(
    ErrorCode.PAYOUT_PROVIDER_NOT_CONFIGURED,
    HttpStatus.SERVICE_UNAVAILABLE,
    'Driver payouts are not enabled on this server yet',
  );
}
