import request from 'supertest';
import type { EngineTripStatus } from '../../src/bookings/trip-lifecycle';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  MerchantSettlementsService,
  type SettlementSyncResult,
} from '../../src/settlements/merchant-settlements.service';
import { WalletService } from '../../src/wallet/wallet.service';
import {
  bearer,
  createFareQuote,
  createLegacyBooking,
  fixturePricingVersion,
  idempotencyKey,
  type TestCustomer,
  type TestDriver,
} from './fixtures';
import type { SignedWebhook } from './razorpay-payloads';
import type { TestContext } from './test-app';
import { TEST_INTERNAL_API_KEY } from './test-config';

export type PaymentMethod = 'PREPAID_UPI' | 'PAY_AT_PICKUP' | 'PAY_AT_DELIVERY';
export type PaymentModel = 'QUOTE_PER_STOP' | 'LEGACY_BOOKING_LEVEL';

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
  /** The booking's payable amount, in paise. */
  readonly farePaise: number;
  /** Vehicle category: the quote's category (QUOTE_PER_STOP) or the booking's (legacy). */
  readonly category: string;
  readonly externalRef?: string;
  /** QUOTE_PER_STOP only: one amount per drop. Defaults to a single drop with the whole fare. */
  readonly dropPaise?: readonly number[];
  /**
   * Which model to create. Defaults to QUOTE_PER_STOP through the real registration API, except:
   *  - PREPAID_UPI only exists on historical bookings, so it is always LEGACY_BOOKING_LEVEL;
   *  - PAY_AT_DELIVERY is LEGACY_BOOKING_LEVEL until per-drop collection exists, so tests of
   *    today's whole-booking delivery collection keep running against the rows that still use it.
   */
  readonly model?: PaymentModel;
  /** Client that may insert historical rows (the table owner). Defaults to ctx.prisma. */
  readonly owner?: PrismaClient;
}

export function defaultModel(method: PaymentMethod): PaymentModel {
  return method === 'PAY_AT_PICKUP' ? 'QUOTE_PER_STOP' : 'LEGACY_BOOKING_LEVEL';
}

/**
 * Registers a confirmed booking and returns its id. QUOTE_PER_STOP: a fare quote for the
 * customer is inserted (exact amounts, no pricing involved), then the booking is registered from
 * it through the internal API, as the trip engine does. LEGACY_BOOKING_LEVEL: see
 * createLegacyBooking.
 */
export async function registerBooking(
  ctx: TestContext,
  customer: TestCustomer,
  options: BookingOptions,
): Promise<string> {
  const model = options.model ?? defaultModel(options.paymentMethod);
  const owner = options.owner ?? ctx.prisma;
  if (model === 'LEGACY_BOOKING_LEVEL') {
    const booking = await createLegacyBooking(owner, {
      customerId: customer.customerId,
      paymentMethod: options.paymentMethod,
      farePaise: options.farePaise,
      category: options.category,
      externalRef: options.externalRef,
    });
    return booking.id;
  }
  const quote = await createFareQuote(owner, {
    customerId: customer.customerId,
    pricingVersionId: (await fixturePricingVersion(owner)).id,
    dropPaise: options.dropPaise ?? [options.farePaise],
    vehicleCategory: options.category,
  });
  const res = await engine(ctx)
    .post('/v1/internal/bookings')
    .send({
      externalRef: options.externalRef ?? `ENG-${idempotencyKey()}`,
      customerSubject: customer.subject,
      quoteId: quote.quoteId,
      paymentMethod: options.paymentMethod,
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

export interface BankDetails {
  readonly accountHolderName?: string;
  readonly ifsc?: string;
  readonly accountNumber: string;
  readonly confirmAccountNumber?: string;
}

/** Step 1 of a bank-account change, with the driver's normal session. */
export function requestBankAccountChange(ctx: TestContext, driver: TestDriver): request.Test {
  return request(ctx.server)
    .post('/v1/bank-account/change-requests')
    .set(bearer(driver.token))
    .send();
}

/**
 * Step 2: what the app gets from Firebase after the driver re-authenticates with an OTP on the
 * registered phone, after the change request was created (`notBefore`).
 */
export function stepUpToken(
  ctx: TestContext,
  driver: TestDriver,
  notBefore: string | Date,
  options: { phoneNumber?: string; signInProvider?: string; authTime?: number } = {},
): string {
  const after = Math.floor(new Date(notBefore).getTime() / 1000) + 1;
  return ctx.tokens.sign(driver.subject, {
    authTime: options.authTime ?? after,
    phoneNumber: options.phoneNumber ?? driver.phone,
    signInProvider: options.signInProvider ?? 'phone',
  });
}

/** Step 3: the new details, sent with the step-up token. */
export function confirmBankAccountChange(
  ctx: TestContext,
  changeRequestId: string,
  token: string,
  details: BankDetails,
): request.Test {
  return request(ctx.server)
    .post(`/v1/bank-account/change-requests/${changeRequestId}/confirm`)
    .set(bearer(token))
    .send({
      accountHolderName: details.accountHolderName ?? 'Test Driver',
      ifsc: details.ifsc ?? 'hdfc0001234',
      accountNumber: details.accountNumber,
      confirmAccountNumber: details.confirmAccountNumber ?? details.accountNumber,
    });
}

/** The whole bank-account change: request, phone OTP re-authentication, confirm. */
export async function changeBankAccount(
  ctx: TestContext,
  driver: TestDriver,
  details: BankDetails,
): Promise<request.Response> {
  const started = await requestBankAccountChange(ctx, driver).expect(201);
  const changeRequestId = started.body.changeRequestId as string;
  const token = stepUpToken(ctx, driver, started.body.createdAt as string);
  return confirmBankAccountChange(ctx, changeRequestId, token, details);
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
