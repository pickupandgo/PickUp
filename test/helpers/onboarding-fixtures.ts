import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../src/config/app-config';
import { DocumentStorageService } from '../../src/onboarding/document-storage.service';
import { OnboardingService } from '../../src/onboarding/onboarding.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createAdmin,
  FIXTURE_DRIVER_NAME,
  uniquePhone,
  uniqueSubject,
  type FixtureDeps,
  type TestDriver,
} from './fixtures';
import { buildTestConfig } from './test-config';

/**
 * Explicit, owner-only historical compliance seed. Never imported by production src.
 * createDriver() deliberately stays incomplete for authentication/negative tests.
 * Evidence is synthetic; final approval uses the real audited database functions, and
 * the completed fixture must pass the actual production eligibility service.
 */
export async function createHistoricalEligibleDriver(
  deps: FixtureDeps & { readonly config?: AppConfig },
  options: { readonly legalName?: string } = {},
): Promise<TestDriver> {
  const config = deps.config ?? buildTestConfig();
  const category = 'MINI_TRUCK';
  const identityDocuments = config.manualKyc.requiredDocuments;
  const vehicleDocuments = config.onboarding.requiredVehicleDocumentsByCategory
    ? (config.onboarding.requiredVehicleDocumentsByCategory[category] ?? [])
    : config.onboarding.requiredVehicleDocuments;
  if (!identityDocuments.length || !vehicleDocuments.length)
    throw new Error(
      'Eligible fixtures require a non-empty synthetic identity/vehicle document policy',
    );
  const reviewer = await createAdmin(deps);
  const subject = uniqueSubject('historical_eligible');
  const phone = uniquePhone();
  const legalName = options.legalName ?? FIXTURE_DRIVER_NAME;
  const verifiedAt = new Date(Date.now() - 10_000);
  const driver = await deps.prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        phone,
        role: 'DRIVER',
        status: 'ACTIVE',
        authIdentities: { create: { provider: config.auth.provider, subject } },
        driver: {
          create: { profileVersion: 1, profileName: legalName, approvalStatus: 'PENDING' },
        },
      },
      include: { driver: true },
    });
    if (!user.driver) throw new Error('Historical driver fixture could not be created');
    const driverId = user.driver.id;
    const application = await tx.kycApplication.create({
      data: {
        driverId,
        provider: 'MANUAL_ADMIN_VERIFICATION',
        status: 'VERIFIED',
        verifiedAt,
        reviewedAt: verifiedAt,
        reviewedByUserId: reviewer.userId,
        policyVersion: config.manualKyc.policyVersion ?? 'SYNTHETIC_HISTORICAL_QA',
        verificationChecklist: Object.fromEntries(
          (config.manualKyc.checklist.length ? config.manualKyc.checklist : ['TEST_ID_CHECK']).map(
            (item) => [item, true],
          ),
        ),
      },
    });
    for (const documentType of identityDocuments)
      await tx.kycDocument.create({
        data: {
          applicationId: application.id,
          documentType,
          storageKey: `synthetic/${randomUUID()}`,
          contentType: 'image/jpeg',
          sizeBytes: 64,
          checksumSha256: 'a'.repeat(64),
          status: 'VERIFIED',
          uploadedAt: verifiedAt,
          scannedAt: verifiedAt,
          reviewedAt: verifiedAt,
          reviewedByUserId: reviewer.userId,
          storageVersionId: 'synthetic-v1',
          storageETag: 'synthetic-etag',
        },
      });
    const vehicle = await tx.vehicle.create({
      data: {
        driverId,
        category,
        registrationNumber: `QA${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`,
        makeModel: 'Historical Synthetic Vehicle',
        status: 'VERIFIED',
        active: true,
        verifiedAt,
        reviewedAt: verifiedAt,
        reviewedByUserId: reviewer.userId,
      },
    });
    for (const documentType of vehicleDocuments)
      await tx.vehicleDocument.create({
        data: {
          vehicleId: vehicle.id,
          documentType,
          storageKey: `synthetic/${randomUUID()}`,
          contentType: 'image/jpeg',
          sizeBytes: 64,
          checksumSha256: 'b'.repeat(64),
          status: 'VERIFIED',
          uploadedAt: verifiedAt,
          scannedAt: verifiedAt,
          reviewedAt: verifiedAt,
          reviewedByUserId: reviewer.userId,
          storageVersionId: 'synthetic-v1',
          storageETag: 'synthetic-etag',
        },
      });
    await tx.$executeRaw`SELECT admin_set_driver_legal_name_after_kyc(${driverId}::uuid,${application.id}::uuid,${reviewer.userId}::uuid,${legalName})`;
    await tx.$executeRaw`SELECT admin_set_driver_status(${driverId}::uuid,${'APPROVED'},${reviewer.userId}::uuid,${'Isolated historical compliance fixture; synthetic evidence only'})`;
    await tx.adminAction.create({
      data: {
        actorUserId: reviewer.userId,
        action: 'TEST_HISTORICAL_COMPLIANCE_SEEDED',
        targetType: 'DRIVER',
        targetId: driverId,
        reason: 'Isolated regression fixture; no real identity verification',
      },
    });
    return {
      userId: user.id,
      driverId,
      subject,
      phone,
      token: deps.tokens.sign(subject, { phoneNumber: phone }),
    };
  });
  const service = new OnboardingService(
    deps.prisma as unknown as PrismaService,
    new DocumentStorageService(config),
    config,
  );
  const eligibility = await service.eligibility(driver.driverId);
  if (!eligibility.eligible)
    throw new Error(
      `Historical fixture failed authoritative eligibility: ${eligibility.reasons.join(', ')}`,
    );
  return driver;
}
