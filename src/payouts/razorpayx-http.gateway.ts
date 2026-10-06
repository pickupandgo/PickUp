import { z } from 'zod';
import type { AppConfig } from '../config/app-config';
import { assertNotes, assertPattern, RazorpayHttpClient } from '../razorpay/razorpay-http-client';
import {
  type CreateBankFundAccountInput,
  type CreateContactInput,
  type CreatePayoutInput,
  PAYOUT_PROVIDER_RAZORPAYX,
  PayoutGateway,
  type ProviderBankValidation,
  type ProviderPayout,
  type ValidateBankAccountInput,
} from './payout.gateway';

export const PAYOUT_ID_PATTERN = /^pout_[A-Za-z0-9]{6,40}$/;
export const VALIDATION_ID_PATTERN = /^fav_[A-Za-z0-9]{6,40}$/;
const CONTACT_ID_PATTERN = /^cont_[A-Za-z0-9]{6,40}$/;
const FUND_ACCOUNT_ID_PATTERN = /^fa_[A-Za-z0-9]{6,40}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{4,36}$/;
/** Penny-drop amount (Rs 1, RazorpayX's documented default). */
const VALIDATION_AMOUNT_PAISE = 100;

const contactSchema = z.looseObject({ id: z.string().regex(CONTACT_ID_PATTERN) });
const fundAccountSchema = z.looseObject({ id: z.string().regex(FUND_ACCOUNT_ID_PATTERN) });

const validationResultsSchema = z
  .looseObject({
    account_status: z.string().max(30).nullish(),
    registered_name: z.string().max(200).nullish(),
    name_match_score: z.number().int().min(0).max(100).nullish(),
  })
  .nullish();

/** Both documented response shapes: `results` (fund account validation) and `validation_results`. */
export const razorpayxValidationSchema = z.looseObject({
  id: z.string().regex(VALIDATION_ID_PATTERN),
  status: z.string().min(1).max(30),
  fund_account: z.looseObject({ id: z.string().nullish() }).nullish(),
  results: validationResultsSchema,
  validation_results: validationResultsSchema,
  utr: z.string().max(100).nullish(),
  status_details: z
    .looseObject({ reason: z.string().nullish(), description: z.string().nullish() })
    .nullish(),
});

export function toProviderBankValidation(
  raw: z.infer<typeof razorpayxValidationSchema>,
): ProviderBankValidation {
  const results = raw.validation_results ?? raw.results ?? null;
  const reason = raw.status_details?.description ?? raw.status_details?.reason ?? null;
  return {
    id: raw.id,
    status: raw.status,
    fundAccountId: raw.fund_account?.id ?? null,
    accountStatus: results?.account_status ?? null,
    registeredName: results?.registered_name ?? null,
    nameMatchScore: results?.name_match_score ?? null,
    utr: raw.utr ?? null,
    failureReason: reason ? reason.slice(0, 250) : null,
  };
}

export const razorpayxPayoutSchema = z.looseObject({
  id: z.string().regex(PAYOUT_ID_PATTERN),
  entity: z.literal('payout'),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.string().min(1).max(30),
  reference_id: z.string().nullish(),
  fund_account_id: z.string().nullish(),
  utr: z.string().nullish(),
  failure_reason: z.string().nullish(),
  status_details: z
    .looseObject({ reason: z.string().nullish(), description: z.string().nullish() })
    .nullish(),
});

const payoutCollectionSchema = z.looseObject({
  entity: z.literal('collection'),
  items: z.array(razorpayxPayoutSchema),
});

export function toProviderPayout(raw: z.infer<typeof razorpayxPayoutSchema>): ProviderPayout {
  const reason =
    raw.status_details?.description ?? raw.status_details?.reason ?? raw.failure_reason ?? null;
  return {
    id: raw.id,
    amount: raw.amount,
    currency: raw.currency,
    status: raw.status,
    referenceId: raw.reference_id ?? null,
    fundAccountId: raw.fund_account_id ?? null,
    utr: raw.utr ?? null,
    failureReason: reason ? reason.slice(0, 250) : null,
  };
}

/** RazorpayX contact and fund-account names: letters, digits, space and a few marks. */
function providerName(name: string, maxLength: number): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9 .'_/()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .replace(/[^A-Za-z0-9.]+$/, '');
  if (cleaned.length < 3) {
    throw new RangeError('Name must have at least 3 usable characters');
  }
  return cleaned;
}

/**
 * RazorpayX Payouts through the documented REST API (contacts, fund accounts, payouts). Every
 * payout carries X-Payout-Idempotency = our payout id, so a retried or duplicated submission
 * returns the original transfer instead of sending money twice.
 */
export class RazorpayXHttpGateway extends PayoutGateway {
  readonly enabled = true;
  readonly provider = PAYOUT_PROVIDER_RAZORPAYX;
  private readonly http: RazorpayHttpClient;
  private readonly accountNumber: string;

  constructor(config: AppConfig) {
    super();
    const razorpayx = config.payouts.razorpayx;
    if (!razorpayx) {
      throw new Error('RazorpayX is not configured');
    }
    this.accountNumber = razorpayx.accountNumber;
    this.http = new RazorpayHttpClient({
      keyId: razorpayx.keyId,
      keySecret: razorpayx.keySecret,
      baseUrl: config.razorpay.apiBaseUrl,
      timeoutMs: config.razorpay.timeoutMs,
      name: RazorpayXHttpGateway.name,
    });
  }

  async createContact(input: CreateContactInput): Promise<{ contactId: string }> {
    const json = await this.http.request('POST', '/v1/contacts', {
      body: {
        name: providerName(input.name, 50),
        type: 'vendor',
        reference_id: input.driverId,
        notes: { driver_id: input.driverId },
      },
    });
    return { contactId: this.http.parse(contactSchema, json, 'contact').id };
  }

  async createBankFundAccount(
    input: CreateBankFundAccountInput,
  ): Promise<{ fundAccountId: string }> {
    assertPattern(input.contactId, CONTACT_ID_PATTERN, 'contact id');
    const json = await this.http.request('POST', '/v1/fund_accounts', {
      body: {
        contact_id: input.contactId,
        account_type: 'bank_account',
        bank_account: {
          name: providerName(input.holderName, 120),
          ifsc: input.ifsc,
          account_number: input.accountNumber,
        },
      },
    });
    return { fundAccountId: this.http.parse(fundAccountSchema, json, 'fund account').id };
  }

  /**
   * Fund Account Validation of an existing fund account (penny drop):
   * POST /v1/fund_accounts/validations. The result usually arrives later, through the
   * fund_account.validation.* webhook or fetchBankValidation.
   */
  async validateBankAccount(input: ValidateBankAccountInput): Promise<ProviderBankValidation> {
    assertPattern(input.fundAccountId, FUND_ACCOUNT_ID_PATTERN, 'fund account id');
    assertNotes(input.notes);
    const json = await this.http.request('POST', '/v1/fund_accounts/validations', {
      body: {
        account_number: this.accountNumber,
        fund_account: { id: input.fundAccountId },
        amount: VALIDATION_AMOUNT_PAISE,
        currency: 'INR',
        notes: input.notes,
      },
    });
    return toProviderBankValidation(
      this.http.parse(razorpayxValidationSchema, json, 'fund account validation'),
    );
  }

  async fetchBankValidation(validationId: string): Promise<ProviderBankValidation> {
    assertPattern(validationId, VALIDATION_ID_PATTERN, 'validation id');
    const json = await this.http.request('GET', `/v1/fund_accounts/validations/${validationId}`);
    return toProviderBankValidation(
      this.http.parse(razorpayxValidationSchema, json, 'fund account validation'),
    );
  }

  async createPayout(input: CreatePayoutInput): Promise<ProviderPayout> {
    assertPattern(input.idempotencyKey, IDEMPOTENCY_PATTERN, 'idempotency key');
    assertPattern(input.fundAccountId, FUND_ACCOUNT_ID_PATTERN, 'fund account id');
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 100) {
      throw new RangeError('Payout amount must be at least 100 paise');
    }
    if (input.referenceId.length > 40) {
      throw new RangeError('Payout reference must be at most 40 characters');
    }
    assertNotes(input.notes);
    const json = await this.http.request('POST', '/v1/payouts', {
      headers: { 'X-Payout-Idempotency': input.idempotencyKey },
      body: {
        account_number: this.accountNumber,
        fund_account_id: input.fundAccountId,
        amount: input.amountPaise,
        currency: 'INR',
        mode: input.mode,
        purpose: 'payout',
        queue_if_low_balance: input.queueIfLowBalance,
        reference_id: input.referenceId,
        narration: input.narration,
        notes: input.notes,
      },
    });
    return toProviderPayout(this.http.parse(razorpayxPayoutSchema, json, 'payout'));
  }

  async fetchPayout(providerPayoutId: string): Promise<ProviderPayout> {
    assertPattern(providerPayoutId, PAYOUT_ID_PATTERN, 'payout id');
    const json = await this.http.request('GET', `/v1/payouts/${providerPayoutId}`);
    return toProviderPayout(this.http.parse(razorpayxPayoutSchema, json, 'payout'));
  }

  async findPayoutByReference(referenceId: string): Promise<ProviderPayout | null> {
    if (referenceId.length === 0 || referenceId.length > 40) {
      throw new RangeError('Payout reference must be 1-40 characters');
    }
    const json = await this.http.request('GET', '/v1/payouts', {
      query: { account_number: this.accountNumber, reference_id: referenceId, count: '10' },
    });
    const collection = this.http.parse(payoutCollectionSchema, json, 'payout collection');
    const match = collection.items.find((payout) => payout.reference_id === referenceId);
    return match ? toProviderPayout(match) : null;
  }
}
