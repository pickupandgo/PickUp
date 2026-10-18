import request from 'supertest';
import type { FakeQuote } from './fake-payment-backend';
import type { TestContext } from './test-app';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Method = 'get' | 'post' | 'patch';

/** One request as a signed-in user (a Firebase subject), or anonymous (null). */
export function call(
  ctx: TestContext,
  method: Method,
  path: string,
  subject: string | null,
  body?: object,
): request.Test {
  let test = request(ctx.server)[method](path);
  if (subject !== null) {
    test = test.set('Authorization', ctx.tokens.bearer(subject));
  }
  return body === undefined ? test : test.send(body);
}

export const get = (ctx: TestContext, path: string, subject: string | null) =>
  call(ctx, 'get', path, subject);

export const post = (
  ctx: TestContext,
  path: string,
  subject: string | null,
  body: object = {},
) => call(ctx, 'post', path, subject, body);

let sequence = 0;

/** Fresh Firebase subjects for one test. */
export function people(label: string): { customer: string; driver: string } {
  sequence += 1;
  const tag = `${label}-${sequence}`;
  return { customer: `cust-${tag}`, driver: `drv-${tag}` };
}

export type PaymentMethod = 'PAY_AT_PICKUP' | 'PAY_AT_DELIVERY';

export interface RideOptions {
  readonly customer: string;
  readonly driver: string;
  readonly drops?: number;
  readonly paymentMethod?: PaymentMethod;
  /** Provision the customer at the payment backend (default true). */
  readonly customerKnown?: boolean;
  /** Provision the driver at the payment backend (default true). */
  readonly driverKnown?: boolean;
  readonly driverApproved?: boolean;
  /** Put the driver online in the engine first (default true). */
  readonly online?: boolean;
  /** Extra fields for POST /rides. */
  readonly body?: Record<string, unknown>;
  /** Use this quote instead of a fresh one. */
  readonly quote?: FakeQuote;
}

export async function goOnline(ctx: TestContext, driver: string) {
  await call(ctx, 'patch', `/drivers/${driver}/availability`, driver, {
    isAvailable: true,
  }).expect(200);
}

/** POST /rides for a fresh quote of the payment backend; returns the raw response. */
export async function requestRide(ctx: TestContext, options: RideOptions) {
  if (options.customerKnown !== false) {
    ctx.backend.addCustomer(options.customer);
  }
  if (options.driverKnown !== false) {
    ctx.backend.addDriver(options.driver, options.driverApproved ?? true);
  }
  if (options.online !== false) {
    await goOnline(ctx, options.driver);
  }
  const quote =
    options.quote ??
    ctx.backend.createQuote({
      customerSubject: options.customer,
      drops: options.drops ?? 1,
    });
  const response = await post(ctx, '/rides', options.customer, {
    quoteId: quote.quoteId,
    paymentMethod: options.paymentMethod ?? 'PAY_AT_PICKUP',
    driverId: options.driver,
    ...options.body,
  });
  return { quote, response };
}

export interface BookedRide {
  readonly rideId: string;
  readonly externalRef: string;
  readonly quote: FakeQuote;
  readonly paymentBookingId: string;
}

export async function bookRide(
  ctx: TestContext,
  options: RideOptions,
): Promise<BookedRide> {
  const { quote, response } = await requestRide(ctx, options);
  expect(response.status).toBe(201);
  return {
    rideId: response.body.ride.id,
    externalRef: response.body.ride.externalRef,
    quote,
    paymentBookingId: response.body.ride.paymentBookingId,
  };
}

export interface AcceptedTrip extends BookedRide {
  readonly tripId: string;
  readonly stopIds: readonly string[];
  readonly paymentTripId: string | null;
}

export async function acceptTrip(
  ctx: TestContext,
  options: RideOptions,
): Promise<AcceptedTrip> {
  const ride = await bookRide(ctx, options);
  const accepted = await post(
    ctx,
    `/rides/${ride.rideId}/accept`,
    options.driver,
  );
  expect(accepted.status).toBe(201);
  return {
    ...ride,
    tripId: accepted.body.trip.id,
    stopIds: accepted.body.trip.stops.map((stop: { id: string }) => stop.id),
    paymentTripId: accepted.body.trip.paymentTripId,
  };
}

/** The OTPs as the engine stores them (tests only; apps read GET /rides/:id/otps). */
export async function storedOtps(ctx: TestContext, rideId: string) {
  const booking = await ctx.prisma.engineBooking.findUniqueOrThrow({
    where: { id: rideId },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  });
  return {
    pickup: booking.pickupOtp,
    stops: booking.stops.map((stop) => stop.otp),
  };
}

/** Accepted, arrived at the pickup, paid there (PAY_AT_PICKUP), pickup OTP verified. */
export async function pickUp(
  ctx: TestContext,
  options: RideOptions,
): Promise<AcceptedTrip> {
  const trip = await acceptTrip(ctx, options);
  await post(ctx, `/trips/${trip.tripId}/arrive`, options.driver).expect(201);
  if ((options.paymentMethod ?? 'PAY_AT_PICKUP') === 'PAY_AT_PICKUP') {
    ctx.backend.payBooking(trip.paymentBookingId);
  }
  const otps = await get(
    ctx,
    `/rides/${trip.rideId}/otps`,
    options.customer,
  ).expect(200);
  await post(ctx, `/trips/${trip.tripId}/pickup/verify-otp`, options.driver, {
    otp: otps.body.pickup.otp,
  }).expect(201);
  return trip;
}

/** Picked up and started (heading to the first drop). */
export async function startTrip(
  ctx: TestContext,
  options: RideOptions,
): Promise<AcceptedTrip> {
  const trip = await pickUp(ctx, options);
  await post(ctx, `/trips/${trip.tripId}/start`, options.driver).expect(201);
  return trip;
}

/**
 * Drop `index` (0-based): arrive, the receiver pays (PAY_AT_DELIVERY, at the payment backend),
 * OTP from the customer's gated endpoint, then the photo. Returns the delivery response.
 */
export async function deliverStop(
  ctx: TestContext,
  trip: AcceptedTrip,
  options: RideOptions,
  index: number,
) {
  const stopId = trip.stopIds[index];
  await post(ctx, `/trips/${trip.tripId}/stop/arrive`, options.driver, {
    stopId,
  }).expect(201);
  if (options.paymentMethod === 'PAY_AT_DELIVERY') {
    ctx.backend.payStop(trip.paymentBookingId, index + 1);
  }
  const otps = await get(
    ctx,
    `/rides/${trip.rideId}/otps`,
    options.customer,
  ).expect(200);
  await post(ctx, `/trips/${trip.tripId}/stop/verify-otp`, options.driver, {
    stopId,
    otp: otps.body.stops[index].otp,
  }).expect(201);
  return post(
    ctx,
    `/trips/${trip.tripId}/stop/confirm-delivery`,
    options.driver,
    { stopId, photo: { uri: `file://proof-${index + 1}.jpg` } },
  ).expect(201);
}

/** The engine's outbox for a booking, oldest first. */
export function outboxOf(ctx: TestContext, bookingId: string) {
  return ctx.prisma.engineOutbox.findMany({
    where: { bookingId },
    orderBy: { id: 'asc' },
  });
}

/** Makes the booking's pending records due now (as if their backoff had passed). */
export async function makeDue(ctx: TestContext, bookingId: string) {
  await ctx.prisma.engineOutbox.updateMany({
    where: { bookingId, status: 'PENDING' },
    data: { nextAttemptAt: new Date(Date.now() - 1_000) },
  });
}

/** Every key, at any depth, of a JSON value. */
export function keysDeep(value: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => keysDeep(item, found));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      keysDeep(item, found);
    }
  }
  return [...found];
}

/** Response fields that would carry a handover OTP. None may appear outside /rides/:id/otps. */
export const OTP_KEYS = ['otp', 'pickupOtp', 'stopOtps', 'otps'];
