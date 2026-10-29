import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DocumentStorageService } from '../../src/onboarding/document-storage.service';
import { bearer, createAdmin, createDriver, type TestDriver } from '../helpers/fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { restrictedDatabaseUrl } from '../setup/test-database';

/** Real HTTP guards/DTOs/state machine/PostgreSQL. Only AWS transport is synthetic. */
describe('Onboarding evidence -> GuardDuty -> admin -> eligibility (isolated)', () => {
  let owner: TestContext, app: TestContext;
  let driver: TestDriver, other: TestDriver;
  let adminToken: string;
  let kycId: string, vehicleId: string;
  const root = '/v1/drivers/me/onboarding';
  beforeAll(async () => {
    owner = await createTestApp();
    app = await createTestApp({
      databaseUrl: restrictedDatabaseUrl(),
      configOverrides: {
        ONBOARDING_MINIMUM_AGE: '18',
        MANUAL_KYC_ENABLED: 'true',
        MANUAL_KYC_POLICY_VERSION: 'SYNTHETIC_QA_ONLY',
        MANUAL_KYC_REQUIRED_DOCUMENTS: 'TEST_ID,TEST_PORTRAIT',
        MANUAL_KYC_CHECKLIST: 'TEST_NAME,TEST_PHOTO',
        VEHICLE_REQUIRED_DOCUMENTS_BY_CATEGORY: JSON.stringify({
          MINI_TRUCK: ['TEST_RC', 'TEST_PHOTO'],
        }),
        DOCUMENT_STORAGE_PROVIDER: 's3',
        DOCUMENT_STORAGE_REGION: 'ap-south-1',
        DOCUMENT_STORAGE_BUCKET: 'synthetic-qa-only',
        DOCUMENT_STORAGE_ACCESS_KEY_ID: 'synthetic-access',
        DOCUMENT_STORAGE_SECRET_ACCESS_KEY: 'synthetic-secret-never-live',
        DOCUMENT_SCANNER_PROVIDER: 'guardduty',
        GUARDDUTY_REGION: 'ap-south-1',
        GUARDDUTY_AWS_ACCOUNT_ID: '123456789012',
        GUARDDUTY_EVENT_TOKEN: 'synthetic-event-token-qa-only-123456789',
        CORS_ORIGINS: 'https://admin.example.test',
      },
    });
    const fixtures = { prisma: owner.prisma, tokens: app.tokens };
    driver = await createDriver(fixtures, { approved: false });
    other = await createDriver(fixtures, { approved: false });
    adminToken = (await createAdmin(fixtures)).token;
    const storage = app.app.get(DocumentStorageService);
    jest.spyOn(storage, 'uploadUrl').mockImplementation(() =>
      Promise.resolve({
        url: 'https://synthetic-storage.example.test/upload',
        headers: {
          'content-type': 'image/jpeg',
          'content-length': '64',
          'x-amz-server-side-encryption': 'AES256',
        },
        expiresInSeconds: 300,
      }),
    );
    jest.spyOn(storage, 'verifyUpload').mockImplementation((descriptor) =>
      Promise.resolve({
        checksumSha256: 'a'.repeat(64),
        storageVersionId: `v-${descriptor.documentId}`,
        storageETag: `etag-${descriptor.documentId}`,
      }),
    );
    jest.spyOn(storage, 'assertGuardDutyClean').mockResolvedValue();
    jest
      .spyOn(storage, 'downloadUrl')
      .mockResolvedValue('https://synthetic-storage.example.test/private?temporary=synthetic');
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await owner?.close();
  });
  const asDriver = () => bearer(driver.token);
  async function upload(kind: 'KYC' | 'VEHICLE', id: string, type: string) {
    const base = `${root}/${kind === 'KYC' ? 'kyc' : 'vehicles'}/${id}/documents`;
    const initiated = await request(app.server)
      .post(base)
      .set(asDriver())
      .send({ documentType: type, contentType: 'image/jpeg', sizeBytes: 64 })
      .expect(201);
    const docId: string = initiated.body.document.id;
    await request(app.server).post(`${base}/${docId}/complete`).set(asDriver()).send().expect(201);
    return { base, docId };
  }
  async function scan(kind: 'KYC' | 'VEHICLE', docId: string, result = 'NO_THREATS_FOUND') {
    const doc =
      kind === 'KYC'
        ? await owner.prisma.kycDocument.findUniqueOrThrow({ where: { id: docId } })
        : await owner.prisma.vehicleDocument.findUniqueOrThrow({ where: { id: docId } });
    const event = {
      id: randomUUID(),
      source: 'aws.guardduty',
      account: '123456789012',
      region: 'ap-south-1',
      'detail-type': 'GuardDuty Malware Protection Object Scan Result',
      detail: {
        scanStatus: 'COMPLETED',
        resourceType: 'S3_OBJECT',
        s3ObjectDetails: {
          bucketName: 'synthetic-qa-only',
          objectKey: doc.storageKey,
          versionId: doc.storageVersionId ?? `v-${docId}`,
          eTag: doc.storageETag ?? `etag-${docId}`,
        },
        scanResultDetails: { scanResultStatus: result },
      },
    };
    const delivery = () =>
      request(app.server)
        .post('/v1/onboarding/guardduty/events')
        .set('x-multipleride-guardduty-token', 'synthetic-event-token-qa-only-123456789')
        .send(event)
        .expect(202);
    await delivery();
    const duplicate = await delivery();
    expect(duplicate.body.duplicate).toBe(true);
  }
  it('persists profile and vehicle while refusing shortcut final approval and invalid categories', async () => {
    await request(app.server)
      .patch(`${root}/profile`)
      .set(asDriver())
      .send({
        profileVersion: 2,
        name: 'Synthetic Driver',
        dateOfBirth: '1990-01-01',
        email: 'qa@example.test',
        residentialAddress: '123 Synthetic Road',
        city: 'Test City',
        state: 'Test State',
        pinCode: '342001',
      })
      .expect(200);
    const kyc = await request(app.server).post(`${root}/kyc`).set(asDriver()).send().expect(201);
    kycId = kyc.body.id;
    const vehicle = await request(app.server)
      .post(`${root}/vehicles`)
      .set(asDriver())
      .send({
        category: 'MINI_TRUCK',
        registrationNumber: 'RJ19QA1234',
        makeModel: 'Synthetic Mini Truck',
      })
      .expect(201);
    vehicleId = vehicle.body.id;
    await request(app.server)
      .patch(`/v1/admin/onboarding/drivers/${driver.driverId}/decision`)
      .set(bearer(adminToken))
      .send({ decision: 'APPROVE', reason: 'Synthetic shortcut rejected' })
      .expect(409);
    await request(app.server)
      .patch(`${root}/vehicle-category`)
      .set(asDriver())
      .send({ category: 'CRANE' })
      .expect(400);
  });
  it('keeps unscanned documents quarantined, refuses unauthorized previews, and permits safe replacement after malware rejection', async () => {
    const initiations = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app.server)
          .post(`${root}/kyc/${kycId}/documents`)
          .set(asDriver())
          .send({ documentType: 'TEST_ID', contentType: 'image/jpeg', sizeBytes: 64 }),
      ),
    );
    expect(initiations.map((response) => response.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(initiations.map((response) => response.body.document.id)).size).toBe(1);
    const first = await upload('KYC', kycId, 'TEST_ID');
    const completions = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app.server).post(`${first.base}/${first.docId}/complete`).set(asDriver()).send(),
      ),
    );
    expect(completions.every((response) => response.status === 201)).toBe(true);
    await request(app.server)
      .get(`${root}/documents/KYC/${first.docId}/preview`)
      .set(asDriver())
      .expect(404);
    await request(app.server)
      .post(`${root}/kyc/${kycId}/submit`)
      .set(asDriver())
      .send()
      .expect(409);
    await scan('KYC', first.docId, 'THREATS_FOUND');
    const replacement = await upload('KYC', kycId, 'TEST_ID');
    expect(replacement.docId).not.toBe(first.docId);
    await scan('KYC', replacement.docId);
    await request(app.server)
      .get(`${root}/documents/KYC/${replacement.docId}/preview`)
      .set(bearer(other.token))
      .expect(404);
    await request(app.server)
      .get(`${root}/documents/KYC/${replacement.docId}/preview`)
      .set(asDriver())
      .expect(200);
    // A scan arriving before upload completion must recover after the exact S3 version binds.
    const portrait = await request(app.server)
      .post(`${root}/kyc/${kycId}/documents`)
      .set(asDriver())
      .send({ documentType: 'TEST_PORTRAIT', contentType: 'image/jpeg', sizeBytes: 64 })
      .expect(201);
    const portraitId: string = portrait.body.document.id;
    await scan('KYC', portraitId);
    expect(
      (await owner.prisma.kycDocument.findUniqueOrThrow({ where: { id: portraitId } })).scannedAt,
    ).toBeNull();
    await request(app.server)
      .post(`${root}/kyc/${kycId}/documents/${portraitId}/complete`)
      .set(asDriver())
      .send()
      .expect(201);
    expect(
      (await owner.prisma.kycDocument.findUniqueOrThrow({ where: { id: portraitId } })).scannedAt,
    ).not.toBeNull();
  });
  it('requires admin checklist/document verification and locks profile during review', async () => {
    await request(app.server)
      .post(`${root}/kyc/${kycId}/submit`)
      .set(asDriver())
      .send()
      .expect(201);
    await request(app.server)
      .patch(`${root}/profile`)
      .set(asDriver())
      .send({ name: 'Different Identity' })
      .expect(409);
    await request(app.server)
      .patch(`/v1/admin/onboarding/kyc/${kycId}/verify`)
      .set(asDriver())
      .send({ reason: 'Cannot self approve', checklist: {}, legalName: 'Synthetic Driver' })
      .expect(403);
    await request(app.server)
      .patch(`/v1/admin/onboarding/kyc/${kycId}/verify`)
      .set(bearer(adminToken))
      .send({ reason: 'Incomplete checklist', checklist: {}, legalName: 'Synthetic Driver' })
      .expect(409);
    const docs = await owner.prisma.kycDocument.findMany({
      where: { applicationId: kycId, status: 'QUARANTINED' },
    });
    for (const doc of docs)
      await request(app.server)
        .patch(`/v1/admin/onboarding/documents/KYC/${doc.id}/review`)
        .set(bearer(adminToken))
        .send({ decision: 'VERIFIED', reason: 'Synthetic evidence compared by test administrator' })
        .expect(200);
    await request(app.server)
      .patch(`/v1/admin/onboarding/kyc/${kycId}/verify`)
      .set(bearer(adminToken))
      .send({
        reason: 'Synthetic checklist complete',
        checklist: { TEST_NAME: true, TEST_PHOTO: true },
        legalName: 'Synthetic Driver',
      })
      .expect(200);
  });
  it('verifies category-specific vehicle evidence then requires separate final approval; suspension revokes eligibility', async () => {
    for (const type of ['TEST_RC', 'TEST_PHOTO']) {
      const doc = await upload('VEHICLE', vehicleId, type);
      await scan('VEHICLE', doc.docId);
    }
    await request(app.server)
      .post(`${root}/vehicles/${vehicleId}/submit`)
      .set(asDriver())
      .send()
      .expect(201);
    const docs = await owner.prisma.vehicleDocument.findMany({ where: { vehicleId } });
    for (const doc of docs)
      await request(app.server)
        .patch(`/v1/admin/onboarding/documents/VEHICLE/${doc.id}/review`)
        .set(bearer(adminToken))
        .send({ decision: 'VERIFIED', reason: 'Synthetic vehicle evidence checked' })
        .expect(200);
    await request(app.server)
      .patch(`/v1/admin/onboarding/vehicles/${vehicleId}/review`)
      .set(bearer(adminToken))
      .send({ decision: 'VERIFIED', reason: 'Synthetic vehicle approved' })
      .expect(200);
    expect((await request(app.server).get(root).set(asDriver())).body.eligible).toBe(false);
    await request(app.server)
      .patch(`/v1/admin/onboarding/drivers/${driver.driverId}/decision`)
      .set(bearer(adminToken))
      .send({ decision: 'APPROVE', reason: 'Synthetic final approval' })
      .expect(200);
    expect((await request(app.server).get(root).set(asDriver())).body.eligible).toBe(true);
    await request(app.server)
      .patch(`${root}/vehicles/${vehicleId}`)
      .set(asDriver())
      .send({ category: 'PICKUP_TRUCK', registrationNumber: 'RJ19QA1234', makeModel: 'Tamper' })
      .expect(409);
    await request(app.server)
      .patch(`/v1/admin/onboarding/drivers/${driver.driverId}/decision`)
      .set(bearer(adminToken))
      .send({ decision: 'SUSPEND', reason: 'Synthetic suspension' })
      .expect(200);
    expect((await request(app.server).get(root).set(asDriver())).body.eligible).toBe(false);
  });
  it('reopens verified identity only through an audited admin correction and requires reverification', async () => {
    await request(app.server)
      .patch(`/v1/admin/onboarding/kyc/${kycId}/review`)
      .set(bearer(adminToken))
      .send({ decision: 'NEEDS_CORRECTION', reason: 'Synthetic identity correction request' })
      .expect(200);
    // A KYC reviewer cannot accidentally unsuspend a driver.
    expect((await request(app.server).get(root).set(asDriver())).body.approvalStatus).toBe(
      'SUSPENDED',
    );
    await request(app.server)
      .patch(`/v1/admin/onboarding/drivers/${driver.driverId}/decision`)
      .set(bearer(adminToken))
      .send({ decision: 'CORRECTION', reason: 'Synthetic authorized correction resumption' })
      .expect(200);
    await request(app.server)
      .patch(`${root}/profile`)
      .set(asDriver())
      .send({ name: 'Synthetic Corrected Driver' })
      .expect(200);
    await request(app.server)
      .patch(`/v1/admin/onboarding/drivers/${driver.driverId}/decision`)
      .set(bearer(adminToken))
      .send({ decision: 'APPROVE', reason: 'Must not reuse prior KYC verification' })
      .expect(409);
    expect((await request(app.server).get(root).set(asDriver())).body.eligible).toBe(false);
    await request(app.server)
      .post(`${root}/kyc/${kycId}/submit`)
      .set(asDriver())
      .send()
      .expect(201);
    await request(app.server)
      .patch(`/v1/admin/onboarding/kyc/${kycId}/verify`)
      .set(bearer(adminToken))
      .send({
        reason: 'Synthetic correction reviewed again',
        checklist: { TEST_NAME: true, TEST_PHOTO: true },
        legalName: 'Synthetic Corrected Driver',
      })
      .expect(200);
    expect((await request(app.server).get(root).set(asDriver())).body.eligible).toBe(false);
    await request(app.server)
      .patch(`/v1/admin/onboarding/drivers/${driver.driverId}/decision`)
      .set(bearer(adminToken))
      .send({ decision: 'APPROVE', reason: 'Synthetic renewed final approval' })
      .expect(200);
    expect((await request(app.server).get(root).set(asDriver())).body.eligible).toBe(true);
  });
  it('permits PATCH preflight from the approved admin origin', async () => {
    const response = await request(app.server)
      .options(`/v1/admin/onboarding/drivers/${driver.driverId}/decision`)
      .set('Origin', 'https://admin.example.test')
      .set('Access-Control-Request-Method', 'PATCH')
      .expect(204);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
  });
});
