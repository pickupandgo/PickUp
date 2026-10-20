import { createHash, randomBytes } from 'node:crypto';
import { RazorpayApiError } from '../razorpay/razorpay.errors';
import {
  type CreateBankFundAccountInput,
  type CreateContactInput,
  type CreatePayoutInput,
  PAYOUT_PROVIDER_SIMULATED,
  PayoutGateway,
  type ProviderBankValidation,
  type ProviderPayout,
  type ValidateBankAccountInput,
} from './payout.gateway';

const id = (prefix: string): string => `${prefix}${randomBytes(7).toString('hex')}`;

/** Lookup key for "same details" without keeping account numbers in memory. */
export const detailsKey = (...parts: string[]): string =>
  createHash('sha256').update(parts.join('\u0000')).digest('hex');

/**
 * In-memory payout provider for non-production end-to-end runs (PAYOUT_PROVIDER=simulated, only
 * allowed outside production with Razorpay test keys). It behaves like RazorpayX test mode:
 * X-Payout-Idempotency returns the original payout for a repeated key, new payouts stay
 * `processing`, and validations stay `created`, until moved explicitly through
 * /v1/dev/simulate. Like RazorpayX, identical contact or fund account details return the
 * existing object. Results then reach the backend through the normal paths (signed webhook or
 * admin sync), never by writing to the database directly.
 */
export class SimulatedPayoutGateway extends PayoutGateway {
  readonly enabled = true;
  readonly provider = PAYOUT_PROVIDER_SIMULATED;
  private readonly contacts = new Map<string, string>();
  private readonly fundAccounts = new Map<string, { holderName: string; last4: string }>();
  private readonly fundAccountsByDetails = new Map<string, string>();
  private readonly validations = new Map<string, ProviderBankValidation>();
  private readonly payouts = new Map<string, ProviderPayout>();
  private readonly payoutsByKey = new Map<string, string>();

  createContact(input: CreateContactInput): Promise<{ contactId: string }> {
    if (input.name.trim().length < 3) {
      return Promise.reject(new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The name is invalid'));
    }
    const key = detailsKey(input.driverId, input.name);
    const contactId = this.contacts.get(key) ?? id('cont_sim');
    this.contacts.set(key, contactId);
    return Promise.resolve({ contactId });
  }

  createBankFundAccount(input: CreateBankFundAccountInput): Promise<{ fundAccountId: string }> {
    const key = detailsKey(input.contactId, input.holderName, input.ifsc, input.accountNumber);
    const fundAccountId = this.fundAccountsByDetails.get(key) ?? id('fa_sim');
    this.fundAccountsByDetails.set(key, fundAccountId);
    this.fundAccounts.set(fundAccountId, {
      holderName: input.holderName,
      last4: input.accountNumber.slice(-4),
    });
    return Promise.resolve({ fundAccountId });
  }

  validateBankAccount(input: ValidateBankAccountInput): Promise<ProviderBankValidation> {
    if (!this.fundAccounts.has(input.fundAccountId)) {
      return Promise.reject(
        new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The fund account does not exist'),
      );
    }
    const validation: ProviderBankValidation = {
      id: id('fav_sim'),
      status: 'created',
      fundAccountId: input.fundAccountId,
      accountStatus: null,
      registeredName: null,
      nameMatchScore: null,
      utr: null,
      failureReason: null,
    };
    this.validations.set(validation.id, validation);
    return Promise.resolve({ ...validation });
  }

  fetchBankValidation(validationId: string): Promise<ProviderBankValidation> {
    const validation = this.validations.get(validationId);
    return validation
      ? Promise.resolve({ ...validation })
      : Promise.reject(new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'No such validation'));
  }

  createPayout(input: CreatePayoutInput): Promise<ProviderPayout> {
    const existing = this.payoutsByKey.get(input.idempotencyKey);
    if (existing) {
      return this.fetchPayout(existing);
    }
    const payout: ProviderPayout = {
      id: id('pout_sim'),
      amount: input.amountPaise,
      currency: 'INR',
      status: 'processing',
      referenceId: input.referenceId,
      fundAccountId: input.fundAccountId,
      utr: null,
      failureReason: null,
    };
    this.payouts.set(payout.id, payout);
    this.payoutsByKey.set(input.idempotencyKey, payout.id);
    return Promise.resolve({ ...payout });
  }

  fetchPayout(providerPayoutId: string): Promise<ProviderPayout> {
    const payout = this.payouts.get(providerPayoutId);
    return payout
      ? Promise.resolve({ ...payout })
      : Promise.reject(new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'No such payout'));
  }

  findPayoutByReference(referenceId: string): Promise<ProviderPayout | null> {
    const match = [...this.payouts.values()].find((payout) => payout.referenceId === referenceId);
    return Promise.resolve(match ? { ...match } : null);
  }

  /** What the bank reports for a validation (RazorpayX completes it asynchronously). */
  completeValidation(
    validationId: string,
    result: {
      accountStatus: 'active' | 'invalid';
      registeredName: string | null;
      nameMatchScore?: number;
    },
  ): ProviderBankValidation | null {
    const validation = this.validations.get(validationId);
    if (!validation) {
      return null;
    }
    const completed: ProviderBankValidation = {
      ...validation,
      status: 'completed',
      accountStatus: result.accountStatus,
      registeredName: result.registeredName,
      nameMatchScore: result.nameMatchScore ?? null,
      utr: `SIMFAV${randomBytes(5).toString('hex').toUpperCase()}`,
    };
    this.validations.set(validationId, completed);
    return { ...completed };
  }

  /** Moves a payout the way RazorpayX does over time (processed, reversed, failed). */
  setPayoutStatus(
    providerPayoutId: string,
    status: 'processed' | 'reversed' | 'failed',
    failureReason?: string,
  ): ProviderPayout | null {
    const payout = this.payouts.get(providerPayoutId);
    if (!payout) {
      return null;
    }
    const moved: ProviderPayout = {
      ...payout,
      status,
      utr:
        payout.utr ??
        (status === 'processed' ? `SIMUTR${randomBytes(6).toString('hex').toUpperCase()}` : null),
      failureReason:
        status === 'processed' ? null : (failureReason ?? `SIMULATED_${status.toUpperCase()}`),
    };
    this.payouts.set(providerPayoutId, moved);
    return { ...moved };
  }
}
