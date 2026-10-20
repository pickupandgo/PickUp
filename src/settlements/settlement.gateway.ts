/**
 * Port for merchant settlement data: which customer payments Razorpay has settled to Nikhil
 * Enterprises' bank account, and in which settlement. This is the only evidence that makes an
 * ONLINE driver earning payable (OPEN_DECISIONS D-45). Payment capture is never treated as
 * settlement, and no settlement timing (T+2 or otherwise) is assumed anywhere.
 *
 * Implementations throw RazorpayApiError (definitive) or RazorpayUnavailableError (retryable).
 */

export type SettlementSource = 'RAZORPAY_RECON' | 'SIMULATED';

/** A calendar date (the settlement date Razorpay files the settlement under). */
export interface SettlementDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface SettledPayment {
  /** pay_... */
  readonly providerPaymentId: string;
  /** setl_... */
  readonly providerSettlementId: string;
  readonly settlementUtr: string | null;
  readonly settledAt: Date;
  /** The payment amount reported in the settlement data, in paise. */
  readonly amountPaise: number;
  /** Razorpay's fee and tax on the payment, as reported, in paise. */
  readonly feePaise: number;
  readonly taxPaise: number;
  readonly orderId: string | null;
}

export abstract class SettlementGateway {
  /** False when settlement tracking is off: nothing ever becomes settled. */
  abstract readonly enabled: boolean;
  abstract readonly source: SettlementSource;

  /** Every customer payment reported as settled on that settlement date. */
  abstract listSettledPayments(day: SettlementDay): Promise<SettledPayment[]>;
}

export function formatSettlementDay(day: SettlementDay): string {
  return `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}
