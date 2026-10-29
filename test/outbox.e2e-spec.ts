import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  acceptTrip,
  get,
  makeDue,
  outboxOf,
  people,
  post,
  type RideOptions,
  startTrip,
  storedOtps,
} from './helpers/flows';
import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';

const TRIP_STATUS = /^\/v1\/internal\/trips\/[^/]+\/status$/;
const STOP_STATUS = /^\/v1\/internal\/trips\/[^/]+\/stops\/\d+\/status$/;

/**
 * The durable outbox (review F, "Outbox rules"): written with the state it reports, delivered
 * in order per booking, one sender at a time (lease), retried with backoff until a definitive
 * answer, duplicate-safe (the backend treats repeats as no-ops, the engine applies an answer
 * once), never deleted while pending, and alerted when stuck or refused.
 */
describe('Engine outbox (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.backend.reset();
    jest.restoreAllMocks();
  });

  const arrivalRecord = async (rideId: string) =>
    (await outboxOf(ctx, rideId)).find(
      (r) =>
        r.kind === 'TRIP_STATUS' &&
        (r.payload as { status?: string }).status === 'DRIVER_ARRIVED',
    );

  it('retries with backoff: no answer keeps the record pending, never dropped, until delivered', async () => {
    const who = people('ob-retry');
    const trip = await acceptTrip(ctx, who);
    ctx.backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'STATUS_503',
    });

    const arrived = await post(
      ctx,
      `/trips/${trip.tripId}/arrive`,
      who.driver,
    ).expect(201);
    expect(arrived.body).toMatchObject({
      tripStatus: 'DRIVER_ARRIVED',
      paymentSync: 'PENDING',
    });
    const pending = await arrivalRecord(trip.rideId);
    expect(pending).toMatchObject({
      mode: 'EVENT',
      status: 'PENDING',
      attempts: 1,
      lastHttpStatus: 503,
      lastErrorCode: 'SERVICE_UNAVAILABLE',
      lockedUntil: null,
      claimId: null,
    });
    expect(pending?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: the background sender leaves it alone.
    await ctx.outbox.tick();
    expect(ctx.backend.callsForOutbox(pending!.id)).toHaveLength(1);

    await makeDue(ctx, trip.rideId);
    await ctx.outbox.tick();
    const delivered = await ctx.prisma.engineOutbox.findUniqueOrThrow({
      where: { id: pending!.id },
    });
    expect(delivered).toMatchObject({
      status: 'DELIVERED',
      attempts: 2,
      lastErrorCode: null,
    });
    expect(delivered.deliveredAt).toBeInstanceOf(Date);
    expect(
      ctx.backend.callsForOutbox(pending!.id).map((r) => r.requestId),
    ).toEqual([`eng-ob-${pending!.id}-1`, `eng-ob-${pending!.id}-2`]);
    expect(ctx.backend.bookings.get(trip.paymentBookingId)?.trip?.status).toBe(
      'DRIVER_ARRIVED',
    );
  });

  it('is duplicate-safe: a lost answer is sent again, applied once at both ends', async () => {
    const options: RideOptions = {
      ...people('ob-dup'),
      paymentMethod: 'PAY_AT_DELIVERY',
    };
    const trip = await startTrip(ctx, options);
    const stopId = trip.stopIds[0];
    await post(ctx, `/trips/${trip.tripId}/stop/arrive`, options.driver, {
      stopId,
    }).expect(201);
    ctx.backend.payStop(trip.paymentBookingId, 1);
    const otps = await storedOtps(ctx, trip.rideId);
    await post(ctx, `/trips/${trip.tripId}/stop/verify-otp`, options.driver, {
      stopId,
      otp: otps.stops[0],
    }).expect(201);
    ctx.backend.fail({
      match: (r) =>
        STOP_STATUS.test(r.path) && r.body?.['status'] === 'DELIVERED',
      mode: 'DROP_AFTER_APPLY',
    });

    // Delivered at the backend, but the engine never heard back: not committed in the engine.
    const unknown = await post(
      ctx,
      `/trips/${trip.tripId}/stop/confirm-delivery`,
      options.driver,
      {
        stopId,
        photo: { uri: 'file://proof.jpg' },
      },
    );
    expect(unknown.status).toBe(503);
    expect(
      ctx.backend.bookings.get(trip.paymentBookingId)?.stops[0]?.status,
    ).toBe('DELIVERED');
    expect(
      (await ctx.prisma.engineStop.findUniqueOrThrow({ where: { id: stopId } }))
        .status,
    ).toBe('ARRIVED');

    // The driver retries: the same record is sent again, the backend answers the repeat.
    const retried = await post(
      ctx,
      `/trips/${trip.tripId}/stop/confirm-delivery`,
      options.driver,
      {
        stopId,
        photo: { uri: 'file://proof.jpg' },
      },
    ).expect(201);
    expect(retried.body).toMatchObject({
      completedStops: 1,
      tripStatus: 'DELIVERED',
    });
    const deliveries = (await outboxOf(ctx, trip.rideId)).filter(
      (r) =>
        r.kind === 'STOP_STATUS' &&
        (r.payload as { status?: string }).status === 'DELIVERED',
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ status: 'DELIVERED', attempts: 2 });
    expect(ctx.backend.callsForOutbox(deliveries[0].id)).toHaveLength(2);
    const stop = await ctx.prisma.engineStop.findUniqueOrThrow({
      where: { id: stopId },
    });
    expect(stop).toMatchObject({
      status: 'DELIVERED',
      proofUri: 'file://proof.jpg',
    });
  });

  it('delivers in order per booking: a failing head holds back everything after it', async () => {
    const options: RideOptions = {
      ...people('ob-fifo'),
      paymentMethod: 'PAY_AT_DELIVERY',
      drops: 2,
    };
    const trip = await startTrip(ctx, options);
    const stopId = trip.stopIds[0];
    ctx.backend.fail({
      match: (r) => STOP_STATUS.test(r.path),
      mode: 'STATUS_503',
      times: 3,
    });

    await post(ctx, `/trips/${trip.tripId}/stop/arrive`, options.driver, {
      stopId,
    }).expect(201);
    await post(ctx, `/trips/${trip.tripId}/stop/fail`, options.driver, {
      stopId,
      reason: 'Nobody home',
    }).expect(201);
    const [arrival, failure] = (await outboxOf(ctx, trip.rideId)).slice(-2);
    expect([arrival?.status, failure?.status]).toEqual(['PENDING', 'PENDING']);
    // The failure was never sent: its arrival (the head) has no answer yet.
    expect(ctx.backend.callsForOutbox(failure.id)).toEqual([]);

    await makeDue(ctx, trip.rideId);
    await ctx.outbox.tick();
    expect(ctx.backend.callsForOutbox(failure.id)).toEqual([]);

    await makeDue(ctx, trip.rideId);
    await ctx.outbox.tick();
    await makeDue(ctx, trip.rideId);
    await ctx.outbox.tick();
    const statuses = (await outboxOf(ctx, trip.rideId))
      .slice(-2)
      .map((r) => r.status);
    expect(statuses).toEqual(['DELIVERED', 'DELIVERED']);
    const accepted = ctx.backend
      .calls(STOP_STATUS)
      .filter((r) => r.status === 200)
      .map((r) => r.body?.['status']);
    expect(accepted).toEqual(['ARRIVED', 'DELIVERY_FAILED']);
    expect(
      ctx.backend.bookings.get(trip.paymentBookingId)?.stops[0]?.status,
    ).toBe('DELIVERY_FAILED');
  });

  it('sends each record once when several senders run at the same time', async () => {
    // Dispatch is engine-selected, so accept sequentially: each assigned driver is removed from
    // presence before the next booking chooses a different eligible driver.
    const rides = [] as Array<{
      who: ReturnType<typeof people>;
      trip: Awaited<ReturnType<typeof acceptTrip>>;
    }>;
    for (const index of [0, 1, 2]) {
      const who = people(`ob-race-${index}`);
      rides.push({ who, trip: await acceptTrip(ctx, who) });
    }
    ctx.backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'STATUS_503',
      times: 3,
    });
    for (const { who, trip } of rides) {
      await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
      await makeDue(ctx, trip.rideId);
    }
    ctx.backend.requests.length = 0;

    await Promise.all([
      ctx.outbox.dispatchDue(),
      ctx.outbox.dispatchDue(),
      ...rides.map(({ trip }) => ctx.outbox.flushBooking(trip.rideId)),
      ...rides.map(({ trip }) => ctx.outbox.flushBooking(trip.rideId)),
    ]);

    for (const { trip } of rides) {
      const record = await arrivalRecord(trip.rideId);
      expect(record?.status).toBe('DELIVERED');
      expect(ctx.backend.callsForOutbox(record!.id)).toHaveLength(1);
    }
  });

  it('never lets a sender that lost its lease record an answer over the new owner (claim re-checked)', async () => {
    const who = people('ob-lease');
    const trip = await acceptTrip(ctx, who);
    ctx.backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'STATUS_503',
    });
    await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
    const record = await arrivalRecord(trip.rideId);
    await makeDue(ctx, trip.rideId);

    // Sender A: its request reaches the backend, the answer (200) comes back late.
    let reachedBackend!: () => void;
    const applied = new Promise<void>((resolve) => {
      reachedBackend = resolve;
    });
    ctx.backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'DELAY',
      delayMs: 600,
      onApplied: () => reachedBackend(),
    });
    // Sender B, after A's lease expired, gets a definitive (synthetic) refusal.
    ctx.backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'REFUSE',
      refusal: { status: 409, code: 'INVALID_TRIP_TRANSITION' },
    });
    const senderA = ctx.outbox.tick();
    await applied;
    await ctx.prisma.engineOutbox.update({
      where: { id: record!.id },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });
    await ctx.outbox.flushBooking(trip.rideId);
    await senderA;

    const final = await ctx.prisma.engineOutbox.findUniqueOrThrow({
      where: { id: record!.id },
    });
    // B's answer stands; A's late 200 changed nothing.
    expect(final).toMatchObject({
      status: 'REFUSED',
      lastHttpStatus: 409,
      lastErrorCode: 'INVALID_TRIP_TRANSITION',
      deliveredAt: null,
    });
    expect(ctx.backend.callsForOutbox(record!.id)).toHaveLength(3);
  });

  it('recovers a record whose sender crashed while holding it (the lease expires, it is sent again)', async () => {
    const who = people('ob-crash');
    const trip = await acceptTrip(ctx, who);
    ctx.backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'STATUS_503',
    });
    await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
    const record = await arrivalRecord(trip.rideId);
    // A sender claimed it and died before recording any answer.
    await ctx.prisma.engineOutbox.update({
      where: { id: record!.id },
      data: {
        claimId: randomUUID(),
        lockedUntil: new Date(Date.now() + 60_000),
        nextAttemptAt: new Date(Date.now() - 1_000),
      },
    });

    await ctx.outbox.tick();
    expect(ctx.backend.callsForOutbox(record!.id)).toHaveLength(1);
    expect(
      (
        await ctx.prisma.engineOutbox.findUniqueOrThrow({
          where: { id: record!.id },
        })
      ).status,
    ).toBe('PENDING');

    await ctx.prisma.engineOutbox.update({
      where: { id: record!.id },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });
    await ctx.outbox.tick();
    const recovered = await ctx.prisma.engineOutbox.findUniqueOrThrow({
      where: { id: record!.id },
    });
    expect(recovered).toMatchObject({
      status: 'DELIVERED',
      claimId: null,
      lockedUntil: null,
    });
    expect(ctx.backend.bookings.get(trip.paymentBookingId)?.trip?.status).toBe(
      'DRIVER_ARRIVED',
    );
  });

  it('alerts when a record stays without an answer, and keeps retrying', async () => {
    const who = people('ob-stuck');
    const trip = await acceptTrip(ctx, who);
    const alerts = jest.spyOn(Logger.prototype, 'error');
    ctx.backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'STATUS_503',
      times: 10,
    });
    await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      await makeDue(ctx, trip.rideId);
      await ctx.outbox.tick();
    }
    const record = await arrivalRecord(trip.rideId);
    expect(record).toMatchObject({ status: 'PENDING', attempts: 3 });
    expect(record?.alertedAt).toBeInstanceOf(Date);
    expect(alerts).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: 'ENGINE_OUTBOX_STUCK',
        attempts: 3,
        outboxId: record!.id.toString(),
      }),
    );
  });

  it('records and alerts a refused event, and the queue moves on', async () => {
    const options: RideOptions = {
      ...people('ob-refused'),
      paymentMethod: 'PAY_AT_DELIVERY',
      drops: 2,
    };
    const trip = await startTrip(ctx, options);
    const alerts = jest.spyOn(Logger.prototype, 'error');
    ctx.backend.fail({
      match: (r) => STOP_STATUS.test(r.path),
      mode: 'REFUSE',
      refusal: { status: 409, code: 'INVALID_STOP_TRANSITION' },
    });
    const arrived = await post(
      ctx,
      `/trips/${trip.tripId}/stop/arrive`,
      options.driver,
      {
        stopId: trip.stopIds[0],
      },
    ).expect(201);
    expect(arrived.body.paymentSync).toBe('REFUSED');
    expect(alerts).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: 'ENGINE_OUTBOX_REFUSED',
        kind: 'STOP_STATUS',
        code: 'INVALID_STOP_TRANSITION',
      }),
    );
    const record = (await outboxOf(ctx, trip.rideId)).at(-1);
    expect(record).toMatchObject({
      status: 'REFUSED',
      lastErrorCode: 'INVALID_STOP_TRANSITION',
    });
    expect(record?.alertedAt).toBeInstanceOf(Date);

    // Not blocking: the next report goes out.
    await post(ctx, `/trips/${trip.tripId}/stop/fail`, options.driver, {
      stopId: trip.stopIds[0],
      reason: 'Receiver refused it',
    }).expect(201);
    expect((await outboxOf(ctx, trip.rideId)).at(-1)?.status).not.toBe(
      'PENDING',
    );
  });

  it('never deletes a pending record (database guard)', async () => {
    const who = people('ob-guard');
    const trip = await acceptTrip(ctx, who);
    ctx.backend.fail({
      match: (r) => TRIP_STATUS.test(r.path),
      mode: 'STATUS_503',
    });
    await post(ctx, `/trips/${trip.tripId}/arrive`, who.driver).expect(201);

    await expect(
      ctx.prisma
        .$executeRaw`DELETE FROM engine_outbox WHERE status = 'PENDING'::engine_outbox_status`,
    ).rejects.toThrow(/never deleted/);
    expect(
      await ctx.prisma.engineOutbox.count({ where: { status: 'PENDING' } }),
    ).toBe(1);
  });

  it('stores only identities, statuses and reasons: never an amount', async () => {
    const options: RideOptions = {
      ...people('ob-payloads'),
      paymentMethod: 'PAY_AT_DELIVERY',
      drops: 2,
    };
    const trip = await startTrip(ctx, options);
    await post(ctx, `/trips/${trip.tripId}/stop/arrive`, options.driver, {
      stopId: trip.stopIds[0],
    }).expect(201);
    await post(ctx, `/trips/${trip.tripId}/stop/fail`, options.driver, {
      stopId: trip.stopIds[0],
      reason: 'Closed for lunch',
    }).expect(201);
    const allowed = new Set([
      'tripId',
      'driverSubject',
      'status',
      'sequence',
      'reason',
      'proofUri',
      'cancelledBy',
    ]);
    for (const record of await ctx.prisma.engineOutbox.findMany()) {
      expect(
        Object.keys(record.payload as object).filter(
          (key) => !allowed.has(key),
        ),
      ).toEqual([]);
    }
    const view = await get(ctx, `/trips/${trip.tripId}`, options.driver).expect(
      200,
    );
    expect(view.body.trip.paymentTripId).toBe(trip.paymentTripId);
  });
});
