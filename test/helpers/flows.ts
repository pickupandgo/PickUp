import request from 'supertest';
import type { EngineTripStatus } from '../../src/bookings/trip-lifecycle';
import {
  MerchantSettlementsService,
  type SettlementSyncResult,
} from '../../src/settlements/merchant-settlements.service';
import { WalletService } from '../../src/wallet/wallet.service';
import { bearer, idempotencyKey, type TestCustomer, type TestDriver } from './fixtures';
import type { SignedWebhook } from './razorpay-payloads';
import type { TestContext } from './test-app';
import { TEST_INTERNAL_API_KEY } from './test-config';

export type PaymentMethod = 'PREPAID_UPI' | 'PAY_AT_PICKUP' | 'PAY_AT_DELIVERY';

export const TO_DELIVERED: readonly EngineTripStatus[] = [
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
];

/** A request from the trip engine (server to server). */
export function engine(ctx: TestContext) {
  const withKey = (test: request.Test) => test.set('X-Internal-Api-Key', TEST_INTERNAL_API_KEY);
  return {
    post: (path: string) => withKey(request(ctx.server).post(path)),
    get: (path: string) => withKey(request(ctx.server).get(path)),
  };
}

export interface BookingOptions {
  readonly paymentMethod: PaymentMethod;
  readonly farePaise: number;
  readonly category: string;
  readonly externalRef?: string;
}

/** Registers a confirmed booking through the internal API and returns its id. */
export async function registerBooking(
  ctx: TestContext,
  customer: TestCustomer,
  options: BookingOptions,
): Promise<string> {
  const res = await engine(ctx)
    .post('/v1/internal/bookings')
    .send({
      externalRef: options.externalRef ?? `ENG-${idempotencyKey()}`,
      customerSubject: customer.subject,
      vehicleCategory: options.category,
      paymentMethod: options.paymentMethod,
      confirmedFarePaise: options.farePaise,
    })
    .expect(201);
  return res.body.bookingId as string;
}

export async function assignDriver(
  ctx: TestContext,
  bookingId: string,
  driver: TestDriver,
): Promise<string> {
  const res = await engine(ctx)
    .post(`/v1/internal/bookings/${bookingId}/assign`)
    .send({ driverSubject: driver.subject })
    .expect(200);
  return res.body.trip.tripId as string;
}

export function setTripStatus(
  ctx: TestContext,
  tripId: string,
  status: EngineTripStatus,
): request.Test {
  return engine(ctx).post(`/v1/internal/trips/${tripId}/status`).send({ status });
}

export async function advanceTrip(
  ctx: TestContext,
  tripId: string,
  statuses: readonly EngineTripStatus[],
): Promise<void> {
  for (const status of statuses) {
    await setTripStatus(ctx, tripId, status).expect(200);
  }
}

/** Booking registered and assigned; the trip is at DRIVER_ASSIGNED. */
export async function bookedTrip(
  ctx: TestContext,
  customer: TestCustomer,
  driver: TestDriver,
  options: BookingOptions,
): Promise<{ bookingId: string; tripId: string }> {
  const bookingId = await registerBooking(ctx, customer, options);
  const tripId = await assignDriver(ctx, bookingId, driver);
  return { bookingId, tripId };
}

export function collect(
  ctx: TestContext,
  driver: TestDriver,
  tripId: string,
  body: { method: 'CASH' | 'ONLINE_QR'; amountPaise: number },
  key: string = idempotencyKey(),
): request.Test {
  return request(ctx.server)
    .post(`/v1/trips/${tripId}/collections`)
    .set(bearer(driver.token))
    .set('Idempotency-Key', key)
    .send(body);
}

export function startBookingPayment(
  ctx: TestContext,
  customer: TestCustomer,
  bookingId: string,
  key: string = idempotencyKey(),
): request.Test {
  return request(ctx.server)
    .post(`/v1/bookings/${bookingId}/payment`)
    .set(bearer(customer.token))
    .set('Idempotency-Key', key)
    .send();
}

export function verifyBookingPayment(
  ctx: TestContext,
  customer: TestCustomer,
  bookingId: string,
  body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
): request.Test {
  return request(ctx.server)
    .post(`/v1/bookings/${bookingId}/payment/verify`)
    .set(bearer(customer.token))
    .send(body);
}

export function sendPayoutWebhook(
  ctx: TestContext,
  webhook: SignedWebhook,
  options: { signature?: string } = {},
): request.Test {
  return request(ctx.server)
    .post('/v1/webhooks/razorpayx')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', options.signature ?? webhook.signature)
    .set('X-Razorpay-Event-Id', webhook.eventId)
    .send(webhook.body);
}

/**
 * Razorpay settles a customer payment to Nikhil Enterprises, and the backend's settlement sync
 * picks it up (the same code path as the scheduled pull and the admin sync).
 */
export function settleAndSync(
  ctx: TestContext,
  providerPaymentId: string,
  amountPaise: number,
  settledAt?: Date,
): Promise<SettlementSyncResult> {
  ctx.settlements.settle({ providerPaymentId, amountPaise, settledAt });
  return ctx.app.get(MerchantSettlementsService).sync({ trigger: 'ADMIN' });
}

/** Credits a driver wallet through the real ledger, as an admin adjustment would. */
export async function fundWallet(
  ctx: TestContext,
  admin: { token: string },
  driverId: string,
  amountPaise: number,
): Promise<void> {
  const wallet = await ctx.app.get(WalletService).ensureWalletForDriver(driverId);
  await request(ctx.server)
    .post(`/v1/admin/wallets/${wallet.id}/adjustments`)
    .set(bearer(admin.token))
    .set('Idempotency-Key', idempotencyKey())
    .send({ direction: 'CREDIT', amountPaise, reason: 'Integration test wallet funding' })
    .expect(201);
}
