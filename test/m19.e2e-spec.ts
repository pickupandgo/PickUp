import type { FakeQuote } from './helpers/fake-payment-backend';
import { call, get, goOnline, keysDeep, OTP_KEYS, post } from './helpers/flows';
import {
  createTestApp,
  resetDatabase,
  type TestContext,
} from './helpers/test-app';

/**
 * M19 E2E: multi-drop hardening, kept for Phase 8 (engine integration). Same 5-drop trip, same
 * checks, run against the persistent engine and a payment backend. Assertions changed where the
 * architecture did:
 *   - Every request is authenticated: the driver and the customer are Firebase token subjects.
 *   - The ride is the payment backend's fare quote (no route, weight or fare from the client).
 *   - "Six drops rejected": the engine no longer counts drops itself (the payment backend's
 *     FARE_MAX_DROPS bounds a quote). Drops that are not the quote's are refused with
 *     422 QUOTE_ROUTE_MISMATCH.
 *   - OTPs are never in ride or trip responses (ride.otp / ride.stopOtps are gone): the customer
 *     reads them from GET /rides/:id/otps, withheld until the payment backend allows each
 *     handover.
 *   - Pay at pickup: before the payment every pickup OTP is refused with 409 PAYMENT_REQUIRED
 *     without being checked; the wrong-OTP 400 applies once paid.
 */
describe('M19 E2E Testing - Multi-Drop Hardening', () => {
  let ctx: TestContext;
  const driverId = 'm19-driver-1';
  const customerId = 'm19-customer-1';

  let quote: FakeQuote;
  let tripId: string;
  let rideId: string;
  let paymentBookingId: string;
  let pickupOtp: string;
  let stopOtps: string[] = [];
  let stopIds: string[] = [];

  const receivers = (count: number) =>
    quote.drops.slice(0, count).map((drop, i) => ({
      latitude: drop.latitude,
      longitude: drop.longitude,
      address: `Drop ${i + 1}`,
      receiver: { name: `Receiver ${i + 1}`, phone: '1234567890' },
    }));

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    ctx.backend.addCustomer(customerId);
    ctx.backend.addDriver(driverId);
    quote = ctx.backend.createQuote({ customerSubject: customerId, drops: 5 });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('Setup: Register driver and make available', async () => {
    await goOnline(ctx, driverId);
    // Update location to ping heartbeat
    await call(ctx, 'patch', `/drivers/${driverId}/location`, driverId, {
      latitude: 26.2967,
      longitude: 73.0351,
    }).expect(200);
  });

  it('1. Six drop rejection (drops must be the 5-drop quote)', async () => {
    const res = await post(ctx, '/rides', customerId, {
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
      driverId, // The prototype currently books via direct driver ID
      drops: [...receivers(5), { address: 'Drop 6' }],
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('QUOTE_ROUTE_MISMATCH');
    expect(res.body.details).toEqual({
      kind: 'DROP_COUNT',
      expected: 5,
      received: 6,
    });
  });

  it('2. Five drop stress flow booking (Creates Ride)', async () => {
    const res = await post(ctx, '/rides', customerId, {
      quoteId: quote.quoteId,
      paymentMethod: 'PAY_AT_PICKUP',
      driverId,
      pickup: { ...quote.pickup, address: 'Pickup' },
      drops: receivers(5),
    }).expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.ride.status).toBe('REQUESTED');
    expect(res.body.ride.drops).toHaveLength(5);
    expect(keysDeep(res.body).filter((key) => OTP_KEYS.includes(key))).toEqual(
      [],
    );

    rideId = res.body.ride.id;
    paymentBookingId = res.body.ride.paymentBookingId;
    // The customer's codes stay withheld until the booking is paid at the pickup.
    const otps = await get(ctx, `/rides/${rideId}/otps`, customerId).expect(
      200,
    );
    expect(otps.body.pickup).toEqual({
      otp: null,
      withheld: 'PAYMENT_REQUIRED',
    });
    expect(otps.body.stops).toHaveLength(5);
  });

  it('3. Driver accepts ride (Creates Trip)', async () => {
    const res = await post(ctx, `/rides/${rideId}/accept`, driverId, {
      driverId,
    }).expect(201);

    expect(res.body.ride.status).toBe('ACCEPTED');

    // Now get the active trip for the driver
    const tripRes = await get(
      ctx,
      `/trips/active/driver/${driverId}`,
      driverId,
    ).expect(200);

    expect(tripRes.body.trip).toBeDefined();
    tripId = tripRes.body.trip.id;
    stopIds = tripRes.body.trip.stops.map((s: { id: string }) => s.id);
    expect(stopIds.length).toBe(5);
    expect(tripRes.body.trip.paymentTripId).toEqual(expect.any(String));
  });

  it('4. API Security: Cannot start trip before arriving', async () => {
    const res = await post(ctx, `/trips/${tripId}/start`, driverId, {
      driverId,
    });

    expect(res.status).toBe(400); // Bad Request
  });

  it('5. Driver Arrive at pickup', async () => {
    const res = await post(ctx, `/trips/${tripId}/arrive`, driverId, {
      driverId,
    }).expect(201);

    expect(res.body.tripStatus).toBe('DRIVER_ARRIVED');
  });

  it('6. Wrong pickup OTP (payment gate first)', async () => {
    // Unpaid: no OTP is checked at all.
    const unpaid = await post(
      ctx,
      `/trips/${tripId}/pickup/verify-otp`,
      driverId,
      {
        driverId,
        otp: '0000',
      },
    );
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.code).toBe('PAYMENT_REQUIRED');

    // Paid at the pickup (cash or QR, recorded by the payment backend).
    ctx.backend.payBooking(paymentBookingId);
    const otps = await get(ctx, `/rides/${rideId}/otps`, customerId).expect(
      200,
    );
    pickupOtp = otps.body.pickup.otp;
    stopOtps = otps.body.stops.map((s: { otp: string }) => s.otp);
    expect(stopOtps.every((otp) => /^\d{4}$/.test(otp))).toBe(true);

    await post(ctx, `/trips/${tripId}/pickup/verify-otp`, driverId, {
      driverId,
      otp: pickupOtp === '0000' ? '1111' : '0000', // wrong otp
    }).expect(400);
  });

  it('7. Correct pickup OTP', async () => {
    const res = await post(
      ctx,
      `/trips/${tripId}/pickup/verify-otp`,
      driverId,
      {
        driverId,
        otp: pickupOtp,
      },
    ).expect(201);

    expect(res.body.tripStatus).toBe('PICKUP_VERIFIED');
  });

  it('8. Start Trip', async () => {
    const res = await post(ctx, `/trips/${tripId}/start`, driverId, {
      driverId,
    }).expect(201);

    expect(res.body.tripStatus).toBe('IN_TRANSIT');
  });

  it('9. Wrong stop OTP at Stop 1', async () => {
    // First arrive at stop 1
    await post(ctx, `/trips/${tripId}/stop/arrive`, driverId, {
      driverId,
      stopId: stopIds[0],
    }).expect(201);

    // Try wrong OTP
    await post(ctx, `/trips/${tripId}/stop/verify-otp`, driverId, {
      driverId,
      stopId: stopIds[0],
      otp: stopOtps[0] === '9999' ? '8888' : '9999',
    }).expect(400);
  });

  it('10. Delivery without Photo fails', async () => {
    // verify OTP first
    await post(ctx, `/trips/${tripId}/stop/verify-otp`, driverId, {
      driverId,
      stopId: stopIds[0],
      otp: stopOtps[0],
    }).expect(201);

    // try to deliver without photo
    await post(ctx, `/trips/${tripId}/stop/confirm-delivery`, driverId, {
      driverId,
      stopId: stopIds[0],
    }).expect(400); // missing photo
  });

  it('11. Complete Stop 1 Delivery', async () => {
    const res = await post(
      ctx,
      `/trips/${tripId}/stop/confirm-delivery`,
      driverId,
      {
        driverId,
        stopId: stopIds[0],
        photo: { uri: 'file://fake-photo.jpg' },
      },
    ).expect(201);

    expect(res.body.completedStops).toBe(1);
    expect(res.body.currentStopIndex).toBe(1);
    expect(res.body.tripStatus).toBe('IN_TRANSIT'); // Trip goes back to IN_TRANSIT for next stop
  });

  it('12. Try to skip Stop 2 and verify Stop 3 OTP', async () => {
    // We are currently heading to Stop 2. Try to arrive at Stop 3 instead.
    const res = await post(ctx, `/trips/${tripId}/stop/arrive`, driverId, {
      driverId,
      stopId: stopIds[2],
    }); // skipping stopIds[1]

    // The engine rejects this because the current stop is Stop 2.
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Stop ID mismatch');
  });

  it('12.5 Cannot complete trip before all stops delivered', async () => {
    // Try completing early (we are only at Stop 2 right now)
    await post(ctx, `/trips/${tripId}/complete`, driverId, { driverId }).expect(
      400,
    );
  });

  it('13. Execute Stop 2 to Stop 5 sequentially', async () => {
    for (let i = 1; i < 5; i++) {
      // Arrive
      const resArrive = await post(
        ctx,
        `/trips/${tripId}/stop/arrive`,
        driverId,
        {
          driverId,
          stopId: stopIds[i],
        },
      ).expect(201);

      expect(resArrive.body.tripStatus).toBe('DROP_PROGRESS');

      // Verify OTP
      await post(ctx, `/trips/${tripId}/stop/verify-otp`, driverId, {
        driverId,
        stopId: stopIds[i],
        otp: stopOtps[i],
      }).expect(201);

      // Photo and Deliver
      const resDeliver = await post(
        ctx,
        `/trips/${tripId}/stop/confirm-delivery`,
        driverId,
        {
          driverId,
          stopId: stopIds[i],
          photo: { uri: `file://photo-${i}.jpg` },
        },
      ).expect(201);

      expect(resDeliver.body.completedStops).toBe(i + 1);

      if (i < 4) {
        expect(resDeliver.body.tripStatus).toBe('IN_TRANSIT'); // Heading to next stop
      } else {
        expect(resDeliver.body.tripStatus).toBe('DELIVERED'); // All stops delivered, waiting for trip complete
      }
    }
  });

  it('15. Complete the 5-drop Trip', async () => {
    const res = await post(ctx, `/trips/${tripId}/complete`, driverId, {
      driverId,
    }).expect(201);

    expect(res.body.tripStatus).toBe('COMPLETED');
    expect(ctx.backend.bookings.get(paymentBookingId)?.status).toBe(
      'COMPLETED',
    );
  });

  it('16. Fare and Distance Consistency', async () => {
    // Fetch the completed trip
    const res = await get(ctx, `/trips/${tripId}`, customerId).expect(200);

    const trip = res.body.trip;
    // The fare is the payment backend's quote (display copy), never an engine estimate.
    expect(trip.fare).toBe(quote.payablePaise / 100);
    expect(trip.payablePaise).toBe(quote.payablePaise);
    expect(trip.totalDistanceKm).toBe(
      Math.round(quote.distanceMeters / 100) / 10,
    );
    expect(trip.stops.length).toBe(5);

    // Validate receiver isolation and stop metadata
    expect(trip.stops[0].receiver.name).toBe('Receiver 1');
    expect(trip.stops[4].receiver.name).toBe('Receiver 5');
    expect(trip.stops[0].deliveryProof.uri).toBe('file://fake-photo.jpg');
    expect(trip.stops[4].deliveryProof.uri).toBe('file://photo-4.jpg');
    expect(
      trip.stops.map((s: { payablePaise: number }) => s.payablePaise),
    ).toEqual(quote.drops.map((d) => d.payablePaise));
  });
});
