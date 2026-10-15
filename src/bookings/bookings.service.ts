import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { requireCustomer, requireDriver } from '../auth/require-driver';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { paiseToNumber } from '../common/money';
import { EarningsService } from '../earnings/earnings.service';
import { type FrozenFare, FareQuoteRedeemer } from '../fare/fare-contract';
import { FeeRulesService } from '../fees/fee-rules.service';
import type { Booking, BookingStop, DriverEarning, Trip } from '../generated/prisma/client';
import type { BookingPaymentMethod, TripStatus } from '../generated/prisma/enums';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { lockBooking, lockStopsOfBooking, lockTripOfBooking } from './booking-locks';
import { isOfferedPaymentMethod, OFFERED_PAYMENT_METHODS } from './bookings.dto';
import type { PaymentContext } from './bookings.mapper';
import { allocatePlatformFee } from './fee-allocation';
import { derivePaymentGate, type GateCollection } from './payment-gate';
import { isFinalStop } from './stop-lifecycle';
import {
  checkTripRequest,
  type EngineTripStatus,
  FINAL_TRIP_STATUSES,
  type TripRefusal,
  tripLifecycleUpdate,
  tripRank,
} from './trip-lifecycle';

export interface RegisterBookingInput {
  /** The trip engine's booking id. */
  readonly externalRef: string;
  /** Firebase UID of the customer who confirmed the booking. */
  readonly customerSubject: string;
  /** The fare quote the customer confirmed. Every amount comes from it. */
  readonly quoteId: string;
  readonly paymentMethod: BookingPaymentMethod;
}

export interface BookingWithTrip {
  readonly booking: Booking;
  readonly trip: Trip | null;
}

export interface RegisterResult extends BookingWithTrip {
  readonly created: boolean;
}

export interface TripUpdateResult extends BookingWithTrip {
  readonly trip: Trip;
  /** False when the trip was already at (or past) the requested status. */
  readonly changed: boolean;
  readonly earning: DriverEarning | null;
}

/** Just what the payment gate reads from a collection. */
const GATE_COLLECTION_FIELDS = {
  id: true,
  bookingId: true,
  bookingStopId: true,
  status: true,
  failureReason: true,
  createdAt: true,
} as const;

/**
 * Payment-side view of bookings and trips. The trip engine owns dispatch and stop progression
 * and reports them here (server to server); this service owns everything with money attached:
 * the confirmed fare, the pinned fee rule, the payment gate and trip completion.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeRules: FeeRulesService,
    private readonly earnings: EarningsService,
    private readonly redeemer: FareQuoteRedeemer,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Registers a booking at confirmation, from the fare quote the customer confirmed. In one
   * transaction: the quote is redeemed (once, unexpired, the same customer's), its amounts are
   * frozen on the booking and on one stop per drop, the fee rule in effect now is pinned and its
   * fee is frozen and split across the drops. The database checks the copy against the quote.
   *
   * Idempotent on externalRef: the same ref with the same quote, method and customer returns the
   * same booking, even when the two requests race; any other reuse of the ref is refused.
   */
  async register(input: RegisterBookingInput): Promise<RegisterResult> {
    if (!isOfferedPaymentMethod(input.paymentMethod)) {
      throw new AppError(
        ErrorCode.PAYMENT_METHOD_NOT_OFFERED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'This payment method is no longer offered. Bookings pay at pickup or at delivery',
        { offered: [...OFFERED_PAYMENT_METHODS] },
      );
    }

    const existing = await this.prisma.booking.findUnique({
      where: { externalRef: input.externalRef },
      include: { trip: true },
    });
    if (existing) {
      return this.replayRegistration(existing, input);
    }

    const customer = await this.findCustomer(input.customerSubject);
    try {
      const outcome = await this.prisma.runInTransaction((tx) =>
        this.createFromQuote(tx, input, customer.id),
      );
      if (outcome.kind === 'replay') {
        return this.replayRegistration(outcome.booking, input);
      }
      const { booking, stops } = outcome;
      this.logger.log(
        {
          bookingId: booking.id,
          externalRef: booking.externalRef,
          paymentMethod: booking.paymentMethod,
          quoteId: booking.fareQuoteId,
          payablePaise: Number(booking.finalFareMinor),
          platformFeePaise: Number(booking.platformFeePaise),
          stops: stops.length,
          feeRuleId: booking.feeRuleId,
        },
        'Booking registered',
      );
      return { booking, trip: null, created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent registration of the same ref (with another quote) won the insert.
        const winner = await this.prisma.booking.findUnique({
          where: { externalRef: input.externalRef },
          include: { trip: true },
        });
        if (winner) {
          return this.replayRegistration(winner, input);
        }
      }
      throw error;
    }
  }

  /** The booking's stops, in delivery order. Empty for legacy bookings. */
  stopsOf(bookingId: string): Promise<BookingStop[]> {
    return this.prisma.bookingStop.findMany({
      where: { bookingId },
      orderBy: { sequence: 'asc' },
    });
  }

  /** Stops, collections, fee and the payment gate derived from them, for one booking. */
  async paymentContext(booking: Booking, trip: Trip | null): Promise<PaymentContext> {
    const [context] = await this.paymentContexts([{ booking, trip }]);
    if (!context) {
      throw new Error('Payment context missing for a booking');
    }
    return context;
  }

  /** The same for several bookings, with one query for all their stops and one for collections. */
  async paymentContexts(rows: readonly BookingWithTrip[]): Promise<PaymentContext[]> {
    const ids = rows.map((row) => row.booking.id);
    if (ids.length === 0) {
      return [];
    }
    const [stops, collections, fees] = await Promise.all([
      this.prisma.bookingStop.findMany({
        where: { bookingId: { in: ids } },
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.paymentCollection.findMany({
        where: { bookingId: { in: ids } },
        select: GATE_COLLECTION_FIELDS,
      }),
      Promise.all(rows.map((row) => this.feeFor(row.booking))),
    ]);
    return rows.map(({ booking, trip }, index) => {
      const own = stops.filter((stop) => stop.bookingId === booking.id);
      const ownCollections: GateCollection[] = collections.filter(
        (collection) => collection.bookingId === booking.id,
      );
      const platformFeePaise = fees[index] ?? 0n;
      return {
        stops: own,
        collections: ownCollections,
        platformFeePaise,
        gate: derivePaymentGate({
          booking,
          tripStatus: trip?.status ?? null,
          stops: own,
          collections: ownCollections,
          platformFeePaise,
        }),
      };
    });
  }

  /** CREATED -> SEARCHING_DRIVER. Idempotent. */
  async markSearching(bookingId: string): Promise<BookingWithTrip> {
    return this.prisma.runInTransaction(async (tx) => {
      const booking = await this.requireLockedBooking(tx, bookingId);
      const trip = await lockTripOfBooking(tx, bookingId);
      if (booking.status === 'SEARCHING_DRIVER' || booking.status === 'DRIVER_ASSIGNED') {
        return { booking, trip };
      }
      if (booking.status !== 'CREATED') {
        throw closed(booking);
      }
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'SEARCHING_DRIVER' },
      });
      return { booking: updated, trip };
    });
  }

  /**
   * Assignment: creates the booking's single trip (M6: one trip per booking) for an approved
   * driver. Idempotent for the same driver; a different driver is refused.
   */
  async assignDriver(bookingId: string, driverSubject: string): Promise<BookingWithTrip> {
    const driver = await this.findAssignableDriver(driverSubject);
    return this.prisma.runInTransaction(async (tx) => {
      const booking = await this.requireLockedBooking(tx, bookingId);
      const existing = await lockTripOfBooking(tx, bookingId);
      if (existing) {
        if (existing.driverId !== driver.id) {
          throw new AppError(
            ErrorCode.TRIP_ALREADY_ASSIGNED,
            HttpStatus.CONFLICT,
            'This booking is already assigned to another driver',
          );
        }
        return { booking, trip: existing };
      }
      if (booking.status !== 'CREATED' && booking.status !== 'SEARCHING_DRIVER') {
        throw closed(booking);
      }
      const trip = await tx.trip.create({ data: { bookingId, driverId: driver.id } });
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'DRIVER_ASSIGNED' },
      });
      this.logger.log({ bookingId, tripId: trip.id, driverId: driver.id }, 'Driver assigned');
      return { booking: updated, trip };
    });
  }

  /**
   * Applies a lifecycle update reported by the trip engine, strictly in M6 order. Repeating or
   * replaying an older status is a no-op, so engine retries are safe. COMPLETED is refused until
   * the payment is confirmed (M6 payment gate) and creates the driver earning atomically.
   *
   * Payment flow Phase 3: an unpaid PAY_AT_PICKUP trip never leaves DRIVER_ARRIVED (pickup gate,
   * every booking model), and the trip of a booking priced per drop reaches DROP_PROGRESS and
   * DELIVERED only through its drops (BookingStopsService), never from this report.
   */
  async updateTripStatus(tripId: string, requested: EngineTripStatus): Promise<TripUpdateResult> {
    const located = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { bookingId: true },
    });
    if (!located) {
      throw new AppError(ErrorCode.TRIP_NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
    }

    return this.prisma.runInTransaction(async (tx) => {
      const booking = await this.requireLockedBooking(tx, located.bookingId);
      const trip = await lockTripOfBooking(tx, located.bookingId);
      if (!trip || trip.id !== tripId) {
        throw new AppError(ErrorCode.TRIP_NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
      }
      if (trip.status === 'CANCELLED') {
        throw invalidTransition(trip.status, requested);
      }

      if (tripRank(requested) <= tripRank(trip.status)) {
        const earning = await tx.driverEarning.findUnique({ where: { tripId } });
        return { booking, trip, changed: false, earning };
      }

      if (requested === 'COMPLETED') {
        return this.complete(tx, booking, trip);
      }
      const stops =
        booking.paymentModel === 'QUOTE_PER_STOP' ? await lockStopsOfBooking(tx, booking.id) : [];
      const refusal = checkTripRequest(
        {
          paymentMethod: booking.paymentMethod,
          paymentModel: booking.paymentModel,
          bookingPaid: booking.paymentStatus !== 'UNPAID',
          tripStatus: trip.status,
          stops,
        },
        requested,
      );
      if (refusal) {
        throw tripRefusalError(refusal, booking, trip.status, requested);
      }

      const now = new Date();
      const confirmPayment = requested === 'DELIVERED' && booking.paymentStatus !== 'UNPAID';
      const updated = await tx.trip.update({
        where: { id: tripId },
        data: tripLifecycleUpdate(requested, now),
      });
      // Already paid (prepaid, or collected at pickup): delivery confirms the payment gate.
      const final = confirmPayment
        ? await tx.trip.update({
            where: { id: tripId },
            data: { status: 'PAYMENT_CONFIRMED', paymentConfirmedAt: now },
          })
        : updated;
      return { booking, trip: final, changed: true, earning: null };
    });
  }

  /**
   * Cancels a booking and its trip. A booking that was already paid is cancelled too, but it is
   * flagged for refund review (refund policy is D-22; nothing is refunded automatically).
   */
  async cancel(bookingId: string, reason: string): Promise<BookingWithTrip> {
    return this.prisma.runInTransaction(async (tx) => {
      const booking = await this.requireLockedBooking(tx, bookingId);
      const trip = await lockTripOfBooking(tx, bookingId);
      if (booking.status === 'CANCELLED') {
        return { booking, trip };
      }
      if (booking.status === 'COMPLETED') {
        throw closed(booking);
      }
      const stops =
        booking.paymentModel === 'QUOTE_PER_STOP' ? await lockStopsOfBooking(tx, bookingId) : [];
      const now = new Date();
      const cancelledTrip =
        trip && !FINAL_TRIP_STATUSES.has(trip.status)
          ? await tx.trip.update({
              where: { id: trip.id },
              data: { status: 'CANCELLED', cancelledAt: now },
            })
          : trip;
      const cancelled = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED', cancelledAt: now, cancellationReason: reason },
      });
      // Every drop not finished yet is cancelled with the booking (after it: the database checks
      // that the booking is cancelled). Delivered and undelivered drops keep their outcome.
      const open = stops.filter((stop) => !isFinalStop(stop.status)).map((stop) => stop.id);
      if (open.length > 0) {
        await tx.bookingStop.updateMany({
          where: { id: { in: open } },
          data: { status: 'CANCELLED', cancelledAt: now },
        });
      }
      if (cancelled.paymentStatus !== 'UNPAID') {
        this.logger.error(
          { bookingId, paymentStatus: cancelled.paymentStatus, alert: 'PAYMENT_ANOMALY' },
          'A paid booking was cancelled; refund review needed (D-22)',
        );
      }
      return { booking: cancelled, trip: cancelledTrip };
    });
  }

  async getById(bookingId: string): Promise<BookingWithTrip> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { trip: true },
    });
    if (!booking) {
      throw notFound();
    }
    const { trip, ...rest } = booking;
    return { booking: rest, trip };
  }

  async getByExternalRef(externalRef: string): Promise<BookingWithTrip> {
    const booking = await this.prisma.booking.findUnique({
      where: { externalRef },
      include: { trip: true },
    });
    if (!booking) {
      throw notFound();
    }
    const { trip, ...rest } = booking;
    return { booking: rest, trip };
  }

  /** The customer's own booking; another customer's id behaves like a missing one. */
  async getForCustomer(principal: Principal, bookingId: string): Promise<BookingWithTrip> {
    const customer = requireCustomer(principal);
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
      include: { trip: true },
    });
    if (!booking) {
      throw notFound();
    }
    const { trip, ...rest } = booking;
    return { booking: rest, trip };
  }

  /** The driver's own trip; another driver's trip behaves like a missing one. */
  async getTripForDriver(
    principal: Principal,
    tripId: string,
  ): Promise<BookingWithTrip & { trip: Trip }> {
    const driver = requireDriver(principal);
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, driverId: driver.id },
      include: { booking: true },
    });
    if (!trip) {
      throw new AppError(ErrorCode.TRIP_NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
    }
    const { booking, ...rest } = trip;
    return { booking, trip: rest };
  }

  /** The driver's trips, newest first, active ones before finished ones. */
  async listTripsForDriver(principal: Principal, activeOnly: boolean) {
    const driver = requireDriver(principal);
    return this.prisma.trip.findMany({
      where: {
        driverId: driver.id,
        ...(activeOnly ? { status: { notIn: ['COMPLETED', 'CANCELLED'] } } : {}),
      },
      include: { booking: true },
      orderBy: { assignedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Platform fee for a booking: the fee frozen at registration, or, for a legacy booking, the
   * fee under the rule pinned at its confirmation (how it was always computed).
   */
  async feeFor(booking: Booking): Promise<bigint> {
    if (booking.platformFeePaise !== null) {
      return booking.platformFeePaise;
    }
    const rule = await this.prisma.feeRule.findUniqueOrThrow({ where: { id: booking.feeRuleId } });
    return this.feeRules.feeFor(rule, booking.finalFareMinor);
  }

  /**
   * How a paid (or partly paid) booking was paid; null while unpaid. A booking paid drop by drop
   * with both cash and online drops is MIXED.
   */
  async paidWith(
    booking: Booking,
  ): Promise<'PREPAID_ONLINE' | 'CASH' | 'ONLINE_QR' | 'MIXED' | null> {
    if (booking.paymentStatus === 'UNPAID') {
      return null;
    }
    if (booking.paymentMethod === 'PREPAID_UPI') {
      return 'PREPAID_ONLINE';
    }
    const collections = await this.prisma.paymentCollection.findMany({
      where: { bookingId: booking.id, status: 'COMPLETED' },
      select: { method: true },
    });
    const cash = collections.some((collection) => collection.method === 'CASH');
    const online = collections.some((collection) => collection.method !== 'CASH');
    if (cash && online) {
      return 'MIXED';
    }
    return cash ? 'CASH' : online ? 'ONLINE_QR' : null;
  }

  private async complete(tx: Tx, booking: Booking, current: Trip): Promise<TripUpdateResult> {
    let trip = current;
    if (trip.status === 'DELIVERED' && booking.paymentStatus !== 'UNPAID') {
      // Defensive: paid and delivered should already be PAYMENT_CONFIRMED.
      trip = await tx.trip.update({
        where: { id: trip.id },
        data: { status: 'PAYMENT_CONFIRMED', paymentConfirmedAt: new Date() },
      });
    }
    if (trip.status !== 'PAYMENT_CONFIRMED') {
      if (booking.paymentStatus === 'UNPAID') {
        throw new AppError(
          ErrorCode.PAYMENT_REQUIRED,
          HttpStatus.CONFLICT,
          'The trip cannot be completed before the payment is confirmed',
          { tripStatus: trip.status, paymentStatus: booking.paymentStatus },
        );
      }
      throw invalidTransition(trip.status, 'COMPLETED');
    }
    const now = new Date();
    const completedTrip = await tx.trip.update({
      where: { id: trip.id },
      data: { status: 'COMPLETED', completedAt: now },
    });
    const completedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'COMPLETED', completedAt: now },
    });
    const earning = await this.earnings.createForCompletedTrip(
      tx,
      completedBooking,
      completedTrip,
      now,
    );
    this.logger.log(
      { bookingId: booking.id, tripId: trip.id, earningId: earning.id },
      'Trip completed',
    );
    return { booking: completedBooking, trip: completedTrip, changed: true, earning };
  }

  /**
   * Inside the registration transaction. Redeeming locks the quote row, so of two identical
   * requests the second waits, then finds the quote used by the first; that is a replay, not a
   * conflict, when the booking holding it has the same ref.
   */
  private async createFromQuote(
    tx: Tx,
    input: RegisterBookingInput,
    customerId: string,
  ): Promise<
    | { kind: 'created'; booking: Booking; stops: BookingStop[] }
    | { kind: 'replay'; booking: Booking & { trip: Trip | null } }
  > {
    const confirmedAt = this.clock.now();
    let frozen: FrozenFare;
    try {
      frozen = await this.redeemer.redeem(tx, {
        quoteId: input.quoteId,
        customerId,
        at: confirmedAt,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.QUOTE_ALREADY_USED) {
        const holder = await tx.booking.findUnique({
          where: { fareQuoteId: input.quoteId },
          include: { trip: true },
        });
        if (holder && holder.externalRef === input.externalRef) {
          return { kind: 'replay', booking: holder };
        }
      }
      throw error;
    }
    if (frozen.taxPaise !== 0n || frozen.stops.some((stop) => stop.taxPaise !== 0n)) {
      // Pricing refuses taxes today; a taxed quote can't be booked until a tax rule exists (L-2).
      throw new AppError(
        ErrorCode.TAX_NOT_SUPPORTED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Fares with tax cannot be booked until a tax rule is approved',
      );
    }

    const rule = await this.feeRules.resolve(tx, frozen.vehicleCategory, confirmedAt);
    const feePaise = this.feeRules.feeFor(rule, frozen.farePaise);
    const shares = allocatePlatformFee(
      feePaise,
      frozen.stops.map((stop) => ({ sequence: stop.sequence, farePaise: stop.farePaise })),
    );

    const booking = await tx.booking.create({
      data: {
        externalRef: input.externalRef,
        customerId,
        vehicleCategory: frozen.vehicleCategory,
        fareEstimateMinor: frozen.payablePaise,
        finalFareMinor: frozen.payablePaise,
        paymentMethod: input.paymentMethod,
        feeRuleId: rule.id,
        paymentModel: 'QUOTE_PER_STOP',
        fareQuoteId: frozen.quoteId,
        pricingVersionId: frozen.pricingVersionId,
        farePaise: frozen.farePaise,
        taxPaise: frozen.taxPaise,
        platformFeePaise: feePaise,
        confirmedAt,
      },
    });
    await tx.bookingStop.createMany({
      data: frozen.stops.map((stop, index) => {
        const share = shares[index];
        if (share === undefined) {
          throw new Error('Fee allocation returned a different number of stops');
        }
        return {
          bookingId: booking.id,
          fareQuoteStopId: stop.quoteStopId,
          sequence: stop.sequence,
          farePaise: stop.farePaise,
          taxPaise: stop.taxPaise,
          payablePaise: stop.payablePaise,
          platformFeeSharePaise: share,
        };
      }),
    });
    const stops = await tx.bookingStop.findMany({
      where: { bookingId: booking.id },
      orderBy: { sequence: 'asc' },
    });
    return { kind: 'created', booking, stops };
  }

  private async replayRegistration(
    existing: Booking & { trip: Trip | null },
    input: RegisterBookingInput,
  ): Promise<RegisterResult> {
    const { trip, ...booking } = existing;
    // Historical bookings were registered without a quote: their ref can't be registered again.
    const sameTerms =
      booking.paymentModel === 'QUOTE_PER_STOP' &&
      booking.fareQuoteId === input.quoteId &&
      booking.paymentMethod === input.paymentMethod;
    if (!sameTerms) {
      throw new AppError(
        ErrorCode.BOOKING_REF_CONFLICT,
        HttpStatus.CONFLICT,
        'This booking reference was already registered with different terms',
      );
    }
    const customer = await this.findCustomer(input.customerSubject);
    if (customer.id !== booking.customerId) {
      throw new AppError(
        ErrorCode.BOOKING_REF_CONFLICT,
        HttpStatus.CONFLICT,
        'This booking reference was already registered for another customer',
      );
    }
    return { booking, trip, created: false };
  }

  private async findCustomer(subject: string): Promise<{ id: string }> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: this.config.auth.provider, subject } },
      select: {
        user: { select: { role: true, status: true, customer: { select: { id: true } } } },
      },
    });
    const user = identity?.user;
    if (!user || user.role !== 'CUSTOMER' || user.status !== 'ACTIVE' || !user.customer) {
      throw new AppError(
        ErrorCode.CUSTOMER_NOT_FOUND,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'No active customer account is registered for this subject',
      );
    }
    return user.customer;
  }

  private async findAssignableDriver(subject: string): Promise<{ id: string }> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: this.config.auth.provider, subject } },
      select: {
        user: { select: { status: true, driver: { select: { id: true, approvalStatus: true } } } },
      },
    });
    const driver = identity?.user.driver;
    if (!identity || identity.user.status !== 'ACTIVE' || !driver) {
      throw new AppError(
        ErrorCode.DRIVER_NOT_FOUND,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'No active driver account is registered for this subject',
      );
    }
    if (driver.approvalStatus !== 'APPROVED') {
      throw new AppError(
        ErrorCode.DRIVER_NOT_APPROVED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Only approved drivers can be assigned',
      );
    }
    return driver;
  }

  private async requireLockedBooking(tx: Tx, bookingId: string): Promise<Booking> {
    const booking = await lockBooking(tx, bookingId);
    if (!booking) {
      throw notFound();
    }
    return booking;
  }
}

function notFound(): AppError {
  return new AppError(ErrorCode.BOOKING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Booking not found');
}

function closed(booking: Booking): AppError {
  return new AppError(ErrorCode.BOOKING_CLOSED, HttpStatus.CONFLICT, 'This booking is closed', {
    status: booking.status,
  });
}

function invalidTransition(from: TripStatus, to: TripStatus): AppError {
  return new AppError(
    ErrorCode.INVALID_TRIP_TRANSITION,
    HttpStatus.CONFLICT,
    `A trip cannot move from ${from} to ${to}`,
    { from, to },
  );
}

function tripRefusalError(
  refusal: TripRefusal,
  booking: Booking,
  tripStatus: TripStatus,
  requested: TripStatus,
): AppError {
  switch (refusal.kind) {
    case 'PAYMENT_REQUIRED':
      return new AppError(
        ErrorCode.PAYMENT_REQUIRED,
        HttpStatus.CONFLICT,
        'Payment is required before the pickup handover',
        { stage: 'PICKUP', amountPaise: paiseToNumber(booking.finalFareMinor), tripStatus },
      );
    case 'STOP_REQUIRED':
      return new AppError(
        ErrorCode.STOP_REQUIRED,
        HttpStatus.CONFLICT,
        'This booking is delivered drop by drop: report each drop, and the trip follows',
        { tripStatus, requested },
      );
    case 'STOPS_PENDING':
      return new AppError(
        ErrorCode.STOPS_PENDING,
        HttpStatus.CONFLICT,
        'Every drop must be delivered, resolved or cancelled before the trip is delivered',
        { pendingStops: [...refusal.pendingStops], tripStatus },
      );
    case 'INVALID_TRANSITION':
      return invalidTransition(tripStatus, requested);
  }
}
