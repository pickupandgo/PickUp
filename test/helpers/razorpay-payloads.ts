import { randomBytes } from 'node:crypto';
import type { CollectionLinkPayment } from '../../src/collections/collection-link.gateway';
import type { ProviderBankValidation, ProviderPayout } from '../../src/payouts/payout.gateway';
import { hmacSha256Hex } from '../../src/razorpay/razorpay-signatures';
import type { RazorpayPayment } from '../../src/razorpay/razorpay.types';
import {
  TEST_RAZORPAY_KEY_SECRET,
  TEST_RAZORPAYX_WEBHOOK_SECRET,
  TEST_WEBHOOK_SECRET,
} from './test-config';

export function checkoutSignature(
  orderId: string,
  paymentId: string,
  secret = TEST_RAZORPAY_KEY_SECRET,
): string {
  return hmacSha256Hex(secret, `${orderId}|${paymentId}`);
}

export interface SignedWebhook {
  readonly body: string;
  readonly signature: string;
  readonly eventId: string;
}

export interface WebhookOptions {
  readonly eventId?: string;
  readonly secret?: string;
}

/** Builds a webhook body in Razorpay's documented shape and signs it like Razorpay does. */
export function buildWebhook(
  event: string,
  payment: RazorpayPayment,
  options: WebhookOptions = {},
): SignedWebhook {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    payment: {
      entity: {
        id: payment.id,
        entity: 'payment',
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        order_id: payment.orderId,
        method: payment.method,
        captured: payment.status === 'captured',
        email: 'void@razorpay.com',
        contact: '+910000000000',
        created_at: now,
      },
    },
  };
  if (event === 'order.paid') {
    payload['order'] = {
      entity: {
        id: payment.orderId,
        entity: 'order',
        amount: payment.amount,
        amount_paid: payment.amount,
        amount_due: 0,
        currency: payment.currency,
        status: 'paid',
      },
    };
  }

  const body = JSON.stringify({
    entity: 'event',
    account_id: 'acc_TestAccount01',
    event,
    contains: Object.keys(payload),
    payload,
    created_at: now,
  });
  return {
    body,
    signature: hmacSha256Hex(options.secret ?? TEST_WEBHOOK_SECRET, body),
    eventId: options.eventId ?? `evt_${randomBytes(8).toString('hex')}`,
  };
}

function signedEvent(
  event: string,
  payload: Record<string, unknown>,
  options: WebhookOptions,
  defaultSecret: string,
): SignedWebhook {
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    entity: 'event',
    account_id: 'acc_TestAccount01',
    event,
    contains: Object.keys(payload),
    payload,
    created_at: now,
  });
  return {
    body,
    signature: hmacSha256Hex(options.secret ?? defaultSecret, body),
    eventId: options.eventId ?? `evt_${randomBytes(8).toString('hex')}`,
  };
}

/** payment_link.paid / .expired / .cancelled in Razorpay's documented shape. */
export function buildPaymentLinkWebhook(
  event: string,
  link: { referenceId: string; amount: number; collectionId: string; orderId: string | null },
  payment: CollectionLinkPayment | null,
  options: WebhookOptions = {},
): SignedWebhook {
  const payload: Record<string, unknown> = {
    payment_link: {
      entity: {
        id: link.referenceId,
        entity: 'payment_link',
        amount: link.amount,
        amount_paid: payment ? payment.amount : 0,
        currency: 'INR',
        reference_id: link.collectionId,
        status: event === 'payment_link.paid' ? 'paid' : event.split('.')[1],
        order_id: link.orderId,
      },
    },
  };
  if (payment) {
    payload['order'] = {
      entity: {
        // Razorpay's samples omit the order_ prefix here.
        id: link.orderId?.replace(/^order_/, ''),
        entity: 'order',
        amount: link.amount,
        receipt: link.collectionId,
        status: 'paid',
      },
    };
    payload['payment'] = {
      entity: {
        id: payment.id,
        entity: 'payment',
        amount: payment.amount,
        currency: 'INR',
        status: 'captured',
        order_id: payment.orderId,
        method: payment.method,
        notes: { collection_id: link.collectionId },
      },
    };
  }
  return signedEvent(event, payload, options, TEST_WEBHOOK_SECRET);
}

/** payment.captured for a payment-link or QR payment (notes carry our collection id). */
export function buildCollectionPaymentWebhook(
  payment: CollectionLinkPayment,
  collectionId: string | null,
  options: WebhookOptions = {},
): SignedWebhook {
  return signedEvent(
    'payment.captured',
    {
      payment: {
        entity: {
          id: payment.id,
          entity: 'payment',
          amount: payment.amount,
          currency: 'INR',
          status: 'captured',
          order_id: payment.orderId,
          method: payment.method,
          notes: collectionId ? { collection_id: collectionId } : [],
        },
      },
    },
    options,
    TEST_WEBHOOK_SECRET,
  );
}

export function buildDisputeWebhook(
  event: string,
  dispute: { id: string; paymentId: string; amount: number; status: string },
  options: WebhookOptions = {},
): SignedWebhook {
  return signedEvent(
    event,
    {
      payment: { entity: { id: dispute.paymentId, entity: 'payment' } },
      dispute: {
        entity: {
          id: dispute.id,
          entity: 'dispute',
          payment_id: dispute.paymentId,
          amount: dispute.amount,
          currency: 'INR',
          amount_deducted: 0,
          reason_code: 'chargeback',
          status: dispute.status,
          phase: 'chargeback',
        },
      },
    },
    options,
    TEST_WEBHOOK_SECRET,
  );
}

/** RazorpayX fund_account.validation.* event, signed with the RazorpayX webhook secret. */
export function buildValidationWebhook(
  event: 'fund_account.validation.completed' | 'fund_account.validation.failed',
  validation: ProviderBankValidation,
  options: WebhookOptions = {},
): SignedWebhook {
  return signedEvent(
    event,
    {
      'fund_account.validation': {
        entity: {
          id: validation.id,
          entity: 'fund_account.validation',
          fund_account: { id: validation.fundAccountId },
          status: validation.status,
          amount: 100,
          currency: 'INR',
          results: {
            account_status: validation.accountStatus,
            registered_name: validation.registeredName,
          },
          utr: validation.utr,
          status_details: validation.failureReason
            ? { reason: 'validation_failed', description: validation.failureReason }
            : null,
        },
      },
    },
    options,
    TEST_RAZORPAYX_WEBHOOK_SECRET,
  );
}

/** Razorpay settlement.processed event (no per-payment list), signed with the webhook secret. */
export function buildSettlementWebhook(
  settlementId: string,
  createdAt: Date,
  options: WebhookOptions = {},
): SignedWebhook {
  return signedEvent(
    'settlement.processed',
    {
      settlement: {
        entity: {
          id: settlementId,
          entity: 'settlement',
          amount: 0,
          status: 'processed',
          fees: 0,
          tax: 0,
          utr: 'SETLUTR0001',
          created_at: Math.floor(createdAt.getTime() / 1000),
        },
      },
    },
    options,
    TEST_WEBHOOK_SECRET,
  );
}

/** RazorpayX payout.* event, signed with the RazorpayX webhook secret. */
export function buildPayoutWebhook(
  event: string,
  payout: ProviderPayout,
  options: WebhookOptions = {},
): SignedWebhook {
  return signedEvent(
    event,
    {
      payout: {
        entity: {
          id: payout.id,
          entity: 'payout',
          fund_account_id: payout.fundAccountId,
          amount: payout.amount,
          currency: payout.currency,
          status: payout.status,
          purpose: 'payout',
          mode: 'IMPS',
          reference_id: payout.referenceId,
          narration: 'Nikhil Enterprises Payout',
          utr: payout.utr,
          status_details: payout.failureReason
            ? { reason: 'beneficiary_bank_failure', description: payout.failureReason }
            : null,
        },
      },
    },
    options,
    TEST_RAZORPAYX_WEBHOOK_SECRET,
  );
}
