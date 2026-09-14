import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('M19 E2E Testing - Multi-Drop Hardening', () => {
  let app: INestApplication;
  let driverId = 'm19-driver-1';
  let customerId = 'm19-customer-1';
  
  let tripId: string;
  let rideId: string;
  let pickupOtp: string;
  let stopOtps: string[] = [];
  let stopIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('Setup: Register driver and make available', async () => {
    // Create/Update driver and make available
    await request(app.getHttpServer())
      .patch(`/drivers/${driverId}/availability`)
      .send({ isAvailable: true })
      .expect(200);

    // Update location to ping heartbeat
    await request(app.getHttpServer())
      .patch(`/drivers/${driverId}/location`)
      .send({ latitude: 28.5, longitude: 77.0 })
      .expect(200);
  });

  it('1. Six drop rejection', async () => {
    const res = await request(app.getHttpServer())
      .post('/rides')
      .send({
        customerId,
        driverId, // The prototype currently books via direct driver ID
        pickup: { latitude: 28.6, longitude: 77.2, address: 'Pickup' },
        drops: Array(6).fill(0).map((_, i) => ({
          latitude: 28.7 + i * 0.01,
          longitude: 77.3 + i * 0.01,
          address: `Drop ${i + 1}`
        })),
        weight: 10
      });
      
    expect(res.status).toBe(400); // Bad Request expected
    expect(res.body.message).toContain('Maximum 5 drop locations allowed');
  });

  it('2. Five drop stress flow booking (Creates Ride)', async () => {
    const res = await request(app.getHttpServer())
      .post('/rides')
      .send({
        customerId,
        driverId,
        pickup: { latitude: 28.6, longitude: 77.2, address: 'Pickup' },
        drops: Array(5).fill(0).map((_, i) => ({
          latitude: 28.7 + i * 0.01,
          longitude: 77.3 + i * 0.01,
          address: `Drop ${i + 1}`,
          receiver: { name: `Receiver ${i + 1}`, phone: '1234567890' }
        })),
        weight: 10
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.ride.status).toBe('REQUESTED');
    
    rideId = res.body.ride.id;
    pickupOtp = res.body.ride.otp;
    stopOtps = res.body.ride.stopOtps; // The ride response has stopOtps (for customer to view)
    expect(stopOtps.length).toBe(5);
  });

  it('3. Driver accepts ride (Creates Trip)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/rides/${rideId}/accept`)
      .send({ driverId })
      .expect(201);
      
    expect(res.body.ride.status).toBe('ACCEPTED');
    
    // Now get the active trip for the driver
    const tripRes = await request(app.getHttpServer())
      .get(`/trips/active/driver/${driverId}`)
      .expect(200);
      
    expect(tripRes.body.trip).toBeDefined();
    tripId = tripRes.body.trip.id;
    stopIds = tripRes.body.trip.stops.map((s: any) => s.id);
    expect(stopIds.length).toBe(5);
  });

  it('4. API Security: Cannot start trip before arriving', async () => {
    const res = await request(app.getHttpServer())
      .post(`/trips/${tripId}/start`)
      .send({ driverId });
      
    expect(res.status).toBe(400); // Bad Request
  });

  it('5. Driver Arrive at pickup', async () => {
    const res = await request(app.getHttpServer())
      .post(`/trips/${tripId}/arrive`)
      .send({ driverId })
      .expect(201);
      
    expect(res.body.tripStatus).toBe('DRIVER_ARRIVED');
  });

  it('6. Wrong pickup OTP', async () => {
    await request(app.getHttpServer())
      .post(`/trips/${tripId}/pickup/verify-otp`)
      .send({ driverId, otp: '0000' }) // wrong otp
      .expect(400);
  });

  it('7. Correct pickup OTP', async () => {
    const res = await request(app.getHttpServer())
      .post(`/trips/${tripId}/pickup/verify-otp`)
      .send({ driverId, otp: pickupOtp })
      .expect(201);
      
    expect(res.body.tripStatus).toBe('PICKUP_VERIFIED');
  });

  it('8. Start Trip', async () => {
    const res = await request(app.getHttpServer())
      .post(`/trips/${tripId}/start`)
      .send({ driverId })
      .expect(201);
      
    expect(res.body.tripStatus).toBe('IN_TRANSIT');
  });

  it('9. Wrong stop OTP at Stop 1', async () => {
    // First arrive at stop 1
    await request(app.getHttpServer())
      .post(`/trips/${tripId}/stop/arrive`)
      .send({ driverId, stopId: stopIds[0] })
      .expect(201);

    // Try wrong OTP
    await request(app.getHttpServer())
      .post(`/trips/${tripId}/stop/verify-otp`)
      .send({ driverId, stopId: stopIds[0], otp: '9999' })
      .expect(400);
  });

  it('10. Delivery without Photo fails', async () => {
    // verify OTP first
    await request(app.getHttpServer())
      .post(`/trips/${tripId}/stop/verify-otp`)
      .send({ driverId, stopId: stopIds[0], otp: stopOtps[0] })
      .expect(201);
      
    // try to deliver without photo
    await request(app.getHttpServer())
      .post(`/trips/${tripId}/stop/confirm-delivery`)
      .send({ driverId, stopId: stopIds[0] }) // missing photo
      .expect(400);
  });

  it('11. Complete Stop 1 Delivery', async () => {
    const res = await request(app.getHttpServer())
      .post(`/trips/${tripId}/stop/confirm-delivery`)
      .send({ driverId, stopId: stopIds[0], photo: { uri: 'file://fake-photo.jpg' } })
      .expect(201);
      
    expect(res.body.completedStops).toBe(1);
    expect(res.body.currentStopIndex).toBe(1);
    expect(res.body.tripStatus).toBe('IN_TRANSIT'); // Trip goes back to IN_TRANSIT for next stop
  });

  it('12. Try to skip Stop 2 and verify Stop 3 OTP', async () => {
    // We are currently heading to Stop 2. Try to arrive at Stop 3 instead.
    const res = await request(app.getHttpServer())
      .post(`/trips/${tripId}/stop/arrive`)
      .send({ driverId, stopId: stopIds[2] }); // skipping stopIds[1]
      
    // The backend should reject this because the current stop is Stop 2.
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Stop ID mismatch');
  });

  it('12.5 Cannot complete trip before all stops delivered', async () => {
    // Try completing early (we are only at Stop 2 right now)
    await request(app.getHttpServer())
      .post(`/trips/${tripId}/complete`)
      .send({ driverId })
      .expect(400); // Cannot complete because status is not DELIVERED
  });

  it('13. Execute Stop 2 to Stop 5 sequentially', async () => {
    for (let i = 1; i < 5; i++) {
      // Arrive
      const resArrive = await request(app.getHttpServer())
        .post(`/trips/${tripId}/stop/arrive`)
        .send({ driverId, stopId: stopIds[i] })
        .expect(201);
      
      expect(resArrive.body.tripStatus).toBe('DROP_PROGRESS');

      // Verify OTP
      await request(app.getHttpServer())
        .post(`/trips/${tripId}/stop/verify-otp`)
        .send({ driverId, stopId: stopIds[i], otp: stopOtps[i] })
        .expect(201);

      // Photo and Deliver
      const resDeliver = await request(app.getHttpServer())
        .post(`/trips/${tripId}/stop/confirm-delivery`)
        .send({ driverId, stopId: stopIds[i], photo: { uri: `file://photo-${i}.jpg` } })
        .expect(201);
        
      expect(resDeliver.body.completedStops).toBe(i + 1);
      
      if (i < 4) {
        expect(resDeliver.body.tripStatus).toBe('IN_TRANSIT'); // Heading to next stop
      } else {
        expect(resDeliver.body.tripStatus).toBe('DELIVERED'); // All stops delivered, waiting for trip complete
      }
    }
  });



  it('15. Complete the 5-drop Trip', async () => {
    const res = await request(app.getHttpServer())
      .post(`/trips/${tripId}/complete`)
      .send({ driverId })
      .expect(201);
      
    expect(res.body.tripStatus).toBe('COMPLETED');
  });

  it('16. Fare and Distance Consistency', async () => {
    // Fetch the completed trip
    const res = await request(app.getHttpServer())
      .get(`/trips/${tripId}`)
      .expect(200);
      
    const trip = res.body.trip;
    expect(trip.fare).toBeDefined();
    expect(trip.totalDistanceKm).toBeDefined();
    expect(trip.stops.length).toBe(5);
    
    // Validate receiver isolation and stop metadata
    expect(trip.stops[0].receiver.name).toBe('Receiver 1');
    expect(trip.stops[4].receiver.name).toBe('Receiver 5');
    expect(trip.stops[0].deliveryProof.uri).toBe('file://fake-photo.jpg');
    expect(trip.stops[4].deliveryProof.uri).toBe('file://photo-4.jpg');
  });
});
