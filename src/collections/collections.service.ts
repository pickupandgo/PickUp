import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { lockBooking, lockStopsOfBooking, lockTripOfBooking } from '../bookings/booking-locks';
import { applyCollectionCompleted } from '../bookings/booking-payment-state';
import { BookingsService } from '../bookings/bookings.service';
import type { PaymentGate } from '../bookings/payment-gate';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { feeForFare } from '../fees/fee-rules';
import type { Booking, BookingStop, PaymentCollection, Trip } from '../generated/prisma/client';
import type { BookingPaymentStatus } from '../generated/prisma/enums';
import { PAYMENT_PROVIDER_RAZORPAY } from '../payments/payment.constants';
import { toProviderAppError } from '../payments/provider-errors';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RazorpayApiError, RazorpayUnavailableError } from '../razorpay/razorpay.errors';
import { WalletLedgerService } from '../wallet/wallet-ledger.service';
import {
  CollectionLinkGateway,
  type CollectionLinkState,
  type CollectionProduct,
} from './collection-link.gateway';
import {
  type CollectionApplyResult,
  CollectionFinalizerService,
  type CollectionOutcome,
} from './collection-finalizer.service';
import {
  type CollectionObligation,
  type ObligationContext,
  type ObligationRefusal,
  resolveObligation,
} from './collection-obligation';

export type CollectionMethod = 'CASH' | 'ONLINE_QR';

export interface CollectInput {
  readonly method: CollectionMethod;
  /**
   * What the driver says the customer pays: a confirmation echo. The amount is resolved on the
   * server (the booking's or the drop's frozen payable amount); a different echo is refused.
   */
  readonly amountPaise: bigint;
  /** The drop paid for: required for a booking paid drop by drop, refused otherwise. */
  readonly stopSequence: number | null;
}

export interface CollectResult {
  readonly collection: PaymentCollection;
  /** True when this request was already processed (same Idempotency-Key) or reused a live QR. */
  readonly replayed: boolean;
}

/** A collection's drop and its booking's payment state, as the driver app shows them. */
export interface CollectionDriverView {
  readonly stopSequence: number | null;
  readonly bookingPaymentStatus: BookingPaymentStatus;
  readonly paymentGate: PaymentGate;
}

/** Hints carried by a signed webhook that identify one of our collections. */
export interface CollectionHint {
  readonly providerReferenceId?: string | null;
  readonly collectionId?: string | null;
  readonly providerOrderId?: string | null;
}

/** A collection with the sequence of the drop it is for (null for the whole booking). */
type CollectionWithStop = PaymentCollection & { readonly bookingStop: { sequence: number } | null };

const WITH_STOP = { bookingStop: { select: { sequence: true } } } as const;

/** Thrown inside the cash transaction when a QR is still open for the same obligation. */
class OpenOnlineCollection extends Error {
  constructor(readonly collectionId: string) {
    super('An online collection is still open for this obligation');
    this.name = 'OpenOnlineCollection';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pickup / delivery payments for PAY_AT_PICKUP and PAY_AT_DELIVERY bookings (PW 5 and 6), one
 * obligation per collection (payment flow Phase 4, collection-obligation.ts): the whole booking at
 * the pickup, a historical delivery booking once delivered, or, for a booking priced per drop and
 * paid at delivery, the drop the driver is at. The amount always comes from the frozen snapshot.
 *
 * CASH: the driver records the cash in one transaction that locks booking -> trip -> drops ->
 * wallet, debits the platform fee owed on that obligation from the driver wallet (CASH_RIDE_FEE
 * ledger entry, never below zero) and records its effects: the booking paid, or the drop's payment
 * confirmed and the booking PARTIALLY_PAID or PAID. The driver keeps the rest of the cash.
 *
 * ONLINE_QR: the server creates a Razorpay payment link or QR code for that obligation only. Only
 * Razorpay's own report of a captured payment (webhook, driver refresh or admin sync, all through
 * CollectionFinalizerService) completes it; the money goes to Nikhil Enterprises and the driver's
 * share is paid out as a driver earning.
 */
@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly links: CollectionLinkGateway,
    private readonly finalizer: CollectionFinalizerService,
    private readonly bookings: BookingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async collect(
    principal: Principal,
    tripId: string,
    idempotencyKey: string,
    input: CollectInput,
  ): Promise<CollectResult> {
    const driver = requireDriver(principal);
    if (driver.approvalStatus !== 'APPROVED') {
      throw new AppError(
        ErrorCode.DRIVER_NOT_APPROVED,
        HttpStatus.FORBIDDEN,
        'Only approved drivers can collect payments',
      );
    }
    // Scoped per driver so two drivers can never collide on a client-generated key.
    const key = `${driver.id}:${idempotencyKey}`;

    const replay = await this.findReplay(this.prisma, key);
    if (replay) {
      assertSameRequest(replay, tripId, input);
      return { collection: replay, replayed: true };
    }

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, driverId: driver.id },
      include: { booking: true },
    });
    if (!trip) {
      throw new AppError(ErrorCode.TRIP_NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
    }
    const { booking, ...tripRow } = trip;
    // An early answer before any lock or provider call; the transaction checks again.
    const obligation = obligationOrThrow(
      await this.obligationContext(this.prisma, booking, tripRow, null),
      input,
    );

    return input.method === 'CASH'
      ? this.collectCash(driver.id, tripRow, booking, key, input)
      : this.createOnlineCollection(driver.id, tripRow, booking, key, input, obligation);
  }

  /** The driver's own collection. A pending QR is refreshed from Razorpay first. */
  async getForDriver(
    principal: Principal,
    tripId: string,
    collectionId: string,
  ): Promise<PaymentCollection> {
    const driver = requireDriver(principal);
    const collection = await this.prisma.paymentCollection.findFirst({
      where: { id: collectionId, tripId, collectedByDriverId: driver.id },
    });
    if (!collection) {
      throw new AppError(
        ErrorCode.COLLECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Collection not found',
      );
    }
    if (collection.status !== 'PENDING') {
      return collection;
    }
    return (await this.refresh(collection, { source: 'DRIVER_REFRESH' })).collection;
  }

  async get(collectionId: string): Promise<PaymentCollection> {
    const collection = await this.prisma.paymentCollection.findUnique({
      where: { id: collectionId },
    });
    if (!collection) {
      throw new AppError(
        ErrorCode.COLLECTION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Collection not found',
      );
    }
    return collection;
  }

  /** The sequence of the drop a collection is for; null for the whole booking. */
  async stopSequenceOf(
    collection: Pick<PaymentCollection, 'bookingStopId'>,
  ): Promise<number | null> {
    if (!collection.bookingStopId) {
      return null;
    }
    const stop = await this.prisma.bookingStop.findUnique({
      where: { id: collection.bookingStopId },
      select: { sequence: true },
    });
    return stop?.sequence ?? null;
  }

  /**
   * The collection's drop and its booking's payment state right now, from the database: what the
   * driver app shows after a collection request or a poll (never what the app sent).
   */
  async driverView(collection: PaymentCollection): Promise<CollectionDriverView> {
    const { trip, ...booking } = await this.prisma.booking.findUniqueOrThrow({
      where: { id: collection.bookingId },
      include: { trip: true },
    });
    const context = await this.bookings.paymentContext(booking, trip);
    const stop = collection.bookingStopId
      ? context.stops.find((candidate) => candidate.id === collection.bookingStopId)
      : undefined;
    return {
      stopSequence: stop?.sequence ?? null,
      bookingPaymentStatus: booking.paymentStatus,
      paymentGate: context.gate,
    };
  }

  /** Admin recovery: re-reads an online collection from Razorpay and applies what it reports. */
  async sync(collectionId: string): Promise<CollectionApplyResult> {
    const collection = await this.get(collectionId);
    if (collection.method !== 'ONLINE_QR') {
      return { collection, outcome: 'ALREADY_APPLIED' };
    }
    return this.refresh(collection, { source: 'ADMIN_SYNC' });
  }

  /**
   * Webhook path. The signed event only identifies the collection; its state is then read from
   * Razorpay, so a payload shape change can never complete a collection on its own.
   */
  async handleWebhookHint(
    hint: CollectionHint,
    providerEventId: string,
  ): Promise<{ outcome: CollectionOutcome | 'UNKNOWN_COLLECTION'; collectionId: string | null }> {
    const collection = await this.findByHint(hint);
    if (!collection) {
      return { outcome: 'UNKNOWN_COLLECTION', collectionId: null };
    }
    if (collection.status === 'COMPLETED') {
      return { outcome: 'ALREADY_APPLIED', collectionId: collection.id };
    }
    const result = await this.refresh(collection, { source: 'WEBHOOK', providerEventId });
    return { outcome: result.outcome, collectionId: collection.id };
  }

  /** True when a signed webhook refers to one of our collections. */
  async isKnownCollection(hint: CollectionHint): Promise<boolean> {
    return (await this.findByHint(hint)) !== null;
  }

  /**
   * A captured payment without an order id is a QR code payment. Maps it back to its collection
   * (already applied, the note we set, or Razorpay's QR lookup) and applies it.
   */
  async handlePaymentWithoutOrder(
    providerPaymentId: string,
    collectionIdHint: string | null,
    providerEventId: string,
  ): Promise<{ outcome: CollectionOutcome | 'UNKNOWN_COLLECTION'; collectionId: string | null }> {
    const applied = await this.prisma.paymentCollection.findFirst({
      where: { provider: PAYMENT_PROVIDER_RAZORPAY, providerPaymentId },
      select: { id: true },
    });
    if (applied) {
      return { outcome: 'ALREADY_APPLIED', collectionId: applied.id };
    }
    if (collectionIdHint && (await this.isKnownCollection({ collectionId: collectionIdHint }))) {
      return this.handleWebhookHint({ collectionId: collectionIdHint }, providerEventId);
    }
    const qrInUse = await this.prisma.paymentCollection.count({
      where: { providerProduct: 'QR_CODE', status: { in: ['PENDING', 'FAILED'] } },
    });
    if (qrInUse > 0) {
      let qrCodeId: string | null;
      try {
        qrCodeId = await this.links.findQrCodeIdByPayment(providerPaymentId);
      } catch (error) {
        throw toProviderAppError(error);
      }
      if (qrCodeId) {
        return this.handleWebhookHint({ providerReferenceId: qrCodeId }, providerEventId);
      }
    }
    return { outcome: 'UNKNOWN_COLLECTION', collectionId: null };
  }

  /**
   * Closes the open QRs of a booking at Razorpay (booking cancelled), or of one drop (that drop's
   * delivery attempt failed). Best effort: failures are logged and the QR still expires on its
   * own; a late payment is still recorded, for that obligation only (refund review if closed).
   */
  async closeOpenCollections(
    bookingId: string,
    reason: string,
    bookingStopId?: string,
  ): Promise<void> {
    const open = await this.prisma.paymentCollection.findMany({
      where: { bookingId, status: 'PENDING', ...(bookingStopId ? { bookingStopId } : {}) },
    });
    for (const collection of open) {
      try {
        await this.closeOnline(collection, reason);
      } catch (error) {
        this.logger.warn(
          { err: error, collectionId: collection.id, bookingId },
          'Could not close an open collection; it will expire on its own',
        );
      }
    }
  }

  private async collectCash(
    driverId: string,
    trip: Trip,
    booking: Booking,
    key: string,
    input: CollectInput,
  ): Promise<CollectResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.recordCash(driverId, trip.id, booking.id, key, input);
      } catch (error) {
        if (!(error instanceof OpenOnlineCollection)) {
          throw error;
        }
        // The customer was shown a QR for this obligation. Close it at Razorpay before accepting
        // cash, so it can't be paid twice. If it turns out to be paid, the cash is refused below.
        const open = await this.get(error.collectionId);
        await this.closeOnline(open, 'CANCELLED_FOR_CASH');
      }
    }
    throw new AppError(
      ErrorCode.COLLECTION_IN_PROGRESS,
      HttpStatus.CONFLICT,
      'An online payment is still in progress for this booking. Try again shortly',
    );
  }

  /**
   * One transaction: lock booking -> trip -> drops -> wallet, resolve the obligation, debit its
   * fee, record the cash, and record its effects (booking paid, or the drop's payment confirmed).
   */
  private recordCash(
    driverId: string,
    tripId: string,
    bookingId: string,
    key: string,
    input: CollectInput,
  ): Promise<CollectResult> {
    return this.prisma.runInTransaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId);
      const trip = await lockTripOfBooking(tx, bookingId);
      if (!booking || !trip || trip.id !== tripId || trip.driverId !== driverId) {
        throw new AppError(ErrorCode.TRIP_NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
      }
      const stops = await this.lockStops(tx, booking);
      // Checked after the locks, so a concurrent duplicate always sees the committed original.
      const replay = await this.findReplay(tx, key);
      if (replay) {
        assertSameRequest(replay, tripId, input);
        return { collection: replay, replayed: true };
      }
      const rule = await tx.feeRule.findUniqueOrThrow({ where: { id: booking.feeRuleId } });
      const obligation = obligationOrThrow(
        await this.obligationContext(tx, booking, trip, stops),
        input,
      );

      const open = await tx.paymentCollection.findFirst({
        where: { bookingId, bookingStopId: obligation.stop?.id ?? null, status: 'PENDING' },
        select: { id: true },
      });
      if (open) {
        throw new OpenOnlineCollection(open.id);
      }

      const fee = obligation.cashFeePaise;
      const collectionId = randomUUID();
      const now = new Date();

      let walletTransactionId: string | null = null;
      if (fee > 0n) {
        const walletId = await this.ensureWallet(tx, driverId);
        try {
          const { entry, replayed } = await this.ledger.postEntry(tx, {
            walletId,
            type: 'CASH_RIDE_FEE',
            direction: 'DEBIT',
            amountPaise: fee,
            referenceType: 'BOOKING',
            referenceId: bookingId,
            // One platform-fee debit per collection, ever: the ledger's unique key enforces it.
            // A historical booking keeps its key (one debit per booking), as before.
            idempotencyKey:
              booking.paymentModel === 'LEGACY_BOOKING_LEVEL'
                ? `cash-ride-fee:${bookingId}`
                : `cash-ride-fee:collection:${collectionId}`,
            reason: 'Cash ride platform fee',
            metadata: {
              collectionId,
              tripId,
              feeRuleId: rule.id,
              stopSequence: obligation.stop?.sequence ?? null,
            },
          });
          if (replayed) {
            throw new Error(`Booking ${bookingId} already has a cash fee debit but is unpaid`);
          }
          walletTransactionId = entry.id;
        } catch (error) {
          if (error instanceof AppError && error.code === ErrorCode.INSUFFICIENT_BALANCE) {
            throw new AppError(
              ErrorCode.INSUFFICIENT_BALANCE,
              HttpStatus.CONFLICT,
              'Your wallet balance does not cover the platform fee for this cash payment. Recharge your wallet and try again',
              { requiredFeePaise: Number(fee) },
            );
          }
          throw error;
        }
      }

      const collection = await tx.paymentCollection.create({
        data: {
          id: collectionId,
          bookingId,
          bookingStopId: obligation.stop?.id ?? null,
          tripId,
          stage: obligation.stage,
          method: 'CASH',
          amountPaise: obligation.amountPaise,
          collectedByDriverId: driverId,
          status: 'COMPLETED',
          platformFeePaise: fee,
          feeRuleId: rule.id,
          walletTransactionId,
          idempotencyKey: key,
          completedAt: now,
        },
        include: WITH_STOP,
      });
      await applyCollectionCompleted(tx, booking, trip, stops, collection, now);
      this.logger.log(
        {
          collectionId,
          bookingId,
          tripId,
          driverId,
          stopSequence: obligation.stop?.sequence,
          feePaise: Number(fee),
        },
        'Cash collection recorded',
      );
      return { collection, replayed: false };
    });
  }

  private async createOnlineCollection(
    driverId: string,
    trip: Trip,
    booking: Booking,
    key: string,
    input: CollectInput,
    obligation: CollectionObligation,
  ): Promise<CollectResult> {
    const product = this.config.collections.product;
    if (!product) {
      throw new AppError(
        ErrorCode.COLLECTION_PROVIDER_NOT_CONFIGURED,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Online collection is not enabled. Collect cash or ask the customer to pay in the app',
      );
    }
    const stopId = obligation.stop?.id ?? null;

    // Reuse this obligation's live QR rather than showing the customer a second one.
    const open = await this.prisma.paymentCollection.findFirst({
      where: { bookingId: booking.id, bookingStopId: stopId, status: 'PENDING' },
    });
    if (open) {
      const { collection } = await this.refresh(open, { source: 'DRIVER_REFRESH' });
      if (collection.status !== 'FAILED') {
        return { collection, replayed: true };
      }
    }

    const collectionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.collections.linkTtlMinutes * 60_000);
    let state: CollectionLinkState;
    try {
      state = await this.links.create(product, {
        collectionId,
        bookingId: booking.id,
        stage: obligation.stage,
        stop: obligation.stop,
        amountPaise: Number(obligation.amountPaise),
        expiresAt,
        description: obligation.stop
          ? `PickUp booking ${booking.externalRef}, drop ${obligation.stop.sequence}`
          : `PickUp booking ${booking.externalRef}`,
      });
    } catch (error) {
      throw toProviderAppError(error);
    }
    if (BigInt(state.amountPaise) !== obligation.amountPaise || state.status !== 'ACTIVE') {
      this.logger.error(
        { collectionId, referenceId: state.referenceId, alert: 'PAYMENT_ANOMALY' },
        'Provider returned an unexpected collection object',
      );
      await this.cancelQuietly(product, state.referenceId);
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        HttpStatus.BAD_GATEWAY,
        'Payment provider returned an unexpected QR',
      );
    }

    try {
      return await this.prisma
        .runInTransaction(async (tx) => {
          const lockedBooking = await lockBooking(tx, booking.id);
          const lockedTrip = await lockTripOfBooking(tx, booking.id);
          if (!lockedBooking || !lockedTrip || lockedTrip.id !== trip.id) {
            throw new AppError(ErrorCode.TRIP_NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
          }
          const stops = await this.lockStops(tx, lockedBooking);
          const replay = await this.findReplay(tx, key);
          if (replay) {
            assertSameRequest(replay, trip.id, input);
            return { collection: replay, replayed: true, orphan: true };
          }
          // The QR was made for this obligation; it must still be the one owed now (the drop may
          // have moved, or cash may have been recorded meanwhile).
          const current = obligationOrThrow(
            await this.obligationContext(tx, lockedBooking, lockedTrip, stops),
            input,
          );
          if (
            (current.stop?.id ?? null) !== stopId ||
            current.amountPaise !== obligation.amountPaise
          ) {
            throw new AppError(
              ErrorCode.COLLECTION_NOT_ALLOWED,
              HttpStatus.CONFLICT,
              'What is owed changed while the QR was being prepared. Refresh and try again',
            );
          }
          const collection = await tx.paymentCollection.create({
            data: {
              id: collectionId,
              bookingId: booking.id,
              bookingStopId: stopId,
              tripId: trip.id,
              stage: current.stage,
              method: 'ONLINE_QR',
              amountPaise: current.amountPaise,
              collectedByDriverId: driverId,
              status: 'PENDING',
              provider: PAYMENT_PROVIDER_RAZORPAY,
              providerProduct: product,
              providerReferenceId: state.referenceId,
              providerLinkUrl: state.url,
              expiresAt: state.expiresAt ?? expiresAt,
              idempotencyKey: key,
            },
          });
          return { collection, replayed: false, orphan: false };
        })
        .then(async (result) => {
          if (result.orphan) {
            await this.cancelQuietly(product, state.referenceId);
          }
          this.logger.log(
            {
              collectionId: result.collection.id,
              bookingId: booking.id,
              stopSequence: obligation.stop?.sequence,
              product,
            },
            'Online collection created',
          );
          return { collection: result.collection, replayed: result.replayed };
        });
    } catch (error) {
      // Nobody will ever see this QR: make sure it can't be paid.
      await this.cancelQuietly(product, state.referenceId);
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.paymentCollection.findFirst({
          where: {
            bookingId: booking.id,
            bookingStopId: stopId,
            status: { in: ['PENDING', 'COMPLETED'] },
          },
        });
        if (winner) {
          return { collection: winner, replayed: true };
        }
      }
      throw error;
    }
  }

  private async refresh(
    collection: PaymentCollection,
    context: { source: 'DRIVER_REFRESH' | 'ADMIN_SYNC' | 'WEBHOOK'; providerEventId?: string },
  ): Promise<CollectionApplyResult> {
    const product = productOf(collection);
    if (!product || !collection.providerReferenceId) {
      return { collection, outcome: 'ALREADY_APPLIED' };
    }
    let state: CollectionLinkState;
    try {
      state = await this.links.fetch(product, collection.providerReferenceId);
    } catch (error) {
      throw toProviderAppError(error);
    }
    return this.finalizer.apply(collection.id, state, context);
  }

  private async closeOnline(collection: PaymentCollection, reason: string): Promise<void> {
    const product = productOf(collection);
    if (collection.status !== 'PENDING' || !product || !collection.providerReferenceId) {
      return;
    }
    let state: CollectionLinkState;
    try {
      state = await this.links.cancel(product, collection.providerReferenceId);
    } catch (error) {
      throw toProviderAppError(error);
    }
    const result = await this.finalizer.apply(collection.id, state, {
      source: 'DRIVER_REFRESH',
      closeReason: reason,
    });
    if (result.collection.status === 'PENDING') {
      throw new AppError(
        ErrorCode.COLLECTION_IN_PROGRESS,
        HttpStatus.CONFLICT,
        'An online payment is still in progress for this booking. Try again shortly',
      );
    }
  }

  private async cancelQuietly(product: CollectionProduct, referenceId: string): Promise<void> {
    try {
      await this.links.cancel(product, referenceId);
    } catch (error) {
      const retryable = error instanceof RazorpayUnavailableError;
      this.logger.warn(
        {
          referenceId,
          reason: error instanceof RazorpayApiError ? error.errorCode : 'unknown',
          retryable,
        },
        'Could not cancel an unused collection object; it expires on its own',
      );
    }
  }

  /** What is owed and why: the booking, its trip, its drops and the fee frozen for it. */
  private async obligationContext(
    db: Tx | PrismaService,
    booking: Booking,
    trip: Trip,
    lockedStops: readonly BookingStop[] | null,
  ): Promise<ObligationContext> {
    const stops =
      lockedStops ??
      (booking.paymentModel === 'QUOTE_PER_STOP'
        ? await db.bookingStop.findMany({
            where: { bookingId: booking.id },
            orderBy: { sequence: 'asc' },
          })
        : []);
    // The fee frozen at registration; a historical booking computes it from its pinned rule.
    const bookingFeePaise =
      booking.platformFeePaise ??
      feeForFare(
        await db.feeRule.findUniqueOrThrow({ where: { id: booking.feeRuleId } }),
        booking.finalFareMinor,
      );
    return { booking, tripStatus: trip.status, stops, bookingFeePaise };
  }

  /** Booking -> trip -> drops: the drops are locked after the trip (none for a historical booking). */
  private lockStops(tx: Tx, booking: Booking): Promise<BookingStop[]> {
    return booking.paymentModel === 'QUOTE_PER_STOP'
      ? lockStopsOfBooking(tx, booking.id)
      : Promise.resolve([]);
  }

  private findReplay(db: Tx | PrismaService, key: string): Promise<CollectionWithStop | null> {
    return db.paymentCollection.findUnique({
      where: { idempotencyKey: key },
      include: WITH_STOP,
    });
  }

  private async findByHint(hint: CollectionHint): Promise<PaymentCollection | null> {
    if (hint.providerReferenceId) {
      const byReference = await this.prisma.paymentCollection.findFirst({
        where: {
          provider: PAYMENT_PROVIDER_RAZORPAY,
          providerReferenceId: hint.providerReferenceId,
        },
      });
      if (byReference) {
        return byReference;
      }
    }
    if (hint.collectionId && UUID_PATTERN.test(hint.collectionId)) {
      const byId = await this.prisma.paymentCollection.findUnique({
        where: { id: hint.collectionId },
      });
      if (byId?.method === 'ONLINE_QR') {
        return byId;
      }
    }
    if (hint.providerOrderId) {
      return this.prisma.paymentCollection.findFirst({
        where: { provider: PAYMENT_PROVIDER_RAZORPAY, providerOrderId: hint.providerOrderId },
      });
    }
    return null;
  }

  private async ensureWallet(tx: Tx, driverId: string): Promise<string> {
    await tx.$executeRaw`
      INSERT INTO driver_wallets (driver_id)
      VALUES (${driverId}::uuid)
      ON CONFLICT (driver_id) DO NOTHING`;
    const wallet = await tx.driverWallet.findUniqueOrThrow({
      where: { driverId },
      select: { id: true },
    });
    return wallet.id;
  }
}

/** The obligation owed now, or the refusal as an API error. */
function obligationOrThrow(context: ObligationContext, input: CollectInput): CollectionObligation {
  const decision = resolveObligation(context, {
    amountPaise: input.amountPaise,
    stopSequence: input.stopSequence,
  });
  if (decision.ok) {
    return decision.obligation;
  }
  throw obligationError(decision.refusal, context.tripStatus);
}

function obligationError(refusal: ObligationRefusal, tripStatus: Trip['status']): AppError {
  switch (refusal.kind) {
    case 'NOT_COLLECTED':
      return new AppError(
        ErrorCode.COLLECTION_NOT_ALLOWED,
        HttpStatus.CONFLICT,
        'This booking is prepaid: the customer pays in the app',
      );
    case 'STOP_REQUIRED':
      return new AppError(
        ErrorCode.STOP_REQUIRED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'This booking is paid drop by drop: give the drop being paid for (stopSequence)',
      );
    case 'STOP_NOT_EXPECTED':
      return new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Request validation failed',
        {
          fields: [
            {
              field: 'stopSequence',
              issues: ['stopSequence is only accepted for a booking paid drop by drop'],
            },
          ],
        },
      );
    case 'ALREADY_PAID':
      return new AppError(
        ErrorCode.BOOKING_ALREADY_PAID,
        HttpStatus.CONFLICT,
        'This booking is already paid',
      );
    case 'BOOKING_CLOSED':
      return new AppError(ErrorCode.BOOKING_CLOSED, HttpStatus.CONFLICT, 'This booking is closed');
    case 'WINDOW_CLOSED':
      return new AppError(
        ErrorCode.COLLECTION_NOT_ALLOWED,
        HttpStatus.CONFLICT,
        refusal.stage === 'PICKUP'
          ? 'Payment for this booking is collected once you reach the pickup'
          : 'Payment for this booking is collected after the last drop is delivered',
        { stage: refusal.stage, tripStatus },
      );
    case 'STOP_NOT_FOUND':
      return new AppError(
        ErrorCode.STOP_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'This booking has no such drop',
        {
          sequence: refusal.stopSequence,
        },
      );
    case 'NOT_CURRENT_STOP':
      return new AppError(
        ErrorCode.COLLECTION_NOT_ALLOWED,
        HttpStatus.CONFLICT,
        refusal.reason === 'STOP_ALREADY_PAID'
          ? 'This drop is already paid'
          : 'Only the drop you are at is collected, once you reach it',
        {
          stage: 'DELIVERY',
          reason: refusal.reason,
          stopSequence: refusal.stopSequence,
          stopStatus: refusal.stopStatus,
          currentStop: refusal.currentStop,
          tripStatus,
        },
      );
    case 'AMOUNT_MISMATCH':
      return new AppError(
        ErrorCode.COLLECTION_AMOUNT_MISMATCH,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'The amount must equal what is owed',
        { expectedPaise: Number(refusal.expectedPaise) },
      );
  }
}

function assertSameRequest(
  existing: CollectionWithStop,
  tripId: string,
  input: CollectInput,
): void {
  if (
    existing.tripId !== tripId ||
    existing.method !== input.method ||
    existing.amountPaise !== input.amountPaise ||
    (existing.bookingStop?.sequence ?? null) !== input.stopSequence
  ) {
    throw new AppError(
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      HttpStatus.CONFLICT,
      'This idempotency key was already used for a different request',
    );
  }
}

function productOf(collection: PaymentCollection): CollectionProduct | null {
  return collection.providerProduct === 'PAYMENT_LINK' || collection.providerProduct === 'QR_CODE'
    ? collection.providerProduct
    : null;
}
