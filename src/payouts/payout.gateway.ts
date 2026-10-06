/**
 * Port for the payout provider (RazorpayX today). Payouts go from Nikhil Enterprises' business
 * account to a driver's verified bank account; there is no driver-controlled transfer.
 *
 * Implementations throw RazorpayApiError (definitive) or RazorpayUnavailableError (retryable).
 * Callers must never hold database locks while calling these methods.
 */

export const PAYOUT_PROVIDER_RAZORPAYX = 'RAZORPAYX';
export const PAYOUT_PROVIDER_SIMULATED = 'SIMULATED';

export interface ProviderPayout {
  /** pout_... */
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  /** queued, pending, scheduled, processing, processed, reversed, failed, rejected, cancelled */
  readonly status: string;
  /** Our payout id, sent as reference_id. */
  readonly referenceId: string | null;
  readonly fundAccountId: string | null;
  readonly utr: string | null;
  readonly failureReason: string | null;
}

export interface CreateContactInput {
  /** Our driver id, sent as reference_id. */
  readonly driverId: string;
  readonly name: string;
}

export interface CreateBankFundAccountInput {
  readonly contactId: string;
  readonly holderName: string;
  readonly ifsc: string;
  /** Sent to the provider only; never stored or logged. */
  readonly accountNumber: string;
}

/**
 * A bank-account validation (RazorpayX Fund Account Validation, a penny drop): the bank reports
 * whether the account is active and the holder name it has on record.
 */
export interface ProviderBankValidation {
  /** fav_... */
  readonly id: string;
  /** created, completed or failed. */
  readonly status: string;
  readonly fundAccountId: string | null;
  /** active or invalid, once completed. */
  readonly accountStatus: string | null;
  /** The holder name registered with the bank, once completed. */
  readonly registeredName: string | null;
  /** The provider's name-match score (0-100), when it returns one. */
  readonly nameMatchScore: number | null;
  readonly utr: string | null;
  readonly failureReason: string | null;
}

export interface ValidateBankAccountInput {
  readonly fundAccountId: string;
  /** Our bank account id and validation purpose, for the provider's records. */
  readonly notes: Readonly<Record<string, string>>;
}

export interface CreatePayoutInput {
  /** X-Payout-Idempotency: our payout id. Retries reuse it, so a transfer is never duplicated. */
  readonly idempotencyKey: string;
  readonly referenceId: string;
  readonly fundAccountId: string;
  readonly amountPaise: number;
  readonly mode: 'IMPS' | 'NEFT' | 'RTGS';
  readonly narration: string;
  readonly queueIfLowBalance: boolean;
  readonly notes: Readonly<Record<string, string>>;
}

export abstract class PayoutGateway {
  /** False when no payout provider is configured; every call then fails. */
  abstract readonly enabled: boolean;
  /** Stored on bank accounts, validations and payouts: RAZORPAYX, or SIMULATED outside production. */
  abstract readonly provider: string;

  /** Starts a bank validation of an existing fund account. The result may arrive later. */
  abstract validateBankAccount(input: ValidateBankAccountInput): Promise<ProviderBankValidation>;

  abstract fetchBankValidation(validationId: string): Promise<ProviderBankValidation>;

  abstract createContact(input: CreateContactInput): Promise<{ contactId: string }>;

  abstract createBankFundAccount(
    input: CreateBankFundAccountInput,
  ): Promise<{ fundAccountId: string }>;

  abstract createPayout(input: CreatePayoutInput): Promise<ProviderPayout>;

  abstract fetchPayout(providerPayoutId: string): Promise<ProviderPayout>;

  /** The provider payout created with this reference_id, if any (recovery after a lost reply). */
  abstract findPayoutByReference(referenceId: string): Promise<ProviderPayout | null>;
}
