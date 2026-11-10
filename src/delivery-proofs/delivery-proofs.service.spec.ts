import { DeliveryProofsService } from './delivery-proofs.service';

const binding = {
  paymentTripId: 'payment-trip',
  engineTripId: 'engine-trip',
  engineStopId: 'stop',
  sequence: 1,
  subject: 'driver',
};
const row = {
  id: 'proof',
  ...binding,
  ownerSubject: 'driver',
  key: 'private/proof',
  contentType: 'image/jpeg',
  sizeBytes: 100,
  verifiedAt: null,
};
describe('private delivery evidence', () => {
  let db: any, storage: any, service: DeliveryProofsService;
  beforeEach(() => {
    db = {
      trip: { findFirst: jest.fn().mockResolvedValue({ status: 'DROP_PROGRESS' }) },
      deliveryProof: {
        findFirst: jest.fn().mockResolvedValue(row),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    storage = {
      assertInput: jest.fn(),
      assertOperational: jest.fn(),
      uploadUrl: jest.fn().mockResolvedValue({ url: 'https://storage.example/upload' }),
      verifyUpload: jest
        .fn()
        .mockResolvedValue({
          checksumSha256: 'hash',
          storageVersionId: 'version-1',
          storageETag: 'etag',
        }),
      isGuardDutyScanner: jest.fn().mockReturnValue(false),
      scan: jest.fn().mockResolvedValue('CLEAN'),
      assertGuardDutyClean: jest.fn(),
      downloadUrl: jest.fn().mockResolvedValue('https://storage.example/temporary-read'),
    };
    service = new DeliveryProofsService(db, storage);
  });
  it('restricts initiation to the assigned active driver before signing storage access', async () => {
    db.trip.findFirst.mockResolvedValue(null);
    await expect(
      service.initiate({ ...binding, contentType: 'image/jpeg', sizeBytes: 100 }),
    ).rejects.toMatchObject({ status: 403 });
    expect(storage.uploadUrl).not.toHaveBeenCalled();
    expect(db.trip.findFirst.mock.calls[0][0].where.driver.user.authIdentities.some).toEqual({
      provider: 'firebase',
      subject: 'driver',
    });
  });
  it('issues a unique private object key and rejects unsupported or oversized photos', async () => {
    await service.initiate({ ...binding, contentType: 'image/jpeg', sizeBytes: 100 });
    expect(storage.uploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^delivery-proofs\/payment-trip\/1\//),
        contentType: 'image/jpeg',
      }),
    );
    await expect(
      service.initiate({ ...binding, contentType: 'application/pdf', sizeBytes: 100 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.initiate({ ...binding, contentType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('does not mark missing/wrong-stop or failed uploads ready', async () => {
    db.deliveryProof.findFirst.mockResolvedValueOnce(null);
    await expect(service.complete('proof', binding)).rejects.toMatchObject({ status: 404 });
    storage.verifyUpload.mockRejectedValue(new Error('missing object'));
    await expect(service.complete('proof', binding)).rejects.toThrow('missing object');
    expect(db.deliveryProof.updateMany).not.toHaveBeenCalled();
    expect(db.deliveryProof.findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        engineStopId: 'stop',
        ownerSubject: 'driver',
        paymentTripId: 'payment-trip',
      }),
    );
  });
  it('requires a clean scan of the same immutable version', async () => {
    storage.scan.mockResolvedValueOnce('INFECTED');
    await expect(service.complete('proof', binding)).rejects.toMatchObject({ status: 422 });
    expect(db.deliveryProof.updateMany).not.toHaveBeenCalled();
    await expect(service.complete('proof', binding)).resolves.toEqual({
      proofId: 'proof',
      ready: true,
    });
    expect(storage.scan).toHaveBeenLastCalledWith(
      expect.objectContaining({ storageVersionId: 'version-1', checksumSha256: 'hash' }),
    );
    expect(db.deliveryProof.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proof', verifiedAt: null },
        data: expect.objectContaining({
          storageVersionId: 'version-1',
          verifiedAt: expect.any(Date),
        }),
      }),
    );
  });
  it('uses GuardDuty verification when configured, never silently bypasses scanning', async () => {
    storage.isGuardDutyScanner.mockReturnValue(true);
    storage.assertGuardDutyClean.mockRejectedValue(new Error('not clean yet'));
    await expect(service.complete('proof', binding)).rejects.toThrow('not clean yet');
    expect(db.deliveryProof.updateMany).not.toHaveBeenCalled();
  });
  it('completion is idempotent and a fresh authorised read signs the pinned version', async () => {
    db.deliveryProof.findFirst.mockResolvedValue({
      ...row,
      verifiedAt: new Date(),
      storageVersionId: 'original-version',
    });
    await expect(service.complete('proof', binding)).resolves.toEqual({
      proofId: 'proof',
      ready: true,
    });
    expect(storage.verifyUpload).not.toHaveBeenCalled();
    db.trip.findFirst.mockResolvedValue({ status: 'COMPLETED' });
    await expect(service.read('proof', binding)).resolves.toMatchObject({ ready: true });
    expect(storage.downloadUrl).toHaveBeenCalledWith('private/proof', 60, 'original-version');
    await expect(
      service.initiate({ ...binding, contentType: 'image/jpeg', sizeBytes: 100 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('does not expose unverified objects for reading', async () => {
    await expect(service.read('proof', binding)).rejects.toMatchObject({ status: 409 });
    expect(storage.downloadUrl).not.toHaveBeenCalled();
  });
});
