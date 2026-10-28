import { GetObjectCommand, GetObjectTaggingCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/app-config';
import { DocumentStorageService } from './document-storage.service';

const config = {
  documents: {
    storage: {
      endpoint: 'https://s3.example.test',
      region: 'test-1',
      bucket: 'private-documents',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-access-key',
      forcePathStyle: true,
    },
    uploadTtlSeconds: 300,
    downloadTtlSeconds: 60,
    maxBytes: 10_000_000,
    allowedContentTypes: ['image/jpeg'],
    scanner: { kind: 'http', url: 'https://scanner.example.test', token: 'scanner-token-value-123456789' },
  },
} as unknown as AppConfig;

describe('DocumentStorageService', () => {
  it('rejects disallowed content types and oversized files before storage access', () => {
    const service = new DocumentStorageService(config);
    expect(() => service.assertInput('text/html', 10)).toThrow('content type');
    expect(() => service.assertInput('image/jpeg', 10_000_001)).toThrow('size');
  });

  it('fails closed when storage or scanning is disabled', () => {
    const service = new DocumentStorageService({
      ...config,
      documents: { ...config.documents, storage: null, scanner: null },
    } as AppConfig);
    expect(() => service.assertOperational()).toThrow('not configured');
  });

  it('derives SHA-256 from the stored bytes instead of trusting the client', async () => {
    const service = new DocumentStorageService(config);
    const bytes = Buffer.from('trusted-upload');
    (service as any).client = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof HeadObjectCommand)
          return {
            ContentLength: bytes.length,
            ContentType: 'image/jpeg',
            Metadata: { documentid: 'doc-1' },
            ServerSideEncryption: 'AES256',
            VersionId: 'version-1',
            ETag: 'etag-1',
          };
        if (command instanceof GetObjectCommand)
          return {
            Body: (async function* () {
              yield bytes;
            })(),
          };
        throw new Error('unexpected command');
      }),
    };
    await expect(
      service.verifyUpload({
        key: 'private/key',
        contentType: 'image/jpeg',
        sizeBytes: bytes.length,
        documentId: 'doc-1',
      }),
    ).resolves.toMatchObject({
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      storageVersionId: 'version-1',
      storageETag: 'etag-1',
    });
  });

  it("requires GuardDuty's clean tag on the exact immutable object version", async () => {
    const service = new DocumentStorageService({
      ...config,
      documents: {
        ...config.documents,
        scanner: {
          kind: 'guardduty',
          eventToken: 'x'.repeat(32),
          awsAccountId: '123456789012',
          region: 'test-1',
        },
      },
    } as AppConfig);
    (service as any).client = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof HeadObjectCommand)
          return {
            ContentLength: 10,
            ContentType: 'image/jpeg',
            Metadata: { documentid: 'doc-1' },
            ServerSideEncryption: 'AES256',
            VersionId: 'version-1',
            ETag: 'etag-1',
          };
        if (command instanceof GetObjectTaggingCommand)
          return { TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' }] };
        throw new Error('unexpected command');
      }),
    };
    await expect(service.assertGuardDutyClean({
      key: 'private/key', contentType: 'image/jpeg', sizeBytes: 10, documentId: 'doc-1',
      checksumSha256: 'a'.repeat(64), storageVersionId: 'version-1', storageETag: 'etag-1',
    })).resolves.toBeUndefined();
  });

  it('rejects object metadata that does not match the signed upload request', async () => {
    const service = new DocumentStorageService(config);
    (service as any).client = {
      send: jest
        .fn()
        .mockResolvedValue({
          ContentLength: 999,
          ContentType: 'image/jpeg',
          Metadata: { documentid: 'doc-1' },
          ServerSideEncryption: 'AES256',
        }),
    };
    await expect(
      service.verifyUpload({
        key: 'private/key',
        contentType: 'image/jpeg',
        sizeBytes: 10,
        documentId: 'doc-1',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
