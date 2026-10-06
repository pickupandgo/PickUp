import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { AppConfig } from '../config/app-config';
import { RazorpayHttpClient } from '../razorpay/razorpay-http-client';
import { RazorpayApiError } from '../razorpay/razorpay.errors';
import { RAZORPAY_PAYMENT_ID_PATTERN } from '../razorpay/razorpay.types';
import {
  formatSettlementDay,
  type SettledPayment,
  type SettlementDay,
  SettlementGateway,
} from './settlement.gateway';

export const SETTLEMENT_ID_PATTERN = /^setl_[A-Za-z0-9]{6,40}$/;
/** Razorpay's documented maximum page size for settlement reconciliation. */
const PAGE_SIZE = 1000;
/** 100 pages = 100,000 entries for one day; more means something is wrong, so stop. */
const MAX_PAGES = 100;

const reconItemSchema = z.looseObject({
  entity_id: z.string().max(100),
  type: z.string().max(40),
  amount: z.number().int().nonnegative(),
  fee: z.number().int().nullish(),
  tax: z.number().int().nullish(),
  settled: z.boolean().nullish(),
  on_hold: z.boolean().nullish(),
  settled_at: z.number().int().positive().nullish(),
  settlement_id: z.string().max(100).nullish(),
  settlement_utr: z.string().max(100).nullish(),
  order_id: z.string().max(100).nullish(),
});

const reconCollectionSchema = z.looseObject({
  entity: z.literal('collection'),
  items: z.array(reconItemSchema),
});

/**
 * Razorpay settlement reconciliation through the documented REST API:
 *   GET /v1/settlements/recon/combined?year=&month=&day=&count=&skip=
 * Only `payment` entries that Razorpay marks settled, with a settlement id and time, count. A
 * payment on hold, unsettled or malformed is simply not reported, so it stays unpayable.
 */
export class RazorpaySettlementHttpGateway extends SettlementGateway {
  readonly enabled = true;
  readonly source = 'RAZORPAY_RECON' as const;
  private readonly logger = new Logger(RazorpaySettlementHttpGateway.name);
  private readonly http: RazorpayHttpClient;

  constructor(config: AppConfig) {
    super();
    this.http = new RazorpayHttpClient({
      keyId: config.razorpay.keyId,
      keySecret: config.razorpay.keySecret,
      baseUrl: config.razorpay.apiBaseUrl,
      timeoutMs: config.razorpay.timeoutMs,
      name: RazorpaySettlementHttpGateway.name,
    });
  }

  async listSettledPayments(day: SettlementDay): Promise<SettledPayment[]> {
    const settled: SettledPayment[] = [];
    let skipped = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const json = await this.http.request('GET', '/v1/settlements/recon/combined', {
        query: {
          year: String(day.year),
          month: String(day.month),
          day: String(day.day),
          count: String(PAGE_SIZE),
          skip: String(page * PAGE_SIZE),
        },
      });
      const { items } = this.http.parse(reconCollectionSchema, json, 'settlement recon');
      for (const item of items) {
        const payment = toSettledPayment(item);
        if (payment) {
          settled.push(payment);
        } else if (item.type === 'payment' && item.settled === true) {
          skipped += 1;
        }
      }
      if (items.length < PAGE_SIZE) {
        if (skipped > 0) {
          this.logger.warn(
            { day: formatSettlementDay(day), skipped, alert: 'SETTLEMENT_ANOMALY' },
            'Settled payments without a usable settlement id or time were ignored',
          );
        }
        return settled;
      }
    }
    throw new RazorpayApiError(
      502,
      'RECON_TOO_LARGE',
      `Settlement recon for ${formatSettlementDay(day)} exceeded ${MAX_PAGES} pages`,
    );
  }
}

function toSettledPayment(item: z.infer<typeof reconItemSchema>): SettledPayment | null {
  if (
    item.type !== 'payment' ||
    item.settled !== true ||
    item.on_hold === true ||
    !RAZORPAY_PAYMENT_ID_PATTERN.test(item.entity_id) ||
    !item.settlement_id ||
    !SETTLEMENT_ID_PATTERN.test(item.settlement_id) ||
    !item.settled_at
  ) {
    return null;
  }
  return {
    providerPaymentId: item.entity_id,
    providerSettlementId: item.settlement_id,
    settlementUtr: item.settlement_utr ?? null,
    settledAt: new Date(item.settled_at * 1000),
    amountPaise: item.amount,
    feePaise: Math.max(0, item.fee ?? 0),
    taxPaise: Math.max(0, item.tax ?? 0),
    orderId: item.order_id ?? null,
  };
}
