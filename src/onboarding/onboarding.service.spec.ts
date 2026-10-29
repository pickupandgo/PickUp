import { HttpStatus } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import type { AppConfig } from '../config/app-config';
import { DocumentStorageService } from './document-storage.service';
import { OnboardingService } from './onboarding.service';
import type { PrismaService } from '../prisma/prisma.service';

const driverPrincipal: Principal = {
  userId: 'user-1',
  role: 'DRIVER',
  driver: { id: 'driver-1', approvalStatus: 'PENDING' },
  customer: null,
  session: { authenticatedAt: null, phoneNumber: '+919999999999', signInProvider: 'phone' },
};
const customerPrincipal: Principal = {
  userId: 'user-2',
  role: 'CUSTOMER',
  driver: null,
  customer: { id: 'customer-1' },
  session: { authenticatedAt: null, phoneNumber: '+918888888888', signInProvider: 'phone' },
};
const adminPrincipal: Principal = {
  userId: 'admin-1',
  role: 'ADMIN',
  driver: null,
  customer: null,
  session: { authenticatedAt: null, phoneNumber: null, signInProvider: 'password' },
};

const config = {
  auth: { provider: 'firebase' },
  manualKyc: {
    enabled: true,
    policyVersion: 'POLICY_1',
    requiredDocuments: ['IDENTITY', 'LICENSE'],
    checklist: ['FACE_MATCH', 'NAME_MATCH'],
  },
  onboarding: { requiredVehicleDocuments: ['RC', 'INSURANCE'] },
  documents: { downloadTtlSeconds: 60 },
} as unknown as AppConfig;

const createPrisma = () => {
  const prisma = {
    authIdentity: { findUnique: jest.fn() },
    driver: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    adminAction: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    kycApplication: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    kycDocument: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    vehicle: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    vehicleDocument: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    vehicleChangeRequest: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  return {
    ...prisma,
    $transaction: jest.fn((callback: (tx: typeof prisma) => unknown) =>
      Promise.resolve(callback(prisma)),
    ),
  };
};
const createStorage = () => ({
  assertInput: jest.fn(),
  assertOperational: jest.fn(),
  uploadUrl: jest.fn(),
  verifyUpload: jest.fn(),
  scan: jest.fn(),
  downloadUrl: jest.fn(),
});

describe('OnboardingService', () => {
  let prisma: ReturnType<typeof createPrisma>;
  let storage: ReturnType<typeof createStorage>;
  let service: OnboardingService;
  beforeEach(() => {
    prisma = createPrisma();
    storage = createStorage();
    service = new OnboardingService(
      prisma as unknown as PrismaService,
      storage as unknown as DocumentStorageService,
      config,
    );
  });

  it('rejects customer access before querying driver data', async () => {
    await expect(service.summary(customerPrincipal)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(prisma.driver.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('uses the current KYC application instead of falling back to older verified evidence', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'APPROVED',
      approvedAt: new Date(),
      user: { status: 'ACTIVE' },
      kycApplications: [
        { status: 'NEEDS_CORRECTION', verifiedAt: new Date(0), expiresAt: null },
        { status: 'VERIFIED', verifiedAt: new Date(0), expiresAt: null },
      ],
      vehicles: [
        {
          id: 'v1',
          category: 'MINI_TRUCK',
          status: 'VERIFIED',
          active: true,
          verifiedAt: new Date(0),
          documents: [
            { documentType: 'RC', status: 'VERIFIED', version: 1 },
            { documentType: 'INSURANCE', status: 'VERIFIED', version: 1 },
          ],
        },
      ],
    });
    await expect(service.eligibility('driver-1')).resolves.toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(['KYC_NOT_VERIFIED']),
    });
    const query = prisma.driver.findUnique.mock.calls[0]?.[0];
    expect(query.include.kycApplications.where).toBeUndefined();
    expect(query.include.kycApplications.take).toBe(1);
  });

  it('returns an existing pending KYC application idempotently', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'PENDING',
      user: { status: 'ACTIVE' },
    });
    prisma.kycApplication.findFirst.mockResolvedValue({
      id: 'kyc-1',
      status: 'PENDING',
      documents: [],
    });
    await expect(service.startKyc(driverPrincipal)).resolves.toMatchObject({ id: 'kyc-1' });
    expect(prisma.kycApplication.create).not.toHaveBeenCalled();
  });

  it('returns the winner after a concurrent KYC unique-constraint race', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'PENDING',
      user: { status: 'ACTIVE' },
    });
    prisma.kycApplication.findFirst.mockResolvedValueOnce(null);
    prisma.kycApplication.findFirstOrThrow.mockResolvedValue({
      id: 'winner',
      status: 'PENDING',
      documents: [],
    });
    prisma.kycApplication.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.startKyc(driverPrincipal)).resolves.toMatchObject({ id: 'winner' });
  });

  it('blocks rejected and suspended drivers from resubmitting', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'SUSPENDED',
      user: { status: 'ACTIVE' },
    });
    await expect(service.startKyc(driverPrincipal)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('requires all configured KYC evidence before submission', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'PENDING',
      user: { status: 'ACTIVE' },
    });
    prisma.kycApplication.findFirst.mockResolvedValue({
      id: 'kyc-1',
      status: 'PENDING',
      documents: [{ documentType: 'IDENTITY', status: 'QUARANTINED', version: 1 }],
    });
    await expect(service.submitKyc(driverPrincipal, 'kyc-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });

  it('does not submit KYC while any required document is still awaiting an asynchronous scan', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'PENDING',
      user: { status: 'ACTIVE' },
    });
    prisma.kycApplication.findFirst.mockResolvedValue({
      id: 'kyc-1',
      status: 'PENDING',
      documents: [
        { documentType: 'IDENTITY', status: 'QUARANTINED', version: 1, scannedAt: new Date() },
        { documentType: 'LICENSE', status: 'QUARANTINED', version: 1, scannedAt: null },
      ],
    });
    await expect(service.submitKyc(driverPrincipal, 'kyc-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });

  it('locks identity-critical fields after vehicle verification', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'APPROVED',
      user: { status: 'ACTIVE' },
    });
    prisma.vehicle.findFirst.mockResolvedValue({
      id: 'vehicle-1',
      active: true,
      status: 'VERIFIED',
    });
    await expect(
      service.updateVehicle(driverPrincipal, 'vehicle-1', {
        category: 'MINI_TRUCK',
        registrationNumber: 'MH12AB1234',
        makeModel: 'Tata Ace',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
  });

  it('reports authoritative eligibility only with every prerequisite', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'APPROVED',
      approvedAt: new Date('2026-01-03T00:00:00Z'),
      user: { status: 'ACTIVE' },
      kycApplications: [
        { status: 'VERIFIED', expiresAt: null, verifiedAt: new Date('2026-01-01T00:00:00Z') },
      ],
      vehicles: [
        {
          id: 'vehicle-1',
          active: true,
          status: 'VERIFIED',
          verifiedAt: new Date('2026-01-02T00:00:00Z'),
          documents: [
            { documentType: 'RC', status: 'VERIFIED', version: 1 },
            { documentType: 'INSURANCE', status: 'VERIFIED', version: 1 },
          ],
        },
      ],
    });
    await expect(service.eligibility('driver-1')).resolves.toMatchObject({
      eligible: true,
      reasons: [],
      vehicleId: 'vehicle-1',
    });
  });

  it('resolves the engine Firebase subject to its driver record before evaluating eligibility', async () => {
    prisma.authIdentity.findUnique.mockResolvedValue({
      subject: 'firebase-driver-1',
      user: { role: 'DRIVER', driver: { id: 'driver-1' } },
    });
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'APPROVED',
      approvedAt: new Date('2026-01-03T00:00:00Z'),
      user: { status: 'ACTIVE' },
      kycApplications: [
        { status: 'VERIFIED', expiresAt: null, verifiedAt: new Date('2026-01-01T00:00:00Z') },
      ],
      vehicles: [
        {
          id: 'vehicle-1',
          active: true,
          status: 'VERIFIED',
          verifiedAt: new Date('2026-01-02T00:00:00Z'),
          documents: [
            { documentType: 'RC', status: 'VERIFIED', version: 1 },
            { documentType: 'INSURANCE', status: 'VERIFIED', version: 1 },
          ],
        },
      ],
    });

    await expect(service.eligibilityForSubject('firebase-driver-1')).resolves.toMatchObject({
      driverId: 'driver-1',
      subject: 'firebase-driver-1',
      eligible: true,
    });
    expect(prisma.authIdentity.findUnique).toHaveBeenCalledWith({
      where: { provider_subject: { provider: 'firebase', subject: 'firebase-driver-1' } },
      select: expect.any(Object),
    });
  });

  it('fails eligibility closed when a required vehicle document is absent', async () => {
    prisma.driver.findUnique.mockResolvedValue({
      approvalStatus: 'APPROVED',
      approvedAt: new Date('2026-01-03T00:00:00Z'),
      user: { status: 'ACTIVE' },
      kycApplications: [
        { status: 'VERIFIED', expiresAt: null, verifiedAt: new Date('2026-01-01T00:00:00Z') },
      ],
      vehicles: [
        {
          id: 'vehicle-1',
          active: true,
          status: 'VERIFIED',
          verifiedAt: new Date('2026-01-02T00:00:00Z'),
          documents: [{ documentType: 'RC', status: 'VERIFIED', version: 1 }],
        },
      ],
    });
    await expect(service.eligibility('driver-1')).resolves.toMatchObject({
      eligible: false,
      reasons: ['VEHICLE_DOCUMENTS_NOT_VERIFIED'],
    });
  });

  it('requires the complete approved checklist for manual KYC verification', async () => {
    await expect(
      service.verifyKyc(adminPrincipal, 'kyc-1', 'reviewed', { FACE_MATCH: true }, 'Driver Name'),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('serializes final KYC verification and records the administrator decision', async () => {
    prisma.kycApplication.findUnique.mockResolvedValue({
      id: 'kyc-1',
      driverId: 'driver-1',
      provider: 'MANUAL_ADMIN_VERIFICATION',
      policyVersion: 'POLICY_1',
      status: 'IN_REVIEW',
      documents: [
        { documentType: 'IDENTITY', status: 'VERIFIED', version: 1 },
        { documentType: 'LICENSE', status: 'VERIFIED', version: 1 },
      ],
    });
    prisma.kycApplication.update.mockResolvedValue({ id: 'kyc-1', status: 'VERIFIED' });
    prisma.driver.update.mockResolvedValue({});
    prisma.adminAction.create.mockResolvedValue({});
    await expect(
      service.verifyKyc(
        adminPrincipal,
        'kyc-1',
        'Evidence checked',
        { FACE_MATCH: true, NAME_MATCH: true },
        'Driver Name',
      ),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.adminAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorUserId: 'admin-1', action: 'KYC_VERIFIED' }),
      }),
    );
  });

  it('handles concurrent document review without overwriting the first decision', async () => {
    prisma.kycDocument.findUnique.mockResolvedValue({
      id: 'doc-1',
      status: 'QUARANTINED',
      scannedAt: new Date(),
      application: { driverId: 'driver-1', status: 'IN_REVIEW' },
    });
    prisma.kycDocument.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.reviewDocument(adminPrincipal, 'KYC', 'doc-1', 'VERIFIED', 'checked'),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(prisma.adminAction.create).not.toHaveBeenCalled();
  });

  it('does not activate a second vehicle outside the replacement workflow', async () => {
    prisma.vehicle.findUnique.mockResolvedValue({
      id: 'new',
      driverId: 'driver-1',
      status: 'SUBMITTED',
      driver: { approvalStatus: 'APPROVED', user: { status: 'ACTIVE' } },
      documents: [
        { documentType: 'RC', status: 'VERIFIED', version: 1 },
        { documentType: 'INSURANCE', status: 'VERIFIED', version: 1 },
      ],
    });
    prisma.vehicleChangeRequest.findFirst.mockResolvedValue(null);
    prisma.vehicle.findFirst.mockResolvedValue({ id: 'current', active: true, status: 'VERIFIED' });
    await expect(
      service.reviewVehicle(adminPrincipal, 'new', 'VERIFIED', 'checked'),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
  });

  it('atomically deactivates the old vehicle and activates an approved replacement', async () => {
    prisma.vehicle.findUnique
      .mockResolvedValueOnce({ driverId: 'driver-1' })
      .mockResolvedValueOnce({
        id: 'new',
        driverId: 'driver-1',
        status: 'SUBMITTED',
        driver: { approvalStatus: 'APPROVED', user: { status: 'ACTIVE' } },
        documents: [
          { documentType: 'RC', status: 'VERIFIED', version: 1 },
          { documentType: 'INSURANCE', status: 'VERIFIED', version: 1 },
        ],
      })
      .mockResolvedValueOnce({
        id: 'old',
        active: true,
        status: 'VERIFIED',
        documents: [
          { documentType: 'RC', status: 'VERIFIED', version: 1 },
          { documentType: 'INSURANCE', status: 'VERIFIED', version: 1 },
        ],
      });
    prisma.kycApplication.findFirst.mockResolvedValue({ id: 'kyc-1', status: 'VERIFIED' });
    prisma.vehicleChangeRequest.findFirst.mockResolvedValue({
      id: 'change-1',
      currentVehicleId: 'old',
      replacementVehicleId: 'new',
      status: 'PENDING',
    });
    prisma.vehicle.update.mockResolvedValue({});
    prisma.vehicleChangeRequest.update.mockResolvedValue({});
    prisma.adminAction.create.mockResolvedValue({});
    prisma.vehicle.findUniqueOrThrow.mockResolvedValue({
      id: 'new',
      active: true,
      status: 'VERIFIED',
      documents: [],
    });
    await expect(
      service.reviewVehicle(adminPrincipal, 'new', 'VERIFIED', 'approved'),
    ).resolves.toMatchObject({ id: 'new', active: true });
    expect(prisma.vehicle.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'old' },
      data: { active: false, status: 'INACTIVE' },
    });
    expect(prisma.vehicle.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'new' },
        data: expect.objectContaining({ active: true, status: 'VERIFIED' }),
      }),
    );
    expect(prisma.vehicleChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'change-1' },
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
  });
});
