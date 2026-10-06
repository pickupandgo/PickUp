import { randomBytes } from 'node:crypto';
import { zonedParts } from '../payouts/payout-schedule';
import { type SettledPayment, type SettlementDay, SettlementGateway } from './settlement.gateway';

/** Settlement dates are filed in India time. */
const SETTLEMENT_TIME_ZONE = 'Asia/Kolkata';

export interface SimulatedSettlementInput {
  readonly providerPaymentId: string;
  readonly amountPaise: number;
  readonly settledAt?: Date;
  readonly feePaise?: number;
  readonly taxPaise?: number;
}

/**
 * In-memory stand-in for Razorpay settlement reconciliation (SETTLEMENT_PROVIDER=simulated).
 * Razorpay test mode does not settle payments, so end-to-end tests record a settlement here
 * through /v1/dev/simulate/settlements and then run the real sync, which treats it exactly like
 * recon data. Only allowed outside production with test keys (config validation).
 */
export class SimulatedSettlementGateway extends SettlementGateway {
  readonly enabled = true;
  readonly source = 'SIMULATED' as const;
  private readonly settled = new Map<string, SettledPayment>();

  /** Records (once) that a payment was settled. Repeating it returns the first settlement. */
  settle(input: SimulatedSettlementInput): SettledPayment {
    const existing = this.settled.get(input.providerPaymentId);
    if (existing) {
      return existing;
    }
    const payment: SettledPayment = {
      providerPaymentId: input.providerPaymentId,
      providerSettlementId: `setl_sim${randomBytes(7).toString('hex')}`,
      settlementUtr: `SIMUTR${randomBytes(6).toString('hex').toUpperCase()}`,
      settledAt: input.settledAt ?? new Date(),
      amountPaise: input.amountPaise,
      feePaise: input.feePaise ?? 0,
      taxPaise: input.taxPaise ?? 0,
      orderId: null,
    };
    this.settled.set(payment.providerPaymentId, payment);
    return payment;
  }

  listSettledPayments(day: SettlementDay): Promise<SettledPayment[]> {
    return Promise.resolve(
      [...this.settled.values()].filter((payment) => {
        const local = zonedParts(payment.settledAt, SETTLEMENT_TIME_ZONE);
        return local.year === day.year && local.month === day.month && local.day === day.day;
      }),
    );
  }
}

/** SETTLEMENT_PROVIDER=disabled: nothing is ever settled, so no ONLINE earning is payable. */
export class DisabledSettlementGateway extends SettlementGateway {
  readonly enabled = false;
  readonly source = 'RAZORPAY_RECON' as const;

  listSettledPayments(): Promise<SettledPayment[]> {
    return Promise.resolve([]);
  }
}
