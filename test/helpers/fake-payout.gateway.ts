import {
  type CreateBankFundAccountInput,
  type CreateContactInput,
  type CreatePayoutInput,
  PAYOUT_PROVIDER_RAZORPAYX,
  PayoutGateway,
  type ProviderBankValidation,
  type ProviderPayout,
  type ValidateBankAccountInput,
} from '../../src/payouts/payout.gateway';
import { detailsKey } from '../../src/payouts/simulated-payout.gateway';
import { RazorpayApiError, RazorpayUnavailableError } from '../../src/razorpay/razorpay.errors';
import { newId } from './fake-razorpay.gateway';

type CreatePayoutBehaviour = 'unavailable' | 'reject' | 'lose-response';

interface StoredPayout extends ProviderPayout {
  idempotencyKey: string;
  status: string;
  utr: string | null;
  failureReason: string | null;
}

/**
 * In-memory RazorpayX with the documented behaviours: X-Payout-Idempotency returns the original
 * payout for a repeated key, identical contact or fund account details return the existing
 * object, and payout states are moved explicitly by the test (as in RazorpayX test mode, where
 * payouts stay in processing until moved from the dashboard).
 */
export class FakePayoutGateway extends PayoutGateway {
  readonly enabled = true;
  readonly provider = PAYOUT_PROVIDER_RAZORPAYX;
  readonly payouts = new Map<string, StoredPayout>();
  readonly fundAccounts = new Map<string, { contactId: string; ifsc: string; last4: string }>();
  private readonly contactsByDetails = new Map<string, string>();
  private readonly fundAccountsByDetails = new Map<string, string>();
  readonly validations = new Map<string, ProviderBankValidation>();
  readonly calls = {
    createContact: 0,
    createBankFundAccount: 0,
    validateBankAccount: 0,
    fetchBankValidation: 0,
    createPayout: 0,
    fetchPayout: 0,
    findPayoutByReference: 0,
  };
  /**
   * When set, a new validation completes immediately with this result (like a synchronous
   * penniless check); otherwise it stays `created` until completeValidation is called.
   */
  immediateValidation: {
    accountStatus: 'active' | 'invalid';
    registeredName: string | null;
  } | null = null;
  unavailable = false;
  /** Status a new payout starts in. RazorpayX starts most payouts in processing. */
  initialStatus = 'processing';
  private readonly createBehaviours: CreatePayoutBehaviour[] = [];
  private readonly byKey = new Map<string, string>();

  queueCreatePayoutBehaviour(behaviour: CreatePayoutBehaviour): void {
    this.createBehaviours.push(behaviour);
  }

  createContact(input: CreateContactInput): Promise<{ contactId: string }> {
    this.calls.createContact += 1;
    return this.run(() => {
      if (input.name.trim().length < 3) {
        throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The name is invalid');
      }
      const key = detailsKey(input.driverId, input.name);
      const contactId = this.contactsByDetails.get(key) ?? newId('cont_');
      this.contactsByDetails.set(key, contactId);
      return { contactId };
    });
  }

  createBankFundAccount(input: CreateBankFundAccountInput): Promise<{ fundAccountId: string }> {
    this.calls.createBankFundAccount += 1;
    return this.run(() => {
      if (input.ifsc === 'FAKE0000000') {
        throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The IFSC is invalid');
      }
      const key = detailsKey(input.contactId, input.holderName, input.ifsc, input.accountNumber);
      const fundAccountId = this.fundAccountsByDetails.get(key) ?? newId('fa_');
      this.fundAccountsByDetails.set(key, fundAccountId);
      this.fundAccounts.set(fundAccountId, {
        contactId: input.contactId,
        ifsc: input.ifsc,
        last4: input.accountNumber.slice(-4),
      });
      return { fundAccountId };
    });
  }

  validateBankAccount(input: ValidateBankAccountInput): Promise<ProviderBankValidation> {
    this.calls.validateBankAccount += 1;
    return this.run(() => {
      // Fixture accounts are written straight to the database, so any fa_ id is accepted.
      if (!input.fundAccountId.startsWith('fa_')) {
        throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The fund account does not exist');
      }
      const immediate = this.immediateValidation;
      const validation: ProviderBankValidation = {
        id: newId('fav_'),
        status: immediate ? 'completed' : 'created',
        fundAccountId: input.fundAccountId,
        accountStatus: immediate?.accountStatus ?? null,
        registeredName: immediate?.registeredName ?? null,
        nameMatchScore: null,
        utr: immediate ? newId('UTR') : null,
        failureReason: null,
      };
      this.validations.set(validation.id, validation);
      return { ...validation };
    });
  }

  fetchBankValidation(validationId: string): Promise<ProviderBankValidation> {
    this.calls.fetchBankValidation += 1;
    return this.run(() => {
      const validation = this.validations.get(validationId);
      if (!validation) {
        throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
      }
      return { ...validation };
    });
  }

  /** The bank answers a validation (what RazorpayX reports later through the webhook). */
  completeValidation(
    validationId: string,
    result: {
      status?: 'completed' | 'failed';
      accountStatus?: 'active' | 'invalid' | null;
      registeredName?: string | null;
      nameMatchScore?: number | null;
      failureReason?: string | null;
    },
  ): ProviderBankValidation {
    const validation = this.validations.get(validationId);
    if (!validation) {
      throw new Error(`Unknown fake validation ${validationId}`);
    }
    const completed: ProviderBankValidation = {
      ...validation,
      status: result.status ?? 'completed',
      accountStatus: result.accountStatus === undefined ? 'active' : result.accountStatus,
      registeredName: result.registeredName ?? null,
      nameMatchScore: result.nameMatchScore ?? null,
      failureReason: result.failureReason ?? null,
      utr: validation.utr ?? newId('UTR'),
    };
    this.validations.set(validationId, completed);
    return { ...completed };
  }

  createPayout(input: CreatePayoutInput): Promise<ProviderPayout> {
    this.calls.createPayout += 1;
    return this.run(() => {
      const behaviour = this.createBehaviours.shift();
      if (behaviour === 'unavailable') {
        throw new RazorpayUnavailableError('simulated outage');
      }
      if (behaviour === 'reject') {
        throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'simulated rejection');
      }
      const existingId = this.byKey.get(input.idempotencyKey);
      if (existingId) {
        return copy(this.require(existingId));
      }
      const payout: StoredPayout = {
        id: newId('pout_'),
        idempotencyKey: input.idempotencyKey,
        amount: input.amountPaise,
        currency: 'INR',
        status: this.initialStatus,
        referenceId: input.referenceId,
        fundAccountId: input.fundAccountId,
        utr: null,
        failureReason: null,
      };
      this.payouts.set(payout.id, payout);
      this.byKey.set(input.idempotencyKey, payout.id);
      if (behaviour === 'lose-response') {
        throw new RazorpayUnavailableError('simulated lost response');
      }
      return copy(payout);
    });
  }

  fetchPayout(providerPayoutId: string): Promise<ProviderPayout> {
    this.calls.fetchPayout += 1;
    return this.run(() => copy(this.require(providerPayoutId)));
  }

  findPayoutByReference(referenceId: string): Promise<ProviderPayout | null> {
    this.calls.findPayoutByReference += 1;
    return this.run(() => {
      const match = [...this.payouts.values()].find((payout) => payout.referenceId === referenceId);
      return match ? copy(match) : null;
    });
  }

  /** Moves a payout to a new provider state (what RazorpayX does over time). */
  setStatus(
    providerPayoutId: string,
    status: string,
    details: { utr?: string; failureReason?: string } = {},
  ): ProviderPayout {
    const payout = this.require(providerPayoutId);
    payout.status = status;
    payout.utr = details.utr ?? payout.utr;
    payout.failureReason = details.failureReason ?? payout.failureReason;
    return copy(payout);
  }

  byReference(referenceId: string): ProviderPayout | undefined {
    const match = [...this.payouts.values()].find((payout) => payout.referenceId === referenceId);
    return match ? copy(match) : undefined;
  }

  private require(providerPayoutId: string): StoredPayout {
    const payout = this.payouts.get(providerPayoutId);
    if (!payout) {
      throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
    }
    return payout;
  }

  private run<T>(work: () => T): Promise<T> {
    if (this.unavailable) {
      return Promise.reject(new RazorpayUnavailableError('simulated outage'));
    }
    try {
      return Promise.resolve(work());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function copy(payout: StoredPayout): ProviderPayout {
  return {
    id: payout.id,
    amount: payout.amount,
    currency: payout.currency,
    status: payout.status,
    referenceId: payout.referenceId,
    fundAccountId: payout.fundAccountId,
    utr: payout.utr,
    failureReason: payout.failureReason,
  };
}
