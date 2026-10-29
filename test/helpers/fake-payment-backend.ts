import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * An in-process stand-in for raj_backend's internal API (/v1/internal/*), following its rules:
 * registration idempotent on externalRef, assignment idempotent for the same driver, trip
 * statuses strictly in M6 order with repeats as no-ops, the pickup gate (PAY_AT_PICKUP), the
 * per-drop state machine (PAY_AT_DELIVERY drops delivered only once paid), STOP_REQUIRED /
 * STOPS_PENDING, COMPLETED refused while unpaid, and paymentGate on every booking view.
 * Money is never told by the engine: tests pay through payBooking / payStop, as the Driver app
 * would through the backend's own collection API.
 *
 * Faults can be injected per request: a 503, a timeout, a refusal, or the request applied and
 * the connection dropped (the engine then has no answer: the classic lost response).
 */

export type FaultMode =
  'STATUS_503' | 'TIMEOUT' | 'DROP_AFTER_APPLY' | 'REFUSE' | 'DELAY';

export interface Fault {
  readonly match: (request: FakeRequest) => boolean;
  readonly mode: FaultMode;
  times: number;
  readonly refusal?: {
    status: number;
    code: string;
    message?: string;
    details?: Record<string, unknown>;
  };
  /** DELAY: the request is applied at once and answered after this many milliseconds. */
  readonly delayMs?: number;
  /** DELAY: resolves when the delayed request has been applied (before its answer is sent). */
  readonly onApplied?: () => void;
}

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | null;
  readonly requestId: string | undefined;
  status: number;
}

export interface FakeQuote {
  quoteId: string;
  customerSubject: string;
  vehicleCategory: string;
  weightKg: number;
  pickup: { latitude: number; longitude: number };
  drops: {
    sequence: number;
    latitude: number;
    longitude: number;
    distanceMeters: number;
    payablePaise: number;
  }[];
  payablePaise: number;
  distanceMeters: number;
  expiresAt: Date;
  redeemed: boolean;
}

type StopStatus =
  | 'PENDING'
  | 'ARRIVED'
  | 'PAYMENT_CONFIRMED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'UNDELIVERED'
  | 'CANCELLED';

interface FakeStop {
  sequence: number;
  payablePaise: number;
  status: StopStatus;
  paid: boolean;
  failedAt: Date | null;
  failureReason: string | null;
}

const TRIP_SEQUENCE = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'PAYMENT_CONFIRMED',
  'COMPLETED',
] as const;
type TripStatus = (typeof TRIP_SEQUENCE)[number] | 'CANCELLED';
const ENGINE_TRIP_STATUSES = [
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'DROP_PROGRESS',
  'DELIVERED',
  'COMPLETED',
];
const FINAL_STOPS: ReadonlySet<StopStatus> = new Set([
  'DELIVERED',
  'UNDELIVERED',
  'CANCELLED',
]);
const CURRENT_STOPS: ReadonlySet<StopStatus> = new Set([
  'ARRIVED',
  'PAYMENT_CONFIRMED',
]);

export interface FakeBooking {
  bookingId: string;
  externalRef: string;
  customerSubject: string;
  quoteId: string;
  paymentMethod: 'PAY_AT_PICKUP' | 'PAY_AT_DELIVERY';
  status:
    | 'CREATED'
    | 'SEARCHING_DRIVER'
    | 'DRIVER_ASSIGNED'
    | 'COMPLETED'
    | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  payablePaise: number;
  stops: FakeStop[];
  trip: { tripId: string; driverSubject: string; status: TripStatus } | null;
  cancellationReason: string | null;
}

interface Result {
  readonly status: number;
  readonly body: unknown;
}

const rank = (status: TripStatus) =>
  TRIP_SEQUENCE.indexOf(status as (typeof TRIP_SEQUENCE)[number]);

export class FakePaymentBackend {
  internalKey: string;
  private readonly configuredInternalKey: string;
  readonly customers = new Set<string>();
  readonly drivers = new Map<
    string,
    { approved: boolean; driverId: string; vehicleId: string }
  >();
  readonly quotes = new Map<string, FakeQuote>();
  readonly bookings = new Map<string, FakeBooking>();
  readonly requests: FakeRequest[] = [];
  private faults: Fault[] = [];
  private readonly sockets = new Set<import('node:net').Socket>();

  private constructor(
    private readonly server: Server,
    readonly url: string,
    internalKey: string,
  ) {
    this.internalKey = internalKey;
    this.configuredInternalKey = internalKey;
  }

  static async start(internalKey: string): Promise<FakePaymentBackend> {
    let instance: FakePaymentBackend | null = null;
    const server = createServer((request, response) => {
      void instance?.handle(request, response);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    instance = new FakePaymentBackend(
      server,
      `http://127.0.0.1:${port}`,
      internalKey,
    );
    const created = instance;
    server.on('connection', (socket) => {
      created.sockets.add(socket);
      socket.on('close', () => created.sockets.delete(socket));
    });
    return created;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset(): void {
    this.internalKey = this.configuredInternalKey;
    this.customers.clear();
    this.drivers.clear();
    this.quotes.clear();
    this.bookings.clear();
    this.requests.length = 0;
    this.faults = [];
  }

  // ──── fixtures ────

  addCustomer(subject: string): void {
    this.customers.add(subject);
  }

  addDriver(subject: string, approved = true): void {
    const existing = this.drivers.get(subject);
    this.drivers.set(subject, {
      approved,
      driverId: existing?.driverId ?? randomUUID(),
      vehicleId: existing?.vehicleId ?? randomUUID(),
    });
  }

  /** Models an administrative suspension/revocation without changing an active engine trip. */
  setDriverEligibility(subject: string, eligible: boolean): void {
    const driver = this.drivers.get(subject);
    if (!driver) {
      throw new Error(`driver ${subject} is not provisioned`);
    }
    driver.approved = eligible;
  }

  createQuote(input: {
    customerSubject: string;
    drops?: number;
    payablePerDropPaise?: number;
    expiresInSeconds?: number;
  }): FakeQuote {
    const count = input.drops ?? 1;
    const perDrop = input.payablePerDropPaise ?? 25_000;
    const drops = Array.from({ length: count }, (_, index) => ({
      sequence: index + 1,
      latitude: 26.2967 + (index + 1) * 0.01,
      longitude: 73.0351 + (index + 1) * 0.01,
      distanceMeters: 1_500 + index * 100,
      payablePaise: perDrop + index * 100,
    }));
    const quote: FakeQuote = {
      quoteId: randomUUID(),
      customerSubject: input.customerSubject,
      vehicleCategory: 'MINI_TRUCK',
      weightKg: 12.5,
      pickup: { latitude: 26.2967, longitude: 73.0351 },
      drops,
      payablePaise: drops.reduce((sum, drop) => sum + drop.payablePaise, 0),
      distanceMeters: drops.reduce((sum, drop) => sum + drop.distanceMeters, 0),
      expiresAt: new Date(Date.now() + (input.expiresInSeconds ?? 600) * 1000),
      redeemed: false,
    };
    this.quotes.set(quote.quoteId, quote);
    return quote;
  }

  // ──── money, learned by the backend on its own (collections), never from the engine ────

  /** PAY_AT_PICKUP: the whole booking is paid at the pickup (cash or QR). */
  payBooking(bookingId: string): void {
    const booking = this.require(bookingId);
    booking.paymentStatus = 'PAID';
  }

  /** PAY_AT_DELIVERY: the current drop is paid. */
  payStop(bookingId: string, sequence: number): void {
    const booking = this.require(bookingId);
    const stop = booking.stops.find(
      (candidate) => candidate.sequence === sequence,
    );
    if (!stop) {
      throw new Error(`no stop ${sequence}`);
    }
    stop.paid = true;
    if (stop.status === 'ARRIVED') {
      stop.status = 'PAYMENT_CONFIRMED';
    }
    booking.paymentStatus = booking.stops.every((candidate) => candidate.paid)
      ? 'PAID'
      : 'PARTIALLY_PAID';
  }

  /** An admin's resolution of a failed drop (POST /v1/admin/bookings/:id/stops/:seq/resolve). */
  resolveStop(
    bookingId: string,
    sequence: number,
    resolution: 'RETRY' | 'UNDELIVERED',
  ): void {
    const booking = this.require(bookingId);
    const stop = booking.stops.find(
      (candidate) => candidate.sequence === sequence,
    );
    if (!stop || stop.status !== 'DELIVERY_FAILED') {
      throw new Error('resolveStop needs a failed drop');
    }
    if (resolution === 'UNDELIVERED') {
      stop.status = 'UNDELIVERED';
    } else {
      stop.status =
        booking.paymentMethod === 'PAY_AT_DELIVERY' && stop.paid
          ? 'PAYMENT_CONFIRMED'
          : 'ARRIVED';
    }
    this.advanceTrip(booking);
  }

  // ──── inspection ────

  bookingByRef(externalRef: string): FakeBooking | undefined {
    return [...this.bookings.values()].find(
      (booking) => booking.externalRef === externalRef,
    );
  }

  calls(pattern: RegExp, method = 'POST'): FakeRequest[] {
    return this.requests.filter(
      (request) => request.method === method && pattern.test(request.path),
    );
  }

  // ──── faults ────

  fail(fault: Omit<Fault, 'times'> & { times?: number }): void {
    this.faults.push({ ...fault, times: fault.times ?? 1 });
  }

  clearFaults(): void {
    this.faults = [];
  }

  // ──── HTTP ────

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const raw = await new Promise<string>((resolve) => {
      let data = '';
      request.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf8');
      });
      request.on('end', () => resolve(data));
    });
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    const header = request.headers['x-request-id'];
    const entry: FakeRequest = {
      method: request.method ?? 'GET',
      path,
      body,
      requestId: typeof header === 'string' ? header : undefined,
      status: 0,
    };
    this.requests.push(entry);

    if (request.headers['x-internal-api-key'] !== this.internalKey) {
      entry.status = 401;
      return send(
        response,
        401,
        error('INTERNAL_AUTH_INVALID', 'Invalid internal API key'),
      );
    }
    const fault = this.faults.find(
      (candidate) => candidate.times > 0 && candidate.match(entry),
    );
    if (fault) {
      fault.times -= 1;
    }
    switch (fault?.mode) {
      case 'STATUS_503':
        entry.status = 503;
        return send(
          response,
          503,
          error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable'),
        );
      case 'TIMEOUT':
        entry.status = -2;
        setTimeout(() => {
          if (!response.writableEnded && !request.socket.destroyed) {
            send(response, 503, error('SERVICE_UNAVAILABLE', 'late'));
          }
        }, 3_000).unref();
        return;
      case 'REFUSE': {
        const refusal = fault.refusal ?? { status: 409, code: 'CONFLICT' };
        entry.status = refusal.status;
        return send(
          response,
          refusal.status,
          error(refusal.code, refusal.message ?? 'refused', refusal.details),
        );
      }
      default:
        break;
    }
    const result = this.route(entry.method, path, body);
    if (fault?.mode === 'DROP_AFTER_APPLY') {
      entry.status = -1;
      request.socket.destroy();
      return;
    }
    entry.status = result.status;
    if (fault?.mode === 'DELAY') {
      fault.onApplied?.();
      setTimeout(
        () => send(response, result.status, result.body),
        fault.delayMs ?? 500,
      ).unref();
      return;
    }
    send(response, result.status, result.body);
  }

  /** Every request the engine sent for one outbox record (request ids eng-ob-<id>-<attempt>). */
  callsForOutbox(outboxId: bigint): FakeRequest[] {
    const prefix = `eng-ob-${outboxId.toString()}-`;
    return this.requests.filter((request) =>
      request.requestId?.startsWith(prefix),
    );
  }

  private route(
    method: string,
    path: string,
    body: Record<string, unknown> | null,
  ): Result {
    let match: RegExpExecArray | null;
    if (
      method === 'GET' &&
      (match = /^\/v1\/internal\/drivers\/by-subject\/([^/]+)\/eligibility$/.exec(path))
    ) {
      let subject: string;
      try {
        subject = decodeURIComponent(match[1] ?? '');
      } catch {
        return notFound('DRIVER_NOT_FOUND', 'Driver not found');
      }
      const driver = this.drivers.get(subject);
      if (!driver) {
        return notFound('DRIVER_NOT_FOUND', 'Driver not found');
      }
      return ok({
        driverId: driver.driverId,
        subject,
        eligible: driver.approved,
        reasons: driver.approved ? [] : ['DRIVER_NOT_APPROVED'],
        vehicleId: driver.approved ? driver.vehicleId : null,
        checkedAt: new Date().toISOString(),
      });
    }
    if (
      method === 'GET' &&
      (match = /^\/v1\/internal\/fare-quotes\/([^/]+)$/.exec(path))
    ) {
      const quote = this.quotes.get(match[1] ?? '');
      return quote
        ? ok(quoteView(quote))
        : notFound('QUOTE_NOT_FOUND', 'Fare quote not found');
    }
    if (method === 'POST' && path === '/v1/internal/bookings') {
      return this.register(body ?? {});
    }
    if (
      method === 'GET' &&
      (match = /^\/v1\/internal\/bookings\/([^/]+)$/.exec(path))
    ) {
      const booking = this.bookings.get(match[1] ?? '');
      return booking
        ? ok(this.view(booking))
        : notFound('BOOKING_NOT_FOUND', 'Booking not found');
    }
    if (
      method === 'POST' &&
      (match =
        /^\/v1\/internal\/bookings\/([^/]+)\/(searching|assign|cancel)$/.exec(
          path,
        ))
    ) {
      const booking = this.bookings.get(match[1] ?? '');
      if (!booking) {
        return notFound('BOOKING_NOT_FOUND', 'Booking not found');
      }
      switch (match[2]) {
        case 'searching':
          return this.searching(booking);
        case 'assign':
          return this.assign(booking, body ?? {});
        default:
          return this.cancel(booking, body ?? {});
      }
    }
    if (
      method === 'POST' &&
      (match = /^\/v1\/internal\/trips\/([^/]+)\/status$/.exec(path))
    ) {
      return this.tripStatus(match[1] ?? '', body ?? {});
    }
    if (
      method === 'POST' &&
      (match = /^\/v1\/internal\/trips\/([^/]+)\/stops\/(\d+)\/status$/.exec(
        path,
      ))
    ) {
      return this.stopStatus(match[1] ?? '', Number(match[2]), body ?? {});
    }
    return notFound('NOT_FOUND', 'Resource not found');
  }

  private register(body: Record<string, unknown>): Result {
    const allowed = new Set([
      'externalRef',
      'customerSubject',
      'quoteId',
      'paymentMethod',
    ]);
    const unknown = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      return refused(400, 'VALIDATION_FAILED', 'Request validation failed', {
        fields: unknown,
      });
    }
    const { externalRef, customerSubject, quoteId, paymentMethod } =
      body as Record<string, string>;
    if (paymentMethod === 'PREPAID_UPI') {
      return refused(
        422,
        'PAYMENT_METHOD_NOT_OFFERED',
        'Payment method not offered',
      );
    }
    if (!this.customers.has(customerSubject ?? '')) {
      return refused(422, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    const existing = this.bookingByRef(externalRef ?? '');
    if (existing) {
      const same =
        existing.quoteId === quoteId &&
        existing.paymentMethod === paymentMethod &&
        existing.customerSubject === customerSubject;
      return same
        ? ok(this.view(existing))
        : refused(
            409,
            'BOOKING_REF_CONFLICT',
            'externalRef is registered with other terms',
          );
    }
    const quote = this.quotes.get(quoteId ?? '');
    if (!quote || quote.customerSubject !== customerSubject) {
      return refused(422, 'QUOTE_NOT_FOUND', 'Fare quote not found');
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      return refused(409, 'QUOTE_EXPIRED', 'The fare quote has expired');
    }
    if (quote.redeemed) {
      return refused(
        409,
        'QUOTE_ALREADY_USED',
        'The fare quote was already used',
      );
    }
    quote.redeemed = true;
    const booking: FakeBooking = {
      bookingId: randomUUID(),
      externalRef: externalRef ?? '',
      customerSubject: customerSubject ?? '',
      quoteId: quote.quoteId,
      paymentMethod: paymentMethod as FakeBooking['paymentMethod'],
      status: 'CREATED',
      paymentStatus: 'UNPAID',
      payablePaise: quote.payablePaise,
      stops: quote.drops.map((drop) => ({
        sequence: drop.sequence,
        payablePaise: drop.payablePaise,
        status: 'PENDING' as const,
        paid: false,
        failedAt: null,
        failureReason: null,
      })),
      trip: null,
      cancellationReason: null,
    };
    this.bookings.set(booking.bookingId, booking);
    return { status: 201, body: this.view(booking) };
  }

  private searching(booking: FakeBooking): Result {
    if (
      booking.status === 'SEARCHING_DRIVER' ||
      booking.status === 'DRIVER_ASSIGNED'
    ) {
      return ok(this.view(booking));
    }
    if (booking.status !== 'CREATED') {
      return closed(booking);
    }
    booking.status = 'SEARCHING_DRIVER';
    return ok(this.view(booking));
  }

  private assign(booking: FakeBooking, body: Record<string, unknown>): Result {
    const driverSubject = text(body['driverSubject']);
    const driver = this.drivers.get(driverSubject);
    if (!driver) {
      return refused(422, 'DRIVER_NOT_FOUND', 'Driver not found');
    }
    if (!driver.approved) {
      return refused(
        422,
        'DRIVER_NOT_APPROVED',
        'Only approved drivers can be assigned',
      );
    }
    if (booking.trip) {
      return booking.trip.driverSubject === driverSubject
        ? ok(this.view(booking))
        : refused(
            409,
            'TRIP_ALREADY_ASSIGNED',
            'This booking is already assigned to another driver',
          );
    }
    if (booking.status !== 'CREATED' && booking.status !== 'SEARCHING_DRIVER') {
      return closed(booking);
    }
    booking.trip = {
      tripId: randomUUID(),
      driverSubject,
      status: 'DRIVER_ASSIGNED',
    };
    booking.status = 'DRIVER_ASSIGNED';
    return ok(this.view(booking));
  }

  private cancel(booking: FakeBooking, body: Record<string, unknown>): Result {
    const reason =
      typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (reason.length < 3 || reason.length > 200) {
      return refused(400, 'VALIDATION_FAILED', 'Request validation failed');
    }
    if (booking.status === 'CANCELLED') {
      return ok(this.view(booking));
    }
    if (booking.status === 'COMPLETED') {
      return closed(booking);
    }
    if (booking.trip && booking.trip.status !== 'COMPLETED') {
      booking.trip.status = 'CANCELLED';
    }
    booking.status = 'CANCELLED';
    booking.cancellationReason = reason;
    for (const stop of booking.stops) {
      if (!FINAL_STOPS.has(stop.status)) {
        stop.status = 'CANCELLED';
      }
    }
    return ok(this.view(booking));
  }

  private tripStatus(tripId: string, body: Record<string, unknown>): Result {
    const requested = text(body['status']);
    if (
      !ENGINE_TRIP_STATUSES.includes(requested) ||
      Object.keys(body).length !== 1
    ) {
      return refused(400, 'VALIDATION_FAILED', 'Request validation failed');
    }
    const booking = [...this.bookings.values()].find(
      (candidate) => candidate.trip?.tripId === tripId,
    );
    const trip = booking?.trip;
    if (!booking || !trip) {
      return notFound('TRIP_NOT_FOUND', 'Trip not found');
    }
    const wanted = requested as TripStatus;
    if (trip.status === 'CANCELLED') {
      return refused(
        409,
        'INVALID_TRIP_TRANSITION',
        `A trip cannot move from CANCELLED to ${wanted}`,
      );
    }
    if (rank(wanted) <= rank(trip.status)) {
      return ok(this.view(booking)); // repeat: no-op
    }
    if (wanted === 'COMPLETED') {
      if (trip.status === 'DELIVERED' && booking.paymentStatus !== 'UNPAID') {
        trip.status = 'PAYMENT_CONFIRMED';
      }
      if (trip.status !== 'PAYMENT_CONFIRMED') {
        return booking.paymentStatus === 'UNPAID'
          ? refused(
              409,
              'PAYMENT_REQUIRED',
              'The trip cannot be completed before the payment is confirmed',
              {
                tripStatus: trip.status,
              },
            )
          : refused(
              409,
              'INVALID_TRIP_TRANSITION',
              `A trip cannot move from ${trip.status} to COMPLETED`,
            );
      }
      trip.status = 'COMPLETED';
      booking.status = 'COMPLETED';
      return ok(this.view(booking));
    }
    const paid = booking.paymentStatus !== 'UNPAID';
    if (booking.paymentMethod === 'PAY_AT_PICKUP' && !paid) {
      const heldAt =
        trip.status === 'DRIVER_ARRIVED' || trip.status === 'PICKUP_VERIFIED';
      if (heldAt && rank(wanted) > rank(trip.status)) {
        return refused(
          409,
          'PAYMENT_REQUIRED',
          'Payment is required before the pickup handover',
          {
            stage: 'PICKUP',
            amountPaise: booking.payablePaise,
            tripStatus: trip.status,
          },
        );
      }
    }
    if (wanted === 'DROP_PROGRESS') {
      return refused(409, 'STOP_REQUIRED', 'Report each drop', {
        tripStatus: trip.status,
      });
    }
    if (wanted === 'DELIVERED') {
      const pending = booking.stops
        .filter((stop) => !FINAL_STOPS.has(stop.status))
        .map((stop) => stop.sequence);
      if (pending.length > 0) {
        return refused(409, 'STOPS_PENDING', 'Every drop must be finished', {
          pendingStops: pending,
        });
      }
    }
    const next = TRIP_SEQUENCE[rank(trip.status) + 1];
    if (next !== wanted) {
      return refused(
        409,
        'INVALID_TRIP_TRANSITION',
        `A trip cannot move from ${trip.status} to ${wanted}`,
        {
          from: trip.status,
          to: wanted,
        },
      );
    }
    trip.status = wanted;
    return ok(this.view(booking));
  }

  private stopStatus(
    tripId: string,
    sequence: number,
    body: Record<string, unknown>,
  ): Result {
    const requested = text(body['status']);
    const failure = requested === 'DELIVERY_FAILED';
    const reason =
      typeof body['reason'] === 'string' ? body['reason'].trim() : undefined;
    if (
      !['ARRIVED', 'DELIVERED', 'DELIVERY_FAILED'].includes(requested) ||
      failure !== (reason !== undefined)
    ) {
      return refused(400, 'VALIDATION_FAILED', 'Request validation failed');
    }
    const booking = [...this.bookings.values()].find(
      (candidate) => candidate.trip?.tripId === tripId,
    );
    const trip = booking?.trip;
    if (!booking || !trip) {
      return notFound('TRIP_NOT_FOUND', 'Trip not found');
    }
    const stop = booking.stops.find(
      (candidate) => candidate.sequence === sequence,
    );
    if (!stop) {
      return notFound('STOP_NOT_FOUND', 'Stop not found');
    }
    const closedBooking =
      booking.status === 'CANCELLED' || booking.status === 'COMPLETED';
    const underWay =
      trip.status === 'IN_TRANSIT' || trip.status === 'DROP_PROGRESS';
    const invalid = (why: string) =>
      refused(
        409,
        'INVALID_STOP_TRANSITION',
        `Stop ${sequence} cannot move to ${requested}`,
        {
          from: stop.status,
          to: requested,
          tripStatus: trip.status,
          reason: why,
        },
      );
    if (stop.status === 'CANCELLED') {
      return closed(booking);
    }
    switch (requested) {
      case 'ARRIVED': {
        if (stop.status !== 'PENDING' && stop.status !== 'DELIVERY_FAILED') {
          return ok(this.view(booking)); // already reached
        }
        if (closedBooking) {
          return closed(booking);
        }
        if (!underWay) {
          return invalid('TRIP_NOT_UNDER_WAY');
        }
        const blocked = booking.stops.some(
          (other) =>
            other.sequence !== sequence &&
            ((stop.status === 'PENDING' &&
              other.sequence < sequence &&
              !FINAL_STOPS.has(other.status)) ||
              CURRENT_STOPS.has(other.status)),
        );
        if (blocked) {
          return invalid('OUT_OF_ORDER');
        }
        stop.status =
          stop.status === 'DELIVERY_FAILED' &&
          booking.paymentMethod === 'PAY_AT_DELIVERY' &&
          stop.paid
            ? 'PAYMENT_CONFIRMED'
            : 'ARRIVED';
        break;
      }
      case 'DELIVERED': {
        if (stop.status === 'DELIVERED') {
          return ok(this.view(booking));
        }
        if (stop.status !== 'ARRIVED' && stop.status !== 'PAYMENT_CONFIRMED') {
          return invalid('INVALID_TRANSITION');
        }
        if (closedBooking) {
          return closed(booking);
        }
        const allowed =
          booking.paymentMethod === 'PAY_AT_PICKUP'
            ? stop.status === 'ARRIVED' && booking.paymentStatus !== 'UNPAID'
            : stop.status === 'PAYMENT_CONFIRMED' && stop.paid;
        if (!allowed) {
          return refused(
            409,
            'PAYMENT_REQUIRED',
            'Payment is required before this drop is handed over',
            {
              stage: 'DROP',
              stopSequence: sequence,
              amountPaise: stop.payablePaise,
            },
          );
        }
        stop.status = 'DELIVERED';
        break;
      }
      default: {
        if (
          stop.status === 'DELIVERY_FAILED' ||
          stop.status === 'UNDELIVERED'
        ) {
          return ok(this.view(booking));
        }
        if (stop.status !== 'ARRIVED' && stop.status !== 'PAYMENT_CONFIRMED') {
          return invalid('INVALID_TRANSITION');
        }
        if (closedBooking) {
          return closed(booking);
        }
        stop.status = 'DELIVERY_FAILED';
        stop.failedAt = new Date();
        stop.failureReason = reason ?? null;
      }
    }
    this.advanceTrip(booking);
    return ok(this.view(booking));
  }

  /** The trip follows its drops (tripAdvanceAfterStops), then the payment confirms delivery. */
  private advanceTrip(booking: FakeBooking): void {
    const trip = booking.trip;
    if (!trip) {
      return;
    }
    if (
      trip.status === 'IN_TRANSIT' &&
      booking.stops.some((stop) => stop.status !== 'PENDING')
    ) {
      trip.status = 'DROP_PROGRESS';
    }
    if (
      trip.status === 'DROP_PROGRESS' &&
      booking.stops.every((stop) => FINAL_STOPS.has(stop.status))
    ) {
      trip.status = 'DELIVERED';
      if (booking.paymentStatus !== 'UNPAID') {
        trip.status = 'PAYMENT_CONFIRMED';
      }
    }
  }

  private view(booking: FakeBooking) {
    return {
      bookingId: booking.bookingId,
      externalRef: booking.externalRef,
      status: booking.status,
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus,
      paidWith: null,
      paymentModel: 'QUOTE_PER_STOP',
      quoteId: booking.quoteId,
      pricingVersionId: 'f3e1c1de-0000-4000-8000-000000000001',
      farePaise: booking.payablePaise,
      taxPaise: 0,
      payablePaise: booking.payablePaise,
      platformFeePaise: Math.round(booking.payablePaise / 10),
      stops: booking.stops.map((stop) => ({
        sequence: stop.sequence,
        payablePaise: stop.payablePaise,
        status: stop.status,
      })),
      paymentGate: gateOf(booking),
      vehicleCategory: 'MINI_TRUCK',
      feeRuleId: 'f3e1c1de-0000-4000-8000-000000000002',
      confirmedAt: new Date().toISOString(),
      completedAt: null,
      cancelledAt: null,
      cancellationReason: booking.cancellationReason,
      trip: booking.trip
        ? {
            tripId: booking.trip.tripId,
            bookingId: booking.bookingId,
            driverId: `driver-${booking.trip.driverSubject}`,
            status: booking.trip.status,
          }
        : null,
    };
  }

  private require(bookingId: string): FakeBooking {
    const booking = this.bookings.get(bookingId);
    if (!booking) {
      throw new Error(`no booking ${bookingId}`);
    }
    return booking;
  }
}

/** The payment backend's paymentGate (payment-gate.ts), for bookings priced per drop. */
function gateOf(booking: FakeBooking) {
  const tripStatus = booking.trip?.status ?? null;
  const atPickup =
    tripStatus === null ||
    tripStatus === 'DRIVER_ASSIGNED' ||
    tripStatus === 'DRIVER_ARRIVED';
  const underWay =
    tripStatus === 'IN_TRANSIT' || tripStatus === 'DROP_PROGRESS';
  const nothing = {
    stage: null,
    stopSequence: null,
    paymentState: 'NOT_REQUIRED',
    amountPaise: null,
    cashFeePaise: null,
    handoverAllowed: false,
    collectionId: null,
    lastFailure: null,
  };
  const ordered = [...booking.stops].sort((a, b) => a.sequence - b.sequence);
  const focus =
    ordered.find((stop) => CURRENT_STOPS.has(stop.status)) ??
    ordered.find((stop) => !FINAL_STOPS.has(stop.status));
  if (booking.paymentMethod === 'PAY_AT_PICKUP') {
    if (booking.paymentStatus !== 'UNPAID') {
      if (atPickup) {
        return {
          ...nothing,
          stage: 'PICKUP',
          paymentState: 'PAYMENT_CONFIRMED',
          amountPaise: booking.payablePaise,
          handoverAllowed: tripStatus === 'DRIVER_ARRIVED',
        };
      }
      if (!underWay) {
        return nothing;
      }
      return {
        ...nothing,
        stage: 'DROP',
        stopSequence: focus?.sequence ?? null,
        handoverAllowed: focus?.status === 'ARRIVED',
      };
    }
    return {
      ...nothing,
      stage: 'PICKUP',
      paymentState:
        atPickup && tripStatus !== 'DRIVER_ARRIVED'
          ? 'NOT_YET'
          : 'PAYMENT_REQUIRED',
      amountPaise: booking.payablePaise,
      handoverAllowed: false,
    };
  }
  if (atPickup) {
    return {
      ...nothing,
      stage: 'PICKUP',
      handoverAllowed: tripStatus === 'DRIVER_ARRIVED',
    };
  }
  if (
    tripStatus === 'DELIVERED' ||
    tripStatus === 'PAYMENT_CONFIRMED' ||
    !focus
  ) {
    return nothing;
  }
  const owed = {
    ...nothing,
    stage: 'DROP',
    stopSequence: focus.sequence,
    amountPaise: focus.payablePaise,
  };
  switch (focus.status) {
    case 'ARRIVED':
      return {
        ...owed,
        paymentState: 'PAYMENT_REQUIRED',
        handoverAllowed: false,
      };
    case 'PAYMENT_CONFIRMED':
      return {
        ...owed,
        paymentState: 'PAYMENT_CONFIRMED',
        handoverAllowed: true,
      };
    default:
      return { ...owed, paymentState: 'NOT_YET', handoverAllowed: false };
  }
}

function quoteView(quote: FakeQuote) {
  return {
    quoteId: quote.quoteId,
    pricingVersion: {
      pricingVersionId: 'f3e1c1de-0000-4000-8000-000000000001',
      code: 'TEST-PV',
    },
    vehicleCategory: quote.vehicleCategory,
    weightKg: quote.weightKg,
    pickup: quote.pickup,
    distanceMeters: quote.distanceMeters,
    farePaise: quote.payablePaise,
    taxPaise: 0,
    payablePaise: quote.payablePaise,
    currency: 'INR',
    drops: quote.drops.map((drop) => ({
      ...drop,
      farePaise: drop.payablePaise,
      taxPaise: 0,
    })),
    expiresAt: quote.expiresAt.toISOString(),
    redeemed: quote.redeemed,
    createdAt: new Date().toISOString(),
    customerId: `customer-${quote.customerSubject}`,
  };
}

/** A body field as text ('' when missing or not a string), like the backend's validation. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function ok(body: unknown): Result {
  return { status: 200, body };
}

function error(
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return {
    error: {
      code,
      message,
      requestId: 'fake',
      ...(details ? { details } : {}),
    },
  };
}

function refused(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Result {
  return { status, body: error(code, message, details) };
}

function notFound(code: string, message: string): Result {
  return refused(404, code, message);
}

function closed(booking: FakeBooking): Result {
  return refused(409, 'BOOKING_CLOSED', 'This booking is closed', {
    status: booking.status,
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}
