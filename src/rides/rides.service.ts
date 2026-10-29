import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { assertSameIdentity } from '../auth/identity';
import { engineError, paymentBackendUnavailable } from '../common/errors';
import { generateOtp } from '../common/otp';
import { parseRequest } from '../common/validation';
import { ENGINE_CONFIG, type EngineConfig } from '../config/engine-config';
import { DriversService } from '../drivers/drivers.service';
import type { EngineBooking } from '../generated/prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PaymentBackendClient } from '../payment-backend/payment-backend.client';
import type { InternalFareQuote } from '../payment-backend/payment-backend.types';
import { isUniqueViolation, lockBooking } from '../prisma/locks';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { FINAL_STOP_STATUSES } from '../trips/trip-progress';
import { TripsService } from '../trips/trips.service';
import {
  effectiveOfferStatus,
  offerView,
  type RideBundle,
  rideStatus,
  rideView,
} from './ride-views';
import { matchRoute } from './route-match';
import {
  CLIENT_AMOUNT_FIELDS,
  cancelRideSchema,
  createRideSchema,
  type CreateRideRequest,
  type DropDetail,
} from './rides.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Registration refusals the customer can only fix with a new quote or a new request. */
const CONFLICT_CODES: ReadonlySet<string> = new Set([
  'QUOTE_EXPIRED',
  'QUOTE_ALREADY_USED',
  'BOOKING_REF_CONFLICT',
  'FEE_RULE_NOT_CONFIGURED',
]);

/**
 * Bookings (the apps' "rides"): confirmation, registration with the payment backend, offers to
 * drivers and acceptance.
 *
 * Registration (review F, "Customer confirms"):
 *   1. The quote is read from the payment backend; the trip will run exactly its route.
 *   2. The engine booking is persisted first, with a stable external reference, so a retry
 *      (lost answer, crash) registers the same reference again: the backend answers 200 with
 *      the same booking.
 *   3. POST /v1/internal/bookings { externalRef, customerSubject, quoteId, paymentMethod }: no
 *      amount. The customer subject is the verified token's.
 *   4. Only a registered booking is offered to a driver.
 */
@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backend: PaymentBackendClient,
    private readonly outbox: OutboxService,
    private readonly drivers: DriversService,
    private readonly trips: TripsService,
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
  ) {}

  // ──── CONFIRMATION ────

  async createRide(subject: string, raw: unknown) {
    const amounts = Object.keys(isRecord(raw) ? raw : {}).filter((key) =>
      (CLIENT_AMOUNT_FIELDS as readonly string[]).includes(key),
    );
    if (amounts.length > 0) {
      throw engineError(
        HttpStatus.BAD_REQUEST,
        'CLIENT_AMOUNT_REJECTED',
        "The fare comes from the payment backend's quote; a ride request can't carry an amount",
        { fields: amounts },
      );
    }
    const request = parseRequest(createRideSchema, raw);
    assertSameIdentity(subject, request.customerId, 'customerId');

    let booking =
      (await this.findBooking(subject, request.quoteId)) ??
      (await this.createBooking(subject, request));
    if (booking.paymentMethod !== request.paymentMethod) {
      throw engineError(
        HttpStatus.CONFLICT,
        'BOOKING_REF_CONFLICT',
        'This quote is already booked with another payment method',
      );
    }
    if (booking.status === 'PENDING_REGISTRATION') {
      booking = await this.register(booking);
    }
    switch (booking.status) {
      case 'REGISTRATION_FAILED':
        throw registrationRefused(
          booking.registrationError ?? 'REGISTRATION_FAILED',
          null,
        );
      case 'CANCELLED':
      case 'COMPLETED':
        throw engineError(
          HttpStatus.CONFLICT,
          'BOOKING_CLOSED',
          `This booking is ${booking.status}`,
        );
      case 'ASSIGNED': {
        return rideView(await this.bundle(booking.id), new Date());
      }
      default:
        break;
    }
    await this.dispatch(booking);
    return rideView(await this.bundle(booking.id), new Date());
  }

  // ──── READS ────

  async getRide(subject: string, rideId: string) {
    const bundle = await this.bundle(rideId);
    if (bundle.booking.customerSubject !== subject) {
      throw rideNotFound(rideId);
    }
    return rideView(bundle, new Date());
  }

  /** The trip of a ride, for its customer or its driver (no OTPs). */
  async getRideTrip(subject: string, rideId: string) {
    const bundle = await this.bundle(rideId);
    const driver = bundle.trip?.driverSubject;
    if (bundle.booking.customerSubject !== subject && driver !== subject) {
      throw rideNotFound(rideId);
    }
    const trip = await this.trips.viewForBooking(rideId);
    if (!trip) {
      throw new NotFoundException(`Trip for ride ${rideId} not found`);
    }
    return trip;
  }

  /**
   * The handover OTPs, for the customer of the ride only, and only once the payment backend
   * allows the handover (review F): the PAY_AT_PICKUP pickup OTP once the booking is paid, a
   * PAY_AT_DELIVERY drop's OTP once that drop is paid. Read fresh; fails closed.
   */
  async getOtps(subject: string, rideId: string) {
    const bundle = await this.bundle(rideId);
    const { booking, stops, trip } = bundle;
    if (booking.customerSubject !== subject) {
      throw rideNotFound(rideId);
    }
    if (!booking.paymentBookingId) {
      throw engineError(
        HttpStatus.CONFLICT,
        'BOOKING_NOT_REGISTERED',
        'The booking is not confirmed yet',
      );
    }
    const outcome = await this.backend.getBooking(
      booking.paymentBookingId,
      `eng-otp-${booking.id}`,
    );
    if (outcome.kind !== 'OK') {
      throw paymentBackendUnavailable(
        'The payment status could not be read; try again.',
        {
          code: outcome.code,
        },
      );
    }
    const remote = outcome.value;
    // PAY_AT_PICKUP: the whole booking is collected at the pickup. Anything but PAID (unpaid,
    // a refund in progress or done) withholds the codes.
    const paid = remote.paymentStatus === 'PAID';
    const pickupDone =
      trip !== null &&
      [
        'PICKUP_VERIFIED',
        'IN_TRANSIT',
        'DROP_PROGRESS',
        'DELIVERED',
        'COMPLETED',
      ].includes(trip.status);
    const closed =
      booking.status === 'CANCELLED' ||
      booking.status === 'COMPLETED' ||
      remote.status === 'CANCELLED';
    const pickupWithheld = closed
      ? 'CLOSED'
      : pickupDone
        ? 'FINISHED'
        : booking.paymentMethod === 'PAY_AT_PICKUP' && !paid
          ? 'PAYMENT_REQUIRED'
          : null;
    return {
      rideId: booking.id,
      paymentMethod: booking.paymentMethod,
      paymentStatus: remote.paymentStatus,
      pickup: {
        otp: pickupWithheld ? null : booking.pickupOtp,
        withheld: pickupWithheld,
      },
      stops: stops.map((stop) => {
        const remoteStop = remote.stops.find(
          (candidate) => candidate.sequence === stop.sequence,
        );
        const withheld = closed
          ? 'CLOSED'
          : FINAL_STOP_STATUSES.has(stop.status)
            ? 'FINISHED'
            : booking.paymentMethod === 'PAY_AT_PICKUP'
              ? paid
                ? null
                : 'PAYMENT_REQUIRED'
              : remoteStop?.status === 'PAYMENT_CONFIRMED'
                ? null
                : 'PAYMENT_REQUIRED';
        return {
          sequence: stop.sequence,
          otp: withheld ? null : stop.otp,
          withheld,
        };
      }),
    };
  }

  // ──── DRIVER OFFERS ────

  async findPendingForDriver(subject: string, driverId: string) {
    assertSameIdentity(subject, driverId, 'driverId');
    // Heartbeat, as before: the driver stays discoverable while polling.
    this.drivers.findById(subject).lastSeen = Date.now();
    const now = new Date();
    await this.prisma.engineOffer.updateMany({
      where: {
        driverSubject: subject,
        status: 'REQUESTED',
        expiresAt: { lte: now },
      },
      data: { status: 'EXPIRED' },
    });
    const offer = await this.prisma.engineOffer.findFirst({
      where: {
        driverSubject: subject,
        status: 'REQUESTED',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        booking: { include: { stops: { orderBy: { sequence: 'asc' } } } },
      },
    });
    if (!offer) {
      return [];
    }
    const { booking, ...offerRow } = offer;
    const { stops, ...bookingRow } = booking;
    return [offerView(bookingRow, stops, offerRow)];
  }

  /**
   * The driver accepts: the engine trip is created with ASSIGN queued in the same transaction,
   * then ASSIGN is delivered now. The payment backend's trip id is stored when it accepts; a
   * refusal (driver not provisioned or not approved) releases the driver and reopens the
   * booking. Accepting again is a no-op for the same driver: no second trip, ever.
   */
  async acceptRide(subject: string, rideId: string, driverId?: string) {
    assertSameIdentity(subject, driverId, 'driverId');
    await this.requireBooking(rideId);
    const outcome = await this.prisma
      .runInTransaction(async (tx) => {
        await lockBooking(tx, rideId);
        const bundle = await this.bundleIn(tx, rideId);
        const live =
          bundle.trip && bundle.trip.status !== 'CANCELLED'
            ? bundle.trip
            : null;
        if (live) {
          if (live.driverSubject !== subject) {
            throw new ConflictException(
              'Ride is already ACCEPTED. Cannot accept.',
            );
          }
          const pending = await this.outbox.findPending(tx, rideId, 'ASSIGN');
          return { tripId: live.id, assignId: pending?.id ?? null };
        }
        const now = new Date();
        await this.expireOffers(tx, rideId, now);
        const offers = await tx.engineOffer.findMany({
          where: { bookingId: rideId },
          orderBy: { createdAt: 'desc' },
        });
        const mine = offers.find((offer) => offer.driverSubject === subject);
        const current = offers[0];
        if (
          bundle.booking.status !== 'OPEN' ||
          !current ||
          current.status !== 'REQUESTED'
        ) {
          throw new ConflictException(
            `Ride is already ${rideStatus({ ...bundle, offers }, now)}. Cannot accept.`,
          );
        }
        if (!mine || mine.id !== current.id) {
          throw new BadRequestException(
            'You are not the requested driver for this ride.',
          );
        }
        const busy = await tx.engineTrip.findFirst({
          where: {
            driverSubject: subject,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
          select: { id: true },
        });
        if (busy) {
          throw new ConflictException('Driver is no longer available.');
        }
        // This synchronous check runs while the booking is locked, immediately before the
        // assignment is persisted. It is intentionally not cached: the backend owns all KYC,
        // vehicle, approval and suspension decisions.
        await this.drivers.requireEligibleForNewWork(subject);
        await tx.engineOffer.update({
          where: { id: current.id },
          data: { status: 'ACCEPTED', respondedAt: now },
        });
        await tx.engineBooking.update({
          where: { id: rideId },
          data: { status: 'ASSIGNED' },
        });
        const tripId = randomUUID();
        await tx.engineTrip.create({
          data: { id: tripId, bookingId: rideId, driverSubject: subject },
        });
        const assignId = await this.outbox.enqueue(tx, {
          bookingId: rideId,
          mode: 'COMMAND',
          kind: 'ASSIGN',
          payload: { tripId, driverSubject: subject },
        });
        return { tripId, assignId };
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          // Another acceptance won (same driver elsewhere, or the booking): never two trips.
          throw new ConflictException('Driver is no longer available.');
        }
        throw error;
      });

    this.drivers.markUnavailable(subject);
    const record =
      outcome.assignId === null
        ? null
        : await this.outbox.flushBooking(rideId, outcome.assignId);
    if (record?.status === 'REFUSED') {
      const status =
        record.lastHttpStatus &&
        record.lastHttpStatus >= 400 &&
        record.lastHttpStatus < 500
          ? record.lastHttpStatus
          : HttpStatus.CONFLICT;
      throw engineError(
        status,
        record.lastErrorCode ?? 'ASSIGNMENT_REFUSED',
        `The payment backend refused the assignment${record.lastError ? `: ${record.lastError}` : ''}`,
      );
    }
    const bundle = await this.bundle(rideId);
    return {
      ride: rideView(bundle, new Date()),
      trip: await this.trips.viewForBooking(rideId),
      paymentSync: record ? record.status : 'DELIVERED',
    };
  }

  async rejectRide(subject: string, rideId: string, driverId?: string) {
    assertSameIdentity(subject, driverId, 'driverId');
    await this.requireBooking(rideId);
    await this.prisma.runInTransaction(async (tx) => {
      await lockBooking(tx, rideId);
      const now = new Date();
      await this.expireOffers(tx, rideId, now);
      const offers = await tx.engineOffer.findMany({
        where: { bookingId: rideId },
        orderBy: { createdAt: 'desc' },
      });
      const current = offers[0];
      if (!current || current.driverSubject !== subject) {
        throw new BadRequestException(
          'You are not the requested driver for this ride.',
        );
      }
      if (current.status !== 'REQUESTED') {
        throw new ConflictException(
          `Ride is already ${current.status}. Cannot reject.`,
        );
      }
      await tx.engineOffer.update({
        where: { id: current.id },
        data: { status: 'REJECTED', respondedAt: now },
      });
    });
    // A declining driver must not require the customer app to choose the next one.
    await this.dispatch(await this.requireBooking(rideId));
    return rideView(await this.bundle(rideId), new Date());
  }

  /** Before a driver accepted. After that, the trip is cancelled (POST /trips/:id/cancel). */
  async cancelRide(subject: string, rideId: string, raw: unknown) {
    const request = parseRequest(cancelRideSchema, raw);
    assertSameIdentity(subject, request.customerId, 'customerId');
    let booking = await this.requireBooking(rideId);
    if (booking.customerSubject !== subject) {
      throw rideNotFound(rideId);
    }
    if (booking.status === 'PENDING_REGISTRATION') {
      // Was it registered? Ask again (same reference): cancel there too if so.
      booking = await this.register(booking).catch((error: unknown) => {
        if (error instanceof HttpException) {
          return this.requireBooking(rideId);
        }
        throw error;
      });
      if (booking.status === 'PENDING_REGISTRATION') {
        throw paymentBackendUnavailable(
          'The booking could not be confirmed with the payment backend; try cancelling again.',
        );
      }
    }
    const outboxId = await this.prisma.runInTransaction(async (tx) => {
      await lockBooking(tx, rideId);
      const bundle = await this.bundleIn(tx, rideId);
      const status = bundle.booking.status;
      if (status === 'CANCELLED') {
        return null;
      }
      if (status === 'ASSIGNED' || status === 'COMPLETED') {
        throw new ConflictException(
          `Ride is already ${rideStatus(bundle, new Date())}. Cannot cancel.`,
        );
      }
      const now = new Date();
      await tx.engineBooking.update({
        where: { id: rideId },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledBy: 'CUSTOMER',
          cancellationReason: request.reason,
        },
      });
      await tx.engineOffer.updateMany({
        where: { bookingId: rideId, status: 'REQUESTED' },
        data: { status: 'CANCELLED', respondedAt: now },
      });
      await tx.engineStop.updateMany({
        where: {
          bookingId: rideId,
          status: { notIn: [...FINAL_STOP_STATUSES] },
        },
        data: { status: 'CANCELLED' },
      });
      if (!bundle.booking.paymentBookingId) {
        return null; // never registered (refused): nothing to cancel there
      }
      return this.outbox.enqueue(tx, {
        bookingId: rideId,
        mode: 'EVENT',
        kind: 'CANCEL',
        payload: { reason: request.reason, cancelledBy: 'CUSTOMER' },
      });
    });
    if (outboxId !== null) {
      await this.outbox.flushBooking(rideId, outboxId);
    }
    return rideView(await this.bundle(rideId), new Date());
  }

  // ──── INTERNALS ────

  private findBooking(
    subject: string,
    quoteId: string,
  ): Promise<EngineBooking | null> {
    return this.prisma.engineBooking.findUnique({
      where: { quoteId_customerSubject: { quoteId, customerSubject: subject } },
    });
  }

  /** Reads the quote, checks the customer's details fit its route, and persists the booking. */
  private async createBooking(
    subject: string,
    request: CreateRideRequest,
  ): Promise<EngineBooking> {
    const quoteOutcome = await this.backend.getFareQuote(
      request.quoteId,
      `eng-quote-${randomUUID()}`,
    );
    if (quoteOutcome.kind === 'UNAVAILABLE') {
      throw paymentBackendUnavailable(
        'The fare quote could not be read; try again.',
        {
          code: quoteOutcome.code,
        },
      );
    }
    if (quoteOutcome.kind === 'REFUSED') {
      throw quoteOutcome.status === 404
        ? engineError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'QUOTE_NOT_FOUND',
            'Fare quote not found',
          )
        : registrationRefused(
            quoteOutcome.code,
            quoteOutcome.status,
            quoteOutcome.message,
          );
    }
    const quote = quoteOutcome.value;
    if (quote.redeemed) {
      throw engineError(
        HttpStatus.CONFLICT,
        'QUOTE_ALREADY_USED',
        'This fare quote was already booked',
      );
    }
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      throw engineError(
        HttpStatus.CONFLICT,
        'QUOTE_EXPIRED',
        'The fare quote has expired: ask for a new one',
      );
    }
    const drops = [...quote.drops].sort((a, b) => a.sequence - b.sequence);
    const details =
      request.drops ?? (request.drop ? [request.drop] : undefined);
    const mismatch = matchRoute(
      { pickup: quote.pickup, drops },
      { pickup: request.pickup, drops: details },
    );
    if (mismatch) {
      throw engineError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'QUOTE_ROUTE_MISMATCH',
        "The ride must be the route that was priced: use the quote's pickup and drops, in order",
        { ...mismatch },
      );
    }
    const bookingId = randomUUID();
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        const booking = await tx.engineBooking.create({
          data: {
            id: bookingId,
            externalRef: `ENG-${bookingId}`,
            quoteId: quote.quoteId,
            customerSubject: subject,
            paymentMethod: request.paymentMethod,
            vehicleCategory: quote.vehicleCategory,
            weightGrams: Math.max(1, Math.round(quote.weightKg * 1000)),
            pickupLatitude: quote.pickup.latitude,
            pickupLongitude: quote.pickup.longitude,
            pickupAddress: request.pickup?.address ?? null,
            pickupOtp: generateOtp(),
            distanceMeters: quote.distanceMeters,
            payablePaise: BigInt(quote.payablePaise),
            quoteExpiresAt: new Date(quote.expiresAt),
          },
        });
        await tx.engineStop.createMany({
          data: drops.map((drop, index) =>
            stopRow(bookingId, drop, details?.[index]),
          ),
        });
        return booking;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The same customer confirmed the same quote twice at once: one booking wins.
        const existing = await this.findBooking(subject, request.quoteId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Registers the booking (same external reference every time). Its answer is checked against
   * the quote; nothing is dispatched unless the backend confirmed exactly this booking.
   */
  private async register(booking: EngineBooking): Promise<EngineBooking> {
    const outcome = await this.backend.registerBooking(
      {
        externalRef: booking.externalRef,
        customerSubject: booking.customerSubject,
        quoteId: booking.quoteId,
        paymentMethod: booking.paymentMethod,
      },
      `eng-reg-${booking.id}`,
    );
    if (outcome.kind === 'UNAVAILABLE') {
      throw paymentBackendUnavailable(
        'The booking could not be confirmed with the payment backend; retry the same request.',
        { code: outcome.code },
      );
    }
    if (outcome.kind === 'REFUSED') {
      await this.prisma.engineBooking.updateMany({
        where: { id: booking.id, status: 'PENDING_REGISTRATION' },
        data: {
          status: 'REGISTRATION_FAILED',
          registrationError: outcome.code.slice(0, 60),
        },
      });
      throw registrationRefused(outcome.code, outcome.status, outcome.message);
    }
    const registered = outcome.value;
    const stopCount = await this.prisma.engineStop.count({
      where: { bookingId: booking.id },
    });
    if (
      registered.quoteId !== booking.quoteId ||
      registered.externalRef !== booking.externalRef ||
      registered.paymentModel !== 'QUOTE_PER_STOP' ||
      registered.stops.length !== stopCount ||
      BigInt(registered.payablePaise) !== booking.payablePaise
    ) {
      this.logger.error({
        alert: 'ENGINE_REGISTRATION_MISMATCH',
        msg: 'The payment backend registered a booking that does not match the quote; not dispatched',
        bookingId: booking.id,
        paymentBookingId: registered.bookingId,
      });
      throw engineError(
        HttpStatus.BAD_GATEWAY,
        'PAYMENT_BACKEND_CONTRACT_ERROR',
        'The payment backend confirmed a different booking; it was not dispatched',
      );
    }
    await this.prisma.engineBooking.updateMany({
      where: { id: booking.id, status: 'PENDING_REGISTRATION' },
      data: {
        status: 'OPEN',
        paymentBookingId: registered.bookingId,
        registeredAt: new Date(),
      },
    });
    return this.requireBooking(booking.id);
  }

  /**
   * Selects the nearest eligible driver for an open booking. This is deliberately inside the
   * engine: mobile clients must never see a candidate list or decide who receives a trip.
   * A booking with no eligible candidate remains OPEN and is reported as REJECTED until a later
   * POST retry can dispatch it after a driver comes online.
   */
  private async dispatch(booking: EngineBooking): Promise<void> {
    const candidates = await this.drivers.findNearby({
      latitude: booking.pickupLatitude,
      longitude: booking.pickupLongitude,
      radiusKm: 20,
    });
    // Do not immediately re-offer a booking to a driver who explicitly declined it or whose
    // payment assignment was refused. Expired offers remain eligible for a later retry.
    const attempted = new Set(
      (
        await this.prisma.engineOffer.findMany({
          where: {
            bookingId: booking.id,
            status: { in: ['REJECTED', 'FAILED'] },
          },
          select: { driverSubject: true },
        })
      ).map((offer) => offer.driverSubject),
    );
    for (const driver of candidates) {
      if (attempted.has(driver.id)) {
        continue;
      }
      try {
        // offer() independently re-checks eligibility, so every dispatch entry point has the
        // same guard and no stale ONLINE state can authorize an offer.
        await this.offer(booking, driver.id);
        return;
      } catch (error: unknown) {
        if (isDispatchCandidateUnavailable(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  /** Offers an open booking to the engine-selected driver; the same offer again is a no-op. */
  private async offer(booking: EngineBooking, driverId: string): Promise<void> {
    const driver = this.drivers.findById(driverId);
    if (!driver.isAvailable || (await this.drivers.hasActiveTrip(driverId))) {
      throw engineError(
        HttpStatus.BAD_REQUEST,
        'DRIVER_NOT_AVAILABLE',
        'Driver is no longer available.',
      );
    }
    await this.drivers.requireEligibleForNewWork(driverId);
    const ttlMs = this.config.dispatch.offerTtlSeconds * 1000;
    await this.prisma
      .runInTransaction(async (tx) => {
        await lockBooking(tx, booking.id);
        const current = await tx.engineBooking.findUniqueOrThrow({
          where: { id: booking.id },
        });
        if (current.status !== 'OPEN') {
          return; // accepted or cancelled meanwhile: the caller re-reads the ride
        }
        const now = new Date();
        await this.expireOffers(tx, booking.id, now);
        const live = await tx.engineOffer.findFirst({
          where: { bookingId: booking.id, status: 'REQUESTED' },
        });
        if (live) {
          if (live.driverSubject === driverId) {
            return; // the same request again
          }
          throw engineError(
            HttpStatus.CONFLICT,
            'RIDE_ALREADY_REQUESTED',
            'This ride is already offered to another driver; wait for the answer or cancel it',
          );
        }
        const earlier = await tx.engineOffer.count({
          where: { bookingId: booking.id },
        });
        await tx.engineOffer.create({
          data: {
            id: randomUUID(),
            bookingId: booking.id,
            driverSubject: driverId,
            expiresAt: new Date(now.getTime() + ttlMs),
          },
        });
        if (earlier === 0) {
          await this.outbox.enqueue(tx, {
            bookingId: booking.id,
            mode: 'EVENT',
            kind: 'SEARCHING',
            payload: {},
          });
        }
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw engineError(
            HttpStatus.CONFLICT,
            'RIDE_ALREADY_REQUESTED',
            'This ride is already offered',
          );
        }
        throw error;
      });
  }

  private async expireOffers(
    tx: Tx,
    bookingId: string,
    now: Date,
  ): Promise<void> {
    await tx.engineOffer.updateMany({
      where: { bookingId, status: 'REQUESTED', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
  }

  private async requireBooking(rideId: string): Promise<EngineBooking> {
    const booking = UUID.test(rideId)
      ? await this.prisma.engineBooking.findUnique({ where: { id: rideId } })
      : null;
    if (!booking) {
      throw rideNotFound(rideId);
    }
    return booking;
  }

  private async bundle(rideId: string): Promise<RideBundle> {
    await this.requireBooking(rideId);
    return this.bundleIn(this.prisma, rideId);
  }

  private async bundleIn(
    db: Tx | PrismaService,
    rideId: string,
  ): Promise<RideBundle> {
    const booking = await db.engineBooking.findUnique({
      where: { id: rideId },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        offers: { orderBy: { createdAt: 'desc' } },
        trips: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!booking) {
      throw rideNotFound(rideId);
    }
    const { stops, offers, trips, ...row } = booking;
    const now = new Date();
    return {
      booking: row,
      stops,
      offers: offers.map((offer) => ({
        ...offer,
        status: effectiveOfferStatus(offer, now),
      })),
      trip:
        trips.find((trip) => trip.status !== 'CANCELLED') ?? trips[0] ?? null,
    };
  }
}

function stopRow(
  bookingId: string,
  drop: InternalFareQuote['drops'][number],
  detail: DropDetail | undefined,
) {
  return {
    id: randomUUID(),
    bookingId,
    sequence: drop.sequence,
    latitude: drop.latitude,
    longitude: drop.longitude,
    address: detail?.address ?? null,
    receiverName: detail?.receiver?.name ?? null,
    receiverPhone: detail?.receiver?.phone ?? null,
    distanceMeters: drop.distanceMeters,
    payablePaise: BigInt(drop.payablePaise),
    otp: generateOtp(),
  };
}

function rideNotFound(rideId: string): NotFoundException {
  return new NotFoundException(`Ride with ID ${rideId} not found`);
}

function registrationRefused(
  code: string,
  status: number | null,
  message?: string,
) {
  const resolved =
    status && status >= 400 && status < 500
      ? status
      : CONFLICT_CODES.has(code)
        ? HttpStatus.CONFLICT
        : code === 'VALIDATION_FAILED'
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.UNPROCESSABLE_ENTITY;
  return engineError(
    resolved,
    code,
    message || 'The payment backend refused the booking: it is not dispatched',
  );
}

/** Only per-driver eligibility/presence failures may make dispatch try the next candidate. */
function isDispatchCandidateUnavailable(error: unknown): boolean {
  if (!(error instanceof HttpException)) {
    return false;
  }
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null || !('code' in response)) {
    return false;
  }
  const { code } = response as { code?: unknown };
  return (
    code === 'DRIVER_NOT_ELIGIBLE' ||
    code === 'DRIVER_ELIGIBILITY_UNAVAILABLE' ||
    code === 'DRIVER_NOT_AVAILABLE'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
