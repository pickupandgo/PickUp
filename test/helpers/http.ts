import request from 'supertest';
import { bearer, idempotencyKey, type TestDriver } from './fixtures';
import type { SignedWebhook } from './razorpay-payloads';
import type { TestContext } from './test-app';

export interface StartedTopUp {
  readonly paymentId: string;
  readonly orderId: string;
}

/** POST /v1/wallet/topups and return the new payment and Razorpay order ids. */
export async function startTopUp(
  ctx: TestContext,
  driver: TestDriver,
  amountPaise: number,
  key: string = idempotencyKey(),
): Promise<StartedTopUp> {
  const res = await request(ctx.server)
    .post('/v1/wallet/topups')
    .set(bearer(driver.token))
    .set('Idempotency-Key', key)
    .send({ amountPaise })
    .expect(201);
  return { paymentId: res.body.paymentId as string, orderId: res.body.checkout.orderId as string };
}

export function verifyTopUp(
  ctx: TestContext,
  driver: TestDriver,
  paymentId: string,
  body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
): request.Test {
  return request(ctx.server)
    .post(`/v1/wallet/topups/${paymentId}/verify`)
    .set(bearer(driver.token))
    .send(body);
}

/** Delivers a webhook exactly as Razorpay would: raw JSON body plus signature and event id. */
export function sendWebhook(
  ctx: TestContext,
  webhook: SignedWebhook,
  options: { signature?: string; eventId?: string | null } = {},
): request.Test {
  let req = request(ctx.server)
    .post('/v1/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', options.signature ?? webhook.signature);
  const eventId = options.eventId === undefined ? webhook.eventId : options.eventId;
  if (eventId !== null) {
    req = req.set('X-Razorpay-Event-Id', eventId);
  }
  return req.send(webhook.body);
}

export async function walletBalance(ctx: TestContext, driverId: string): Promise<bigint> {
  const wallet = await ctx.prisma.driverWallet.findUnique({ where: { driverId } });
  return wallet?.balancePaise ?? 0n;
}

export async function topUpCredits(ctx: TestContext, driverId: string) {
  return ctx.prisma.driverWalletTransaction.findMany({
    where: { wallet: { driverId }, type: 'TOPUP' },
  });
}
