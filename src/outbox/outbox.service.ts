import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { describeError } from '../common/errors';
import { ENGINE_CONFIG, type EngineConfig } from '../config/engine-config';
import { DriversService } from '../drivers/drivers.service';
import type { EngineOutbox, Prisma } from '../generated/prisma/client';
import {
  type BackendOutcome,
  type BackendRequest,
  PaymentBackendClient,
} from '../payment-backend/payment-backend.client';
import {
  type InternalBooking,
  internalBookingSchema,
} from '../payment-backend/payment-backend.types';
import { lockBooking } from '../prisma/locks';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { OutboxEffects, type PostCommit } from './outbox-effects';
import { type OutboxPayload, readPayload } from './outbox-payloads';
import {
  backoffMs,
  classify,
  type OutboxModeName,
  shouldAlertRetry,
  type Verdict,
} from './outbox-policy';

export type OutboxEntry = OutboxPayload & {
  readonly bookingId: string;
  readonly mode: OutboxModeName;
};

/** What the backend answered, kept on the record once final. */
export interface OutboxResult {
  readonly httpStatus: number | null;
  readonly code?: string;
  readonly message?: string;
  readonly details?: Readonly<Record<string, unknown>> | null;
  readonly bookingStatus?: string;
  readonly paymentStatus?: string;
  readonly tripId?: string | null;
  readonly tripStatus?: string | null;
  readonly paymentGate?: InternalBooking['paymentGate'];
  readonly stops?: readonly {
    readonly sequence: number;
    readonly status: string;
  }[];
}

const DISPATCH_BATCH = 25;
/** How long a synchronous flush waits for a record another sender is delivering right now. */
const IN_FLIGHT_POLL_MS = 50;
const SHUTDOWN_WAIT_MS = 10_000;

/**
 * The durable outbox from the engine to the payment backend (review F, "Outbox rules").
 *
 * - Durable: a record is written in the same transaction as the engine state it reports, so a
 *   crash never loses one and never sends one for a change that rolled back.
 * - FIFO per booking: only the oldest pending record of a booking is ever sent; the next one
 *   waits until it is delivered or definitively refused.
 * - One sender at a time: a record is claimed with a lease (UPDATE ... FOR UPDATE SKIP LOCKED),
 *   so several engine instances and the synchronous flush never send it twice at once. A sender
 *   that dies loses its lease, and the record is sent again (the backend treats repeats as
 *   no-ops, and the engine applies an answer once: finalizing re-checks the claim).
 * - Retried with exponential backoff and jitter until a definitive answer; an alert after
 *   OUTBOX_ALERT_AFTER_ATTEMPTS. Never dropped: a refusal is recorded (and alerted unless it is
 *   the expected PAYMENT_REQUIRED of a backend-first command).
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PaymentBackendClient,
    private readonly effects: OutboxEffects,
    private readonly drivers: DriversService,
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.config.outbox.pollIntervalMs;
    if (interval > 0) {
      this.timer = setInterval(() => void this.tick(), interval);
      this.timer.unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ticking) {
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        this.ticking,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, SHUTDOWN_WAIT_MS);
          timeout.unref();
        }),
      ]);
      clearTimeout(timeout);
    }
  }

  /** One background pass; never throws, never overlaps itself. */
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = this.dispatchDue()
      .then(
        () => undefined,
        (error: unknown) => {
          this.logger.error({
            msg: 'Outbox pass failed',
            error: describeError(error),
          });
        },
      )
      .finally(() => {
        this.ticking = null;
      });
    await this.ticking;
  }

  /** Records a call in the caller's transaction. The caller holds the booking lock. */
  async enqueue(tx: Tx, entry: OutboxEntry): Promise<bigint> {
    const created = await tx.engineOutbox.create({
      data: {
        bookingId: entry.bookingId,
        kind: entry.kind,
        mode: entry.mode,
        payload: entry.payload,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** The pending record of this kind (and status / drop) for the booking, if one exists. */
  async findPending(
    tx: Tx,
    bookingId: string,
    kind: OutboxPayload['kind'],
    match: { readonly status?: string; readonly sequence?: number } = {},
  ): Promise<EngineOutbox | null> {
    const pending = await tx.engineOutbox.findMany({
      where: { bookingId, kind, status: 'PENDING' },
      orderBy: { id: 'asc' },
    });
    return (
      pending.find((record) => {
        const payload = record.payload as Record<string, unknown> | null;
        return (
          (match.status === undefined ||
            payload?.['status'] === match.status) &&
          (match.sequence === undefined ||
            payload?.['sequence'] === match.sequence)
        );
      }) ?? null
    );
  }

  /**
   * A cancellation supersedes backend-first commands still waiting (an unanswered pickup or
   * delivery confirmation must never be sent after the booking was cancelled). Events stay:
   * they describe what already happened, and go out before the cancellation (FIFO).
   */
  async supersedePendingCommands(
    tx: Tx,
    bookingId: string,
    reason: string,
  ): Promise<number> {
    const result = await tx.engineOutbox.updateMany({
      where: { bookingId, status: 'PENDING', mode: 'COMMAND' },
      data: {
        status: 'REFUSED',
        refusedAt: new Date(),
        lastErrorCode: 'SUPERSEDED',
        lastError: reason.slice(0, 500),
        lockedUntil: null,
        claimId: null,
      },
    });
    return result.count;
  }

  get(id: bigint): Promise<EngineOutbox> {
    return this.prisma.engineOutbox.findUniqueOrThrow({ where: { id } });
  }

  /** Background sender: the oldest due record of each booking, several bookings at once. */
  async dispatchDue(limit = DISPATCH_BATCH): Promise<number> {
    const claimId = randomUUID();
    const lease = this.config.outbox.leaseSeconds;
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      WITH due AS (
        SELECT o.id FROM engine_outbox o
         WHERE o.status = 'PENDING'::engine_outbox_status
           AND o.next_attempt_at <= clock_timestamp()
           AND (o.locked_until IS NULL OR o.locked_until < clock_timestamp())
           AND NOT EXISTS (
             SELECT 1 FROM engine_outbox e
              WHERE e.booking_id = o.booking_id
                AND e.status = 'PENDING'::engine_outbox_status
                AND e.id < o.id)
         ORDER BY o.id
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED)
      UPDATE engine_outbox o
         SET locked_until = clock_timestamp() + make_interval(secs => ${lease}::int),
             claim_id = ${claimId}::uuid,
             updated_at = clock_timestamp()
        FROM due
       WHERE o.id = due.id
      RETURNING o.id`;
    if (claimed.length === 0) {
      return 0;
    }
    const records = await this.prisma.engineOutbox.findMany({
      where: { id: { in: claimed.map((row) => row.id) } },
      orderBy: { id: 'asc' },
    });
    await Promise.all(records.map((record) => this.deliver(record, claimId)));
    return records.length;
  }

  /**
   * Synchronous path, for backend-first commands and before reading the payment gate: sends the
   * booking's pending records now, in order (ignoring their backoff), until `targetId` is final or
   * a record gets no definitive answer. Returns the target record as it is then (PENDING when its
   * outcome is still unknown), or null without a target.
   */
  async flushBooking(
    bookingId: string,
    targetId: bigint | null = null,
  ): Promise<EngineOutbox | null> {
    const deadline =
      Date.now() + this.config.paymentBackend.timeoutMs * 2 + 1_000;
    const target = async () => (targetId === null ? null : this.get(targetId));
    for (;;) {
      if (targetId !== null) {
        const current = await this.get(targetId);
        if (current.status !== 'PENDING') {
          return current;
        }
      }
      const claimId = randomUUID();
      const head = await this.claimHead(bookingId, claimId);
      if (!head) {
        const pending = await this.prisma.engineOutbox.findFirst({
          where: { bookingId, status: 'PENDING' },
          orderBy: { id: 'asc' },
          select: { id: true },
        });
        if (!pending || Date.now() > deadline) {
          // Nothing left to send, or the head is being delivered elsewhere for too long.
          return target();
        }
        await sleep(IN_FLIGHT_POLL_MS);
        continue;
      }
      const verdict = await this.deliver(head, claimId);
      if (verdict.kind === 'RETRY') {
        // The head is still pending: nothing after it may be sent yet (FIFO).
        return target();
      }
      if (targetId !== null && head.id === targetId) {
        return target();
      }
    }
  }

  private async claimHead(
    bookingId: string,
    claimId: string,
  ): Promise<EngineOutbox | null> {
    const lease = this.config.outbox.leaseSeconds;
    const claimed = await this.prisma.$queryRaw<{ id: bigint }[]>`
      WITH head AS (
        SELECT o.id FROM engine_outbox o
         WHERE o.booking_id = ${bookingId}::uuid
           AND o.status = 'PENDING'::engine_outbox_status
           AND NOT EXISTS (
             SELECT 1 FROM engine_outbox e
              WHERE e.booking_id = o.booking_id
                AND e.status = 'PENDING'::engine_outbox_status
                AND e.id < o.id)
           AND (o.locked_until IS NULL OR o.locked_until < clock_timestamp())
         ORDER BY o.id
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      UPDATE engine_outbox o
         SET locked_until = clock_timestamp() + make_interval(secs => ${lease}::int),
             claim_id = ${claimId}::uuid,
             updated_at = clock_timestamp()
        FROM head
       WHERE o.id = head.id
      RETURNING o.id`;
    const id = claimed[0]?.id;
    return id === undefined ? null : this.get(id);
  }

  /** Sends one claimed record and records the answer. Never throws. */
  private async deliver(
    record: EngineOutbox,
    claimId: string,
  ): Promise<Verdict> {
    const attempt = record.attempts + 1;
    const entry = readPayload(record.kind, record.payload);
    let outcome: BackendOutcome;
    let booking: InternalBooking | null = null;
    if (!entry) {
      outcome = refusal(
        'INVALID_OUTBOX_PAYLOAD',
        'The stored payload no longer parses',
      );
    } else {
      const request = await this.buildRequest(record, entry, attempt);
      if ('refusal' in request) {
        outcome = request.refusal;
      } else {
        const answer = await this.client.call(request);
        const parsed = this.client.parse(
          internalBookingSchema,
          answer,
          request.path,
        );
        if (parsed.kind === 'OK') {
          booking = parsed.value;
          outcome = answer;
        } else {
          outcome = parsed;
        }
      }
    }
    const verdict = classify(
      {
        kind: record.kind,
        mode: record.mode,
        status:
          entry &&
          (entry.kind === 'TRIP_STATUS' || entry.kind === 'STOP_STATUS')
            ? entry.payload.status
            : undefined,
      },
      outcome,
    );
    try {
      await this.finalize(
        record,
        claimId,
        entry,
        outcome,
        booking,
        verdict,
        attempt,
      );
    } catch (error) {
      // The claim expires and the record is sent again; the backend treats it as a repeat.
      this.logger.error({
        msg: 'Could not record an outbox answer; it will be sent again',
        outboxId: record.id.toString(),
        error: describeError(error),
      });
      return { kind: 'RETRY', alert: false };
    }
    return verdict;
  }

  private async finalize(
    record: EngineOutbox,
    claimId: string,
    entry: OutboxPayload | null,
    outcome: BackendOutcome,
    booking: InternalBooking | null,
    verdict: Verdict,
    attempt: number,
  ): Promise<void> {
    const result = summarize(outcome, booking);
    const alertRetry =
      verdict.kind === 'RETRY' &&
      shouldAlertRetry(attempt, this.config.outbox.alertAfterAttempts);
    const alertRefusal = verdict.kind === 'REFUSED' && verdict.alert;
    const failure =
      outcome.kind === 'OK'
        ? {
            lastHttpStatus: outcome.status,
            lastErrorCode: null,
            lastError: null,
          }
        : {
            lastHttpStatus: outcome.status,
            lastErrorCode: outcome.code.slice(0, 60),
            lastError: outcome.message.slice(0, 500) || null,
          };

    const postCommit = await this.prisma.runInTransaction(async (tx) => {
      await lockBooking(tx, record.bookingId);
      const owned = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM engine_outbox
         WHERE id = ${record.id} AND status = 'PENDING'::engine_outbox_status
           AND claim_id = ${claimId}::uuid
         FOR UPDATE`;
      if (owned.length === 0) {
        // Lease lost (another sender took over) or superseded by a cancellation meanwhile.
        return null;
      }
      const now = new Date();
      const alertedAt = alertRetry || alertRefusal ? now : undefined;
      switch (verdict.kind) {
        case 'DELIVERED': {
          const actions =
            entry && booking
              ? await this.effects.onDelivered(tx, record, entry, booking)
              : [];
          await tx.engineOutbox.update({
            where: { id: record.id },
            data: {
              ...failure,
              status: 'DELIVERED',
              attempts: attempt,
              deliveredAt: now,
              lockedUntil: null,
              claimId: null,
              result: result as unknown as Prisma.InputJsonObject,
            },
          });
          return actions;
        }
        case 'REFUSED': {
          const code = outcome.kind === 'OK' ? 'REFUSED' : outcome.code;
          const actions = await this.effects.onRefused(tx, entry, {
            code,
            message: outcome.kind === 'OK' ? '' : outcome.message,
          });
          await tx.engineOutbox.update({
            where: { id: record.id },
            data: {
              ...failure,
              status: 'REFUSED',
              attempts: attempt,
              refusedAt: now,
              lockedUntil: null,
              claimId: null,
              result: result as unknown as Prisma.InputJsonObject,
              ...(alertedAt ? { alertedAt } : {}),
            },
          });
          return actions;
        }
        case 'RETRY': {
          const delay = backoffMs(
            attempt,
            this.config.outbox.baseBackoffMs,
            this.config.outbox.maxBackoffMs,
          );
          await tx.engineOutbox.update({
            where: { id: record.id },
            data: {
              ...failure,
              attempts: attempt,
              nextAttemptAt: new Date(now.getTime() + delay),
              lockedUntil: null,
              claimId: null,
              ...(alertedAt ? { alertedAt } : {}),
            },
          });
          return [];
        }
      }
    });
    if (postCommit === null) {
      return;
    }
    this.runPostCommit(postCommit);
    if (alertRefusal) {
      this.logger.error({
        alert: 'ENGINE_OUTBOX_REFUSED',
        msg: 'The payment backend refused an engine report: engine and backend disagree (never dropped silently)',
        outboxId: record.id.toString(),
        bookingId: record.bookingId,
        kind: record.kind,
        mode: record.mode,
        payload: record.payload,
        code: failure.lastErrorCode,
        httpStatus: failure.lastHttpStatus,
      });
    } else if (alertRetry) {
      this.logger.error({
        alert: 'ENGINE_OUTBOX_STUCK',
        msg: 'An engine report still has no definitive answer from the payment backend; retrying',
        outboxId: record.id.toString(),
        bookingId: record.bookingId,
        kind: record.kind,
        attempts: attempt,
        code: failure.lastErrorCode,
        httpStatus: failure.lastHttpStatus,
      });
    }
  }

  private runPostCommit(actions: readonly PostCommit[]): void {
    for (const action of actions) {
      if (action.kind === 'DRIVER_AVAILABLE') {
        this.drivers.markAvailable(action.driverSubject);
      }
    }
  }

  private async buildRequest(
    record: EngineOutbox,
    entry: OutboxPayload,
    attempt: number,
  ): Promise<BackendRequest | { readonly refusal: BackendOutcome }> {
    const requestId = `eng-ob-${record.id.toString()}-${attempt}`;
    const booking = await this.prisma.engineBooking.findUnique({
      where: { id: record.bookingId },
      select: { paymentBookingId: true },
    });
    const paymentBookingId = booking?.paymentBookingId;
    if (!paymentBookingId) {
      return {
        refusal: refusal(
          'BOOKING_NOT_REGISTERED',
          'The booking has no payment booking',
        ),
      };
    }
    const bookingPath = `/v1/internal/bookings/${paymentBookingId}`;
    switch (entry.kind) {
      case 'SEARCHING':
        return { method: 'POST', path: `${bookingPath}/searching`, requestId };
      case 'ASSIGN':
        return {
          method: 'POST',
          path: `${bookingPath}/assign`,
          body: { driverSubject: entry.payload.driverSubject },
          requestId,
        };
      case 'CANCEL':
        return {
          method: 'POST',
          path: `${bookingPath}/cancel`,
          body: { reason: entry.payload.reason },
          requestId,
        };
      case 'TRIP_STATUS':
      case 'STOP_STATUS': {
        const trip = await this.prisma.engineTrip.findUnique({
          where: { id: entry.payload.tripId },
          select: { paymentTripId: true },
        });
        const paymentTripId = trip?.paymentTripId;
        if (!paymentTripId) {
          // ASSIGN was refused (it is always delivered first): the trip never existed there.
          return {
            refusal: refusal(
              'TRIP_NOT_ASSIGNED',
              'The trip has no payment trip',
            ),
          };
        }
        const tripPath = `/v1/internal/trips/${paymentTripId}`;
        if (entry.kind === 'TRIP_STATUS') {
          return {
            method: 'POST',
            path: `${tripPath}/status`,
            body: { status: entry.payload.status },
            requestId,
          };
        }
        return {
          method: 'POST',
          path: `${tripPath}/stops/${entry.payload.sequence}/status`,
          body:
            entry.payload.status === 'DELIVERY_FAILED'
              ? { status: entry.payload.status, reason: entry.payload.reason }
              : { status: entry.payload.status },
          requestId,
        };
      }
    }
  }
}

function refusal(code: string, message: string): BackendOutcome {
  return { kind: 'REFUSED', status: 0, code, message, details: null };
}

function summarize(
  outcome: BackendOutcome,
  booking: InternalBooking | null,
): OutboxResult {
  if (outcome.kind === 'OK' && booking) {
    return {
      httpStatus: outcome.status,
      bookingStatus: booking.status,
      paymentStatus: booking.paymentStatus,
      tripId: booking.trip?.tripId ?? null,
      tripStatus: booking.trip?.status ?? null,
      paymentGate: booking.paymentGate,
      stops: booking.stops.map((stop) => ({
        sequence: stop.sequence,
        status: stop.status,
      })),
    };
  }
  if (outcome.kind === 'OK') {
    return { httpStatus: outcome.status };
  }
  return {
    httpStatus: outcome.status,
    code: outcome.code,
    message: outcome.message,
    details: outcome.kind === 'REFUSED' ? outcome.details : null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
