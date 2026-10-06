import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { lockBooking, lockTripOfBooking } from '../bookings/booking-locks';
import { applyBookingPaid } from '../bookings/booking-payment-state';
import { collectionStageOf, isCollectionOpen } from '../bookings/bookings.mapper';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { feeForFare } from '../fees/fee-rules';
import type { Booking, PaymentCollection, Trip } from '../generated/prisma/client';
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

export type CollectionMethod = 'CASH' | 'ONLINE_QR';

export interface CollectInput {
  readonly method: CollectionMethod;
  /** What the driver says the customer paid. Must equal the booking's confirmed fare. */
  readonly amountPaise: bigint;
}

export interface CollectResult {
  readonly collection: PaymentCollection;
  /** True when this request was already processed (same Idempotency-Key) or reused a live QR. */
  readonly replayed: boolean;
}

/** Hints carried by a signed webhook that identify one of our collections. */
export interface CollectionHint {
  readonly providerReferenceId?: string | null;
  readonly collectionId?: string | null;
  readonly providerOrderId?: string | null;
}

/** Thrown inside the cash transaction when a QR is still open for the booking. */
class OpenOnlineCollection extends Error {
  constructor(readonly collectionId: string) {
    super('An online collection is still open for this booking');
    this.name = 'OpenOnlineCollection';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pickup / delivery payments for PAY_AT_PICKUP and PAY_AT_DELIVERY bookings (PW 5 and 6).
 *
 * CASH: the driver records the cash in one transaction that locks the booking, trip and wallet,
 * debits the platform fee from the driver wallet (CASH_RIDE_FEE ledger entry, never below zero)
 * and marks the booking paid. The driver keeps the rest of the cash.
 *
 * ONLINE_QR: the server creates a booking-linked Razorpay payment link or QR code for the
 * confirmed fare. Only Razorpay's own report of a captured payment (webhook, driver refresh or
 * admin sync) completes it; the money goes to Nikhil Enterprises and the driver's share is paid
 * out weekly as a driver earning.
 */
@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly links: CollectionLinkGateway,
    private readonly finalizer: CollectionFinalizerService,
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

    const replay = await this.findReplay(key, tripId, input);
    if (replay) {
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
    assertCollectable(booking, tripRow, input.amountPaise);

    return input.method === 'CASH'
      ? this.collectCash(driver.id, tripRow, booking, key, input.amountPaise)
      : this.createOnlineCollection(driver.id, tripRow, booking, key, input.amountPaise);
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
   * Closes a booking's open QR at Razorpay (booking cancelled). Best effort: failures are logged
   * and the QR still expires on its own; any late payment is flagged for refund review.
   */
  async closeOpenCollections(bookingId: string, reason: string): Promise<void> {
    const open = await this.prisma.paymentCollection.findMany({
      where: { bookingId, status: 'PENDING' },
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
    amount: bigint,
  ): Promise<CollectResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.recordCash(driverId, trip.id, booking.id, key, amount);
      } catch (error) {
        if (!(error instanceof OpenOnlineCollection)) {
          throw error;
        }
        // The customer was shown a QR. Close it at Razorpay before accepting cash, so the
        // booking can't be paid twice. If it turns out to be paid, the cash is refused below.
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

  /** One transaction: lock booking -> trip -> wallet, debit the fee, record the cash, mark paid. */
  private recordCash(
    driverId: string,
    tripId: string,
    bookingId: string,
    key: string,
    amount: bigint,
  ): Promise<CollectResult> {
    return this.prisma.runInTransaction(async (tx) => {
      const booking = await lockBooking(tx, bookingId);
      const trip = await lockTripOfBooking(tx, bookingId);
      if (!booking || !trip || trip.id !== tripId || trip.driverId !== driverId) {
        throw new AppError(ErrorCode.TRIP_NOT_FOUND, HttpStatus.NOT_FOUND, 'Trip not found');
      }
      // Checked after the locks, so a concurrent duplicate always sees the committed original.
      const replay = await tx.paymentCollection.findUnique({ where: { idempotencyKey: key } });
      if (replay) {
        assertSameRequest(replay, tripId, { method: 'CASH', amountPaise: amount });
        return { collection: replay, replayed: true };
      }
      const stage = assertCollectable(booking, trip, amount);

      const open = await tx.paymentCollection.findFirst({
        where: { bookingId, status: 'PENDING' },
        select: { id: true },
      });
      if (open) {
        throw new OpenOnlineCollection(open.id);
      }

      const rule = await tx.feeRule.findUniqueOrThrow({ where: { id: booking.feeRuleId } });
      const fee = feeForFare(rule, booking.finalFareMinor);
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
            // One platform-fee debit per booking, ever: the ledger's unique key enforces it.
            idempotencyKey: `cash-ride-fee:${bookingId}`,
            reason: 'Cash ride platform fee',
            metadata: { collectionId, tripId, feeRuleId: rule.id },
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
              'Your wallet balance does not cover the platform fee for this cash trip. Recharge your wallet and try again',
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
          tripId,
          stage,
          method: 'CASH',
          amountPaise: amount,
          collectedByDriverId: driverId,
          status: 'COMPLETED',
          platformFeePaise: fee,
          feeRuleId: rule.id,
          walletTransactionId,
          idempotencyKey: key,
          completedAt: now,
        },
      });
      await applyBookingPaid(tx, booking, trip, now);
      this.logger.log(
        { collectionId, bookingId, tripId, driverId, feePaise: Number(fee) },
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
    amount: bigint,
  ): Promise<CollectResult> {
    const product = this.config.collections.product;
    if (!product) {
      throw new AppError(
        ErrorCode.COLLECTION_PROVIDER_NOT_CONFIGURED,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Online collection is not enabled. Collect cash or ask the customer to pay in the app',
      );
    }

    // Reuse the booking's live QR rather than showing the customer a second one.
    const open = await this.prisma.paymentCollection.findFirst({
      where: { bookingId: booking.id, status: 'PENDING' },
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
        amountPaise: Number(amount),
        expiresAt,
        description: `PickUp booking ${booking.externalRef}`,
      });
    } catch (error) {
      throw toProviderAppError(error);
    }
    if (BigInt(state.amountPaise) !== amount || state.status !== 'ACTIVE') {
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
          const replay = await tx.paymentCollection.findUnique({ where: { idempotencyKey: key } });
          if (replay) {
            assertSameRequest(replay, trip.id, { method: 'ONLINE_QR', amountPaise: amount });
            return { collection: replay, replayed: true, orphan: true };
          }
          const stage = assertCollectable(lockedBooking, lockedTrip, amount);
          const collection = await tx.paymentCollection.create({
            data: {
              id: collectionId,
              bookingId: booking.id,
              tripId: trip.id,
              stage,
              method: 'ONLINE_QR',
              amountPaise: amount,
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
            { collectionId: result.collection.id, bookingId: booking.id, product },
            'Online collection created',
          );
          return { collection: result.collection, replayed: result.replayed };
        });
    } catch (error) {
      // Nobody will ever see this QR: make sure it can't be paid.
      await this.cancelQuietly(product, state.referenceId);
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.paymentCollection.findFirst({
          where: { bookingId: booking.id, status: { in: ['PENDING', 'COMPLETED'] } },
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

  private async findReplay(
    key: string,
    tripId: string,
    input: CollectInput,
  ): Promise<PaymentCollection | null> {
    const existing = await this.prisma.paymentCollection.findUnique({
      where: { idempotencyKey: key },
    });
    if (!existing) {
      return null;
    }
    assertSameRequest(existing, tripId, input);
    return existing;
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

/** Validates that this booking can be collected now, for exactly its confirmed fare. */
function assertCollectable(booking: Booking, trip: Trip, amount: bigint): 'PICKUP' | 'DELIVERY' {
  const stage = collectionStageOf(booking);
  if (!stage) {
    throw new AppError(
      ErrorCode.COLLECTION_NOT_ALLOWED,
      HttpStatus.CONFLICT,
      'This booking is prepaid: the customer pays in the app',
    );
  }
  if (booking.paymentStatus !== 'UNPAID') {
    throw new AppError(
      ErrorCode.BOOKING_ALREADY_PAID,
      HttpStatus.CONFLICT,
      'This booking is already paid',
    );
  }
  if (
    booking.status === 'CANCELLED' ||
    booking.status === 'COMPLETED' ||
    trip.status === 'CANCELLED' ||
    trip.status === 'COMPLETED'
  ) {
    throw new AppError(ErrorCode.BOOKING_CLOSED, HttpStatus.CONFLICT, 'This booking is closed');
  }
  if (!isCollectionOpen(booking, trip)) {
    throw new AppError(
      ErrorCode.COLLECTION_NOT_ALLOWED,
      HttpStatus.CONFLICT,
      stage === 'PICKUP'
        ? 'Payment for this booking is collected once you reach the pickup'
        : 'Payment for this booking is collected after the last drop is delivered',
      { stage, tripStatus: trip.status },
    );
  }
  if (amount !== booking.finalFareMinor) {
    throw new AppError(
      ErrorCode.COLLECTION_AMOUNT_MISMATCH,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'The amount must equal the confirmed fare',
      { expectedPaise: Number(booking.finalFareMinor) },
    );
  }
  return stage;
}

function assertSameRequest(existing: PaymentCollection, tripId: string, input: CollectInput): void {
  if (
    existing.tripId !== tripId ||
    existing.method !== input.method ||
    existing.amountPaise !== input.amountPaise
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
