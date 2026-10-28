import { HttpStatus } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import type { PrismaService } from '../prisma/prisma.service';
import type { DocumentStorageService } from './document-storage.service';
import { GuardDutyScanService } from './guardduty-scan.service';

const config = {
  documents: {
    storage: { bucket: 'private-documents' },
    scanner: {
      kind: 'guardduty',
      eventToken: 'x'.repeat(32),
      awsAccountId: '123456789012',
      region: 'ap-south-1',
    },
  },
} as unknown as AppConfig;

const event = (result: string = 'NO_THREATS_FOUND') => ({
  id: 'event-1',
  source: 'aws.guardduty',
  account: '123456789012',
  region: 'ap-south-1',
  'detail-type': 'GuardDuty Malware Protection Object Scan Result',
  detail: {
    scanStatus: 'COMPLETED',
    resourceType: 'S3_OBJECT',
    s3ObjectDetails: {
      bucketName: 'private-documents',
      objectKey: 'onboarding/driver/doc',
      eTag: 'etag-1',
      versionId: 'version-1',
    },
    scanResultDetails: { scanResultStatus: result },
  },
});

const kycDocument = {
  id: 'doc-1',
  storageKey: 'onboarding/driver/doc',
  storageVersionId: 'version-1',
  storageETag: 'etag-1',
  contentType: 'application/pdf',
  sizeBytes: 42,
  checksumSha256: 'a'.repeat(64),
};

function createPrisma() {
  const prisma: any = {
    documentScanEvent: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    kycDocument: { findFirst: jest.fn(), updateMany: jest.fn() },
    vehicleDocument: { findFirst: jest.fn(), updateMany: jest.fn() },
    adminAction: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prisma));
  prisma.documentScanEvent.create.mockResolvedValue({ id: 'audit-1' });
  prisma.kycDocument.updateMany.mockResolvedValue({ count: 1 });
  return prisma;
}

describe('GuardDutyScanService', () => {
  let prisma: any;
  let storage: jest.Mocked<Pick<DocumentStorageService, 'assertGuardDutyClean'>>;
  let service: GuardDutyScanService;

  beforeEach(() => {
    prisma = createPrisma();
    storage = { assertGuardDutyClean: jest.fn() };
    service = new GuardDutyScanService(
      prisma as PrismaService,
      storage as unknown as DocumentStorageService,
      config,
    );
  });

  it('marks only a tag-verified clean immutable KYC object as scanned', async () => {
    prisma.kycDocument.findFirst.mockResolvedValue(kycDocument);
    prisma.vehicleDocument.findFirst.mockResolvedValue(null);
    await expect(service.receive('x'.repeat(32), event())).resolves.toEqual({ duplicate: false });
    expect(storage.assertGuardDutyClean).toHaveBeenCalledWith(
      expect.objectContaining({
        storageVersionId: 'version-1',
        storageETag: 'etag-1',
      }),
    );
    expect(prisma.kycDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storageVersionId: 'version-1',
          guardDutyScanEventId: null,
        }),
        data: expect.objectContaining({ status: 'QUARANTINED', guardDutyScanEventId: 'event-1' }),
      }),
    );
  });

  it('keeps infected content out of review without trusting any clean tag', async () => {
    prisma.kycDocument.findFirst.mockResolvedValue(kycDocument);
    prisma.vehicleDocument.findFirst.mockResolvedValue(null);
    await service.receive('x'.repeat(32), event('THREATS_FOUND'));
    expect(storage.assertGuardDutyClean).not.toHaveBeenCalled();
    expect(prisma.kycDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
  });

  it('records a duplicate delivery without applying a second document transition', async () => {
    prisma.documentScanEvent.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.receive('x'.repeat(32), event())).resolves.toEqual({ duplicate: true });
    expect(prisma.kycDocument.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a forged EventBridge API destination request', async () => {
    await expect(service.receive('wrong-token', event())).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('does not transition a stale or unknown object', async () => {
    prisma.kycDocument.findFirst.mockResolvedValue(null);
    prisma.vehicleDocument.findFirst.mockResolvedValue(null);
    await service.receive('x'.repeat(32), event('FAILED'));
    expect(prisma.kycDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.documentScanEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'STALE_OR_UNKNOWN' }),
      }),
    );
  });
});
