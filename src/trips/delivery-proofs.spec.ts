import { TripsService } from './trips.service';

const PROOF = '11111111-1111-4111-8111-111111111111';
describe('durable proof gate', () => {
  let service: TripsService, bundle: any, backend: any, outbox: any;
  beforeEach(() => {
    bundle = {
      trip: {
        id: 'trip',
        bookingId: 'booking',
        paymentTripId: 'payment-trip',
        driverSubject: 'driver',
        status: 'DROP_PROGRESS',
        currentStopIndex: 0,
      },
      booking: { customerSubject: 'customer' },
      stops: [
        { id: 'stop', sequence: 1, status: 'ARRIVED', otpVerified: true },
      ],
    };
    backend = {
      call: jest
        .fn()
        .mockResolvedValue({
          kind: 'OK',
          body: {
            proofId: PROOF,
            ready: true,
            url: 'https://private.example/read',
          },
        }),
    };
    outbox = {
      findPending: jest.fn().mockResolvedValue(null),
      enqueue: jest.fn().mockResolvedValue('command'),
    };
    service = new TripsService({} as any, outbox, backend, {} as any);
    jest.spyOn(service as any, 'loadForDriver').mockResolvedValue(bundle);
    jest
      .spyOn(service as any, 'locate')
      .mockResolvedValue({ bookingId: 'booking' });
    jest.spyOn(service as any, 'load').mockResolvedValue(bundle);
    jest
      .spyOn(service as any, 'mutate')
      .mockImplementation(async (...args: any[]) => args[2]({}, bundle));
    jest
      .spyOn(service as any, 'awaitCommand')
      .mockResolvedValue({ changed: true });
  });
  it('refuses local/public photo paths before enqueueing a delivery', async () => {
    for (const uri of [
      'file:///photo.jpg',
      'content://photo',
      'https://other.example/photo',
    ])
      await expect(
        service.confirmStopDeliveryWithProof('trip', 'driver', 'stop', { uri }),
      ).rejects.toThrow('Upload and verify');
    expect(backend.call).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
  it('preserves the current stop and verified OTP gate before upload', async () => {
    bundle.stops[0].otpVerified = false;
    await expect(
      service.initiateProof('trip', 'driver', 'stop', {
        contentType: 'image/jpeg',
        sizeBytes: 100,
      }),
    ).rejects.toThrow();
    expect(backend.call).not.toHaveBeenCalled();
  });
  it('binds storage validation to the actual assigned trip/stop and refuses unready evidence', async () => {
    backend.call.mockResolvedValue({
      kind: 'OK',
      body: { proofId: PROOF, ready: false },
    });
    await expect(
      service.confirmStopDeliveryWithProof('trip', 'driver', 'stop', {
        uri: `proof:${PROOF}`,
      }),
    ).rejects.toThrow('not been verified');
    expect(backend.call).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          paymentTripId: 'payment-trip',
          engineTripId: 'trip',
          engineStopId: 'stop',
          sequence: 1,
          subject: 'driver',
        },
      }),
    );
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
  it('stores a durable reference, never the temporary signed URL, and keeps backend-first progression', async () => {
    await service.confirmStopDeliveryWithProof('trip', 'driver', 'stop', {
      uri: `proof:${PROOF}`,
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'STOP_STATUS',
        mode: 'COMMAND',
        payload: {
          tripId: 'trip',
          sequence: 1,
          status: 'DELIVERED',
          proofUri: `proof:${PROOF}`,
        },
      }),
    );
  });
  it('reauthorizes reads and resolves evidence after a new service instance loads the persisted reference', async () => {
    bundle.stops[0].proofUri = `proof:${PROOF}`;
    await expect(
      service.readProof('trip', 'customer', 'stop'),
    ).resolves.toMatchObject({ ready: true });
    await expect(
      service.readProof('trip', 'outsider', 'stop'),
    ).rejects.toThrow();
    expect(backend.call).toHaveBeenCalledTimes(1);
  });
  it('a refused/unavailable storage service cannot enqueue delivery', async () => {
    backend.call.mockResolvedValue({ kind: 'UNAVAILABLE' });
    await expect(
      service.confirmStopDeliveryWithProof('trip', 'driver', 'stop', {
        uri: `proof:${PROOF}`,
      }),
    ).rejects.toThrow();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
