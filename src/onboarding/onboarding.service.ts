import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { GuardDutyScanService } from './guardduty-scan.service';
import { randomUUID } from 'node:crypto';
import type { Principal } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { AppError } from '../common/errors/app-error';
import { ErrorCode, type ErrorCode as ErrorCodeValue } from '../common/errors/error-codes';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  DocumentStorageService,
  type StoredDocumentDescriptor,
  type UploadDescriptor,
} from './document-storage.service';
import type {
  CreateDocumentRequest,
  CreateVehicleRequest,
  ReplacementVehicleRequest,
  UpdateDriverProfileRequest,
} from './onboarding.dto';
import { VEHICLE_CATEGORIES } from './onboarding.dto';
import {
  ageOn,
  calendarDate,
  decryptLicence,
  encryptLicence,
  PROFILE_FIELDS,
  validBirthDate,
} from './profile-policy';

const OPEN_KYC = ['PENDING', 'IN_REVIEW', 'PROVIDER_UNAVAILABLE'] as const;
const EDITABLE_VEHICLE = ['DRAFT', 'REJECTED'] as const;

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly guardDuty?: GuardDutyScanService,
  ) {}
  private driver(principal: Principal): string {
    return requireDriver(principal).id;
  }
  private async assertSubmissionAllowed(
    driverId: string,
    db: PrismaService | Tx = this.prisma,
  ): Promise<void> {
    const driver = await db.driver.findUnique({
      where: { id: driverId },
      include: { user: true },
    });
    if (
      !driver ||
      driver.user.status !== 'ACTIVE' ||
      ['REJECTED', 'SUSPENDED'].includes(driver.approvalStatus)
    ) {
      throw new AppError(
        ErrorCode.DRIVER_NOT_ELIGIBLE,
        HttpStatus.FORBIDDEN,
        'Driver account is not allowed to submit onboarding changes',
      );
    }
  }
  private conflict(code: ErrorCodeValue, message: string): never {
    throw new AppError(code, HttpStatus.CONFLICT, message);
  }
  private withOnboardingLock<T>(
    principal: Principal,
    kind: 'KYC' | 'VEHICLE',
    id: string,
    action: (db: Tx) => Promise<T>,
  ): Promise<T> {
    const driverId = this.driver(principal);
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM drivers WHERE id=${driverId}::uuid FOR UPDATE`;
      await this.assertSubmissionAllowed(driverId, db);
      if (kind === 'KYC')
        await db.$queryRaw`SELECT id FROM kyc_applications WHERE id=${id}::uuid AND driver_id=${driverId}::uuid FOR UPDATE`;
      else
        await db.$queryRaw`SELECT id FROM vehicles WHERE id=${id}::uuid AND driver_id=${driverId}::uuid FOR UPDATE`;
      return action(db);
    });
  }
  private vehicleRequirements(category: string): readonly string[] {
    const configured = this.config.onboarding.requiredVehicleDocumentsByCategory;
    return configured
      ? (configured[category] ?? [])
      : this.config.onboarding.requiredVehicleDocuments;
  }
  private profileDetails(driver: {
    profileName: string | null;
    email: string | null;
    dateOfBirth: Date | null;
    gender: string | null;
    residentialAddress: string | null;
    city: string | null;
    state: string | null;
    pinCode: string | null;
    profileVersion: number;
    drivingLicenseLast4: string | null;
    licenceExpiresOn: Date | null;
    licenceVehicleClasses: string[];
  }) {
    const age = driver.dateOfBirth ? ageOn(driver.dateOfBirth) : null;
    const missing = PROFILE_FIELDS.filter(
      (field) => !(field === 'name' ? driver.profileName : driver[field]),
    );
    return {
      name: driver.profileName,
      email: driver.email,
      dateOfBirth: driver.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: driver.gender,
      residentialAddress: driver.residentialAddress,
      city: driver.city,
      state: driver.state,
      pinCode: driver.pinCode,
      version: driver.profileVersion,
      detailsComplete: missing.length === 0,
      missingFields: missing,
      age,
      minimumAge: this.config.onboarding.minimumAge ?? null,
      ageEligible:
        age === null || !this.config.onboarding.minimumAge
          ? null
          : age >= this.config.onboarding.minimumAge,
      licenceLast4: driver.drivingLicenseLast4,
      licenceExpiresOn: driver.licenceExpiresOn?.toISOString().slice(0, 10) ?? null,
      licenceVehicleClasses: driver.licenceVehicleClasses,
    };
  }
  private requiredSatisfied(
    documents: readonly { documentType: string; status: string; version: number }[],
    required: readonly string[],
  ): boolean {
    if (required.length === 0) return false;
    const latest = new Map<string, { status: string; version: number }>();
    for (const document of documents)
      if (
        !latest.has(document.documentType) ||
        latest.get(document.documentType)!.version < document.version
      )
        latest.set(document.documentType, document);
    return required.every((type) => latest.get(type)?.status === 'VERIFIED');
  }
  private requiredUploaded(
    documents: readonly {
      documentType: string;
      status: string;
      version: number;
      scannedAt: Date | null;
    }[],
    required: readonly string[],
  ): boolean {
    if (required.length === 0) return false;
    const latest = new Map<string, { status: string; version: number; scannedAt: Date | null }>();
    for (const document of documents)
      if (
        !latest.has(document.documentType) ||
        latest.get(document.documentType)!.version < document.version
      )
        latest.set(document.documentType, document);
    return required.every((type) => {
      const document = latest.get(type);
      return (
        document?.status === 'VERIFIED' ||
        (document?.status === 'QUARANTINED' && document.scannedAt !== null)
      );
    });
  }
  private assertAllowedDocumentType(documentType: string, required: readonly string[]): void {
    if (!required.includes(documentType))
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Document type is not accepted by the active verification policy',
      );
  }
  private publicDocument(document: {
    id: string;
    documentType: string;
    version: number;
    status: string;
    rejectionReason: string | null;
    createdAt: Date;
    uploadedAt?: Date | null;
    scannedAt?: Date | null;
    reviewedAt?: Date | null;
  }) {
    return {
      id: document.id,
      documentType: document.documentType,
      version: document.version,
      status: document.status,
      rejectionReason: document.rejectionReason,
      createdAt: document.createdAt,
      uploadedAt: document.uploadedAt ?? null,
      scannedAt: document.scannedAt ?? null,
      reviewedAt: document.reviewedAt ?? null,
    };
  }
  private publicKyc(application: {
    id: string;
    provider: string;
    status: string;
    rejectionReason: string | null;
    expiresAt: Date | null;
    verifiedAt: Date | null;
    policyVersion: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: application.id,
      provider: application.provider,
      status: application.status,
      rejectionReason: application.rejectionReason,
      expiresAt: application.expiresAt,
      verifiedAt: application.verifiedAt,
      policyVersion: application.policyVersion,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    };
  }

  async summary(principal: Principal) {
    const driverId = this.driver(principal);
    const driver = await this.prisma.driver.findUniqueOrThrow({
      where: { id: driverId },
      include: {
        user: true,
        kycApplications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            provider: true,
            status: true,
            rejectionReason: true,
            expiresAt: true,
            verifiedAt: true,
            policyVersion: true,
            createdAt: true,
            updatedAt: true,
            documents: {
              select: {
                id: true,
                documentType: true,
                version: true,
                status: true,
                rejectionReason: true,
                createdAt: true,
                uploadedAt: true,
                scannedAt: true,
                reviewedAt: true,
              },
            },
          },
        },
        vehicles: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            category: true,
            registrationNumber: true,
            makeModel: true,
            status: true,
            active: true,
            verifiedAt: true,
            rejectionReason: true,
            createdAt: true,
            updatedAt: true,
            documents: {
              select: {
                id: true,
                documentType: true,
                version: true,
                status: true,
                rejectionReason: true,
                createdAt: true,
                uploadedAt: true,
                scannedAt: true,
                reviewedAt: true,
              },
            },
          },
        },
      },
    });
    const kyc = driver.kycApplications[0] ?? null;
    const latestDecision = await this.prisma.adminAction.findFirst({
      where: { targetType: 'DRIVER', targetId: driverId },
      orderBy: { createdAt: 'desc' },
      select: { action: true, reason: true, createdAt: true },
    });
    const activeVehicle = driver.vehicles.find((vehicle) => vehicle.active) ?? null;
    const eligibility = await this.eligibility(driverId);
    const next = eligibility.eligible
      ? 'APPROVED'
      : !(driver.profileVersion === 2
            ? this.profileDetails(driver).detailsComplete
            : !!driver.profileName)
        ? 'PROFILE'
        : !kyc ||
            ['PENDING', 'REJECTED', 'NEEDS_CORRECTION', 'PROVIDER_UNAVAILABLE', 'EXPIRED'].includes(
              kyc.status,
            )
          ? 'KYC'
          : kyc.status !== 'VERIFIED'
            ? 'KYC_REVIEW'
            : !activeVehicle
              ? 'VEHICLE'
              : activeVehicle.status !== 'VERIFIED'
                ? 'VEHICLE_REVIEW'
                : 'FINAL_REVIEW';
    return {
      driverId,
      approvalStatus: driver.approvalStatus,
      profileComplete:
        driver.profileVersion === 2
          ? this.profileDetails(driver).detailsComplete
          : !!driver.profileName,
      profileName: driver.profileName,
      profile: { ...this.profileDetails(driver), phone: driver.user.phone },
      availableVehicleCategories: VEHICLE_CATEGORIES,
      selectedVehicleCategory: driver.selectedVehicleCategory,
      capabilities: {
        manualKycEnabled: this.config.manualKyc.enabled,
        documentUploadsEnabled: !!this.config.documents.storage && !!this.config.documents.scanner,
        maxDocumentBytes: this.config.documents.maxBytes,
        allowedContentTypes: this.config.documents.allowedContentTypes,
        licenceNumberEnabled: !!this.config.onboarding.identityEncryptionKey,
      },
      kyc,
      vehicles: driver.vehicles,
      activeVehicle,
      eligible: eligibility.eligible,
      eligibilityReasons: eligibility.reasons,
      latestDecision,
      requiredDocuments: {
        kyc: this.config.manualKyc.requiredDocuments,
        vehicle: this.config.onboarding.requiredVehicleDocuments,
        vehicleByCategory: Object.fromEntries(
          VEHICLE_CATEGORIES.map((category) => [category, this.vehicleRequirements(category)]),
        ),
      },
      next,
    };
  }

  async updateProfile(principal: Principal, input: string | UpdateDriverProfileRequest) {
    const driverId = this.driver(principal);
    const body = typeof input === 'string' ? { name: input } : input;
    const normalized = body.name.trim().replace(/\s+/g, ' ');
    if (normalized.length < 2)
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Enter your full name');
    if (
      body.profileVersion !== 2 &&
      Object.entries(body).some(([key, value]) => key !== 'name' && value !== undefined)
    )
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Detailed profiles require profileVersion 2',
      );
    const dateOfBirth = body.dateOfBirth ? validBirthDate(body.dateOfBirth) : undefined;
    if (body.profileVersion === 2 && PROFILE_FIELDS.some((field) => !body[field]?.trim()))
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Complete all required profile fields');
    if (
      body.profileVersion === 2 &&
      ((body.city?.trim().length ?? 0) < 2 ||
        (body.state?.trim().length ?? 0) < 2 ||
        (body.residentialAddress?.trim().length ?? 0) < 5)
    )
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Enter a complete residential address, city and state',
      );
    const licenceExpiresOn = body.licenceExpiresOn
      ? calendarDate(body.licenceExpiresOn)
      : undefined;
    if (licenceExpiresOn && licenceExpiresOn <= new Date())
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Licence expiry must be in the future');
    if (body.drivingLicenseNumber && !this.config.onboarding.identityEncryptionKey)
      throw new AppError(
        ErrorCode.KYC_PROVIDER_UNAVAILABLE,
        503,
        'Protected licence collection is unavailable',
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM drivers WHERE id=${driverId}::uuid FOR UPDATE`;
      await this.assertSubmissionAllowed(driverId);
      const current = await tx.driver.findUniqueOrThrow({ where: { id: driverId } });
      const kyc = await tx.kycApplication.findFirst({
        where: { driverId },
        orderBy: { createdAt: 'desc' },
      });
      if (
        current.approvalStatus === 'APPROVED' ||
        ['IN_REVIEW', 'VERIFIED'].includes(kyc?.status ?? '')
      )
        return this.conflict(
          ErrorCode.KYC_INVALID_STATE,
          'Profile is locked during or after verification; request a correction',
        );
      const saved = await tx.driver.update({
        where: { id: driverId },
        data: {
          profileName: normalized,
          ...(body.profileVersion === 2
            ? {
                profileVersion: 2,
                dateOfBirth,
                email: body.email?.trim().toLowerCase(),
                gender: body.gender,
                residentialAddress: body.residentialAddress?.trim(),
                city: body.city?.trim(),
                state: body.state?.trim(),
                pinCode: body.pinCode,
                licenceExpiresOn,
                licenceVehicleClasses: body.licenceVehicleClasses,
                ...(body.drivingLicenseNumber
                  ? {
                      drivingLicenseCiphertext: encryptLicence(
                        body.drivingLicenseNumber.trim().toUpperCase(),
                        this.config.onboarding.identityEncryptionKey!,
                        driverId,
                      ),
                      drivingLicenseLast4: body.drivingLicenseNumber.trim().slice(-4),
                    }
                  : {}),
              }
            : {}),
        },
        select: { id: true, profileName: true, updatedAt: true },
      });
      return { ...saved, saved: true };
    });
  }

  async saveVehicleCategory(principal: Principal, category: string) {
    const driverId = this.driver(principal);
    if (!(VEHICLE_CATEGORIES as readonly string[]).includes(category))
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Invalid vehicle category');
    await this.assertSubmissionAllowed(driverId);
    // A preference only: never mutates an existing/approved vehicle or eligibility.
    await this.prisma.driver.update({
      where: { id: driverId },
      data: { selectedVehicleCategory: category },
    });
    return { selectedVehicleCategory: category };
  }

  async startKyc(principal: Principal) {
    const driverId = this.driver(principal);
    await this.assertSubmissionAllowed(driverId);
    let existing = await this.prisma.kycApplication.findFirst({
      where: { driverId, status: { in: [...OPEN_KYC] } },
      orderBy: { createdAt: 'desc' },
      include: { documents: true },
    });
    if (existing?.status === 'PROVIDER_UNAVAILABLE' && this.config.manualKyc.enabled) {
      await this.prisma.kycApplication.update({
        where: { id: existing.id },
        data: {
          status: 'NEEDS_CORRECTION',
          rejectionReason: 'Verification became available; restart submission',
        },
      });
      existing = null;
    }
    if (existing) {
      if (existing.status === 'PROVIDER_UNAVAILABLE')
        throw new AppError(
          ErrorCode.KYC_PROVIDER_UNAVAILABLE,
          HttpStatus.SERVICE_UNAVAILABLE,
          'Identity verification is not configured',
        );
      return this.publicKyc(existing);
    }
    if (!this.config.manualKyc.enabled || !this.config.manualKyc.policyVersion) {
      try {
        await this.prisma.kycApplication.create({
          data: { driverId, provider: 'UNCONFIGURED', status: 'PROVIDER_UNAVAILABLE' },
        });
      } catch (error: unknown) {
        if (!(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ))
          throw error;
      }
      throw new AppError(
        ErrorCode.KYC_PROVIDER_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Identity verification is not configured',
      );
    }
    try {
      return this.publicKyc(
        await this.prisma.kycApplication.create({
          data: {
            driverId,
            provider: 'MANUAL_ADMIN_VERIFICATION',
            status: 'PENDING',
            policyVersion: this.config.manualKyc.policyVersion,
          },
        }),
      );
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ))
        throw error;
      return this.publicKyc(
        await this.prisma.kycApplication.findFirstOrThrow({
          where: { driverId, status: { in: [...OPEN_KYC] } },
        }),
      );
    }
  }

  async submitKyc(principal: Principal, applicationId: string) {
    return this.withOnboardingLock(principal, 'KYC', applicationId, (db) =>
      this.submitKycIn(principal, applicationId, db),
    );
  }
  private async submitKycIn(principal: Principal, applicationId: string, db: Tx) {
    const driverId = this.driver(principal);
    await this.assertSubmissionAllowed(driverId, db);
    if (!this.config.manualKyc.enabled)
      throw new AppError(
        ErrorCode.KYC_PROVIDER_UNAVAILABLE,
        503,
        'Manual identity verification is unavailable',
      );
    const application = await db.kycApplication.findFirst({
      where: { id: applicationId, driverId },
      include: { documents: true },
    });
    if (!application)
      throw new AppError(
        ErrorCode.KYC_APPLICATION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'KYC application not found',
      );
    if (!['PENDING', 'NEEDS_CORRECTION'].includes(application.status))
      return this.conflict(ErrorCode.KYC_INVALID_STATE, 'KYC application cannot be submitted now');
    if (!this.requiredUploaded(application.documents, this.config.manualKyc.requiredDocuments))
      return this.conflict(
        ErrorCode.KYC_INVALID_STATE,
        'All required KYC documents must be uploaded and scanned',
      );
    return this.publicKyc(
      await db.kycApplication.update({
        where: { id: applicationId },
        data: { status: 'IN_REVIEW', rejectionReason: null },
      }),
    );
  }

  private async descriptorForKyc(
    principal: Principal,
    applicationId: string,
    input: CreateDocumentRequest,
    db: Tx,
  ) {
    if (!this.config.manualKyc.enabled)
      throw new AppError(
        ErrorCode.KYC_PROVIDER_UNAVAILABLE,
        503,
        'Manual identity verification is unavailable',
      );
    this.storage.assertInput(input.contentType, input.sizeBytes);
    this.storage.assertOperational();
    this.assertAllowedDocumentType(input.documentType, this.config.manualKyc.requiredDocuments);
    const driverId = this.driver(principal);
    await this.assertSubmissionAllowed(driverId, db);
    const application = await db.kycApplication.findFirst({
      where: { id: applicationId, driverId, status: { in: ['PENDING', 'NEEDS_CORRECTION'] } },
    });
    if (!application)
      throw new AppError(
        ErrorCode.KYC_APPLICATION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Editable KYC application not found',
      );
    const latest = await db.kycDocument.findFirst({
      where: { applicationId, documentType: input.documentType },
      orderBy: { version: 'desc' },
    });
    if (
      latest &&
      ['UPLOADING', 'SCAN_FAILED', 'STORAGE_UNAVAILABLE'].includes(latest.status) &&
      latest.contentType === input.contentType &&
      latest.sizeBytes === input.sizeBytes
    ) {
      const document =
        latest.status === 'UPLOADING'
          ? latest
          : await db.kycDocument.update({
              where: { id: latest.id },
              data: {
                status: 'UPLOADING',
                checksumSha256: null,
                storageVersionId: null,
                storageETag: null,
                guardDutyScanEventId: null,
                uploadedAt: null,
                scannedAt: null,
                rejectionReason: null,
              },
            });
      return {
        document,
        descriptor: {
          key: document.storageKey,
          contentType: document.contentType,
          sizeBytes: document.sizeBytes,
          documentId: document.id,
        } satisfies UploadDescriptor,
      };
    }
    const id = randomUUID();
    const key = `onboarding/kyc/${driverId}/${applicationId}/${id}`;
    const document = await db.kycDocument.create({
      data: {
        id,
        applicationId,
        documentType: input.documentType,
        version: (latest?.version ?? 0) + 1,
        storageKey: key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        status: 'UPLOADING',
      },
    });
    return {
      document,
      descriptor: {
        key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        documentId: id,
      } satisfies UploadDescriptor,
    };
  }
  async initiateKycDocument(
    principal: Principal,
    applicationId: string,
    input: CreateDocumentRequest,
  ) {
    const { document, descriptor } = await this.withOnboardingLock(
      principal,
      'KYC',
      applicationId,
      (db) => this.descriptorForKyc(principal, applicationId, input, db),
    );
    return {
      document: this.publicDocument(document),
      upload: await this.storage.uploadUrl(descriptor),
    };
  }
  async completeKycDocument(principal: Principal, applicationId: string, documentId: string) {
    const driverId = this.driver(principal);
    await this.assertSubmissionAllowed(driverId);
    const row = await this.prisma.kycDocument.findFirst({
      where: { id: documentId, applicationId, application: { driverId } },
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, 'Document not found');
    if (row.status !== 'UPLOADING') {
      if (this.storage.isGuardDutyScanner() && row.storageVersionId)
        await this.guardDuty?.reconcilePendingObject(row.storageKey, row.storageVersionId);
      return this.publicDocument(
        await this.prisma.kycDocument.findUniqueOrThrow({ where: { id: row.id } }),
      );
    }
    const descriptor = {
      key: row.storageKey,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      documentId: row.id,
    };
    const verified = await this.storage.verifyUpload(descriptor);
    const storedDescriptor: StoredDocumentDescriptor = { ...descriptor, ...verified };
    const recorded = await this.withOnboardingLock(principal, 'KYC', applicationId, async (db) => {
      const parent = await db.kycApplication.findFirst({
        where: { id: applicationId, driverId, status: { in: ['PENDING', 'NEEDS_CORRECTION'] } },
      });
      if (!parent)
        return this.conflict(ErrorCode.KYC_INVALID_STATE, 'KYC application is not editable');
      const updated = await db.kycDocument.updateMany({
        where: { id: row.id, status: 'UPLOADING' },
        data: {
          status: 'QUARANTINED',
          checksumSha256: verified.checksumSha256,
          storageVersionId: verified.storageVersionId,
          storageETag: verified.storageETag,
          uploadedAt: new Date(),
        },
      });
      return updated.count === 1;
    });
    if (!recorded)
      return this.publicDocument(
        await this.prisma.kycDocument.findUniqueOrThrow({ where: { id: row.id } }),
      );
    // GuardDuty produces the authoritative scan result asynchronously through EventBridge. The
    // object remains quarantined here; it is never treated as uploaded-and-clean locally.
    if (this.storage.isGuardDutyScanner()) {
      await this.guardDuty?.reconcilePendingObject(row.storageKey, verified.storageVersionId);
      return this.publicDocument(
        await this.prisma.kycDocument.findUniqueOrThrow({ where: { id: row.id } }),
      );
    }
    try {
      const scan = await this.storage.scan(storedDescriptor);
      return this.publicDocument(
        await this.prisma.kycDocument.update({
          where: { id: row.id },
          data:
            scan === 'CLEAN'
              ? { status: 'QUARANTINED', scannedAt: new Date() }
              : {
                  status: 'REJECTED',
                  scannedAt: new Date(),
                  rejectionReason: 'Malware scan rejected this file',
                },
        }),
      );
    } catch (error) {
      await this.prisma.kycDocument.update({
        where: { id: row.id },
        data: { status: 'SCAN_FAILED', rejectionReason: 'Document scanning failed' },
      });
      throw error;
    }
  }

  async createVehicle(principal: Principal, input: CreateVehicleRequest) {
    const driverId = this.driver(principal);
    await this.assertSubmissionAllowed(driverId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM drivers WHERE id=${driverId}::uuid FOR UPDATE`;
      await this.assertSubmissionAllowed(driverId, tx);
      const active = await tx.vehicle.findFirst({ where: { driverId, active: true } });
      if (active)
        return this.conflict(
          ErrorCode.VEHICLE_CHANGE_REQUIRES_REVERIFICATION,
          'An approved vehicle must be changed through the replacement workflow',
        );
      const open = await tx.vehicle.findFirst({
        where: { driverId, status: { in: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'REJECTED'] } },
      });
      if (open)
        return this.conflict(
          ErrorCode.VEHICLE_INVALID_STATE,
          'An onboarding vehicle already exists',
        );
      return tx.vehicle.create({
        data: {
          driverId,
          category: input.category,
          registrationNumber: input.registrationNumber.trim().toUpperCase().replace(/\s+/g, ''),
          makeModel: input.makeModel.trim(),
        },
      });
    });
  }
  async updateVehicle(principal: Principal, vehicleId: string, input: CreateVehicleRequest) {
    return this.withOnboardingLock(principal, 'VEHICLE', vehicleId, (db) =>
      this.updateVehicleIn(principal, vehicleId, input, db),
    );
  }
  private async updateVehicleIn(
    principal: Principal,
    vehicleId: string,
    input: CreateVehicleRequest,
    db: Tx,
  ) {
    const driverId = this.driver(principal);
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, driverId } });
    if (!vehicle)
      throw new AppError(ErrorCode.VEHICLE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Vehicle not found');
    if (vehicle.active || vehicle.status === 'VERIFIED')
      throw new AppError(
        ErrorCode.VEHICLE_CHANGE_REQUIRES_REVERIFICATION,
        HttpStatus.CONFLICT,
        'Verified vehicle changes require replacement and reverification',
      );
    if (!(EDITABLE_VEHICLE as readonly string[]).includes(vehicle.status))
      return this.conflict(ErrorCode.VEHICLE_INVALID_STATE, 'Vehicle cannot be edited now');
    return db.vehicle.update({
      where: { id: vehicleId },
      data: {
        category: input.category,
        registrationNumber: input.registrationNumber.trim().toUpperCase().replace(/\s+/g, ''),
        makeModel: input.makeModel.trim(),
      },
    });
  }
  async submitVehicle(principal: Principal, vehicleId: string) {
    return this.withOnboardingLock(principal, 'VEHICLE', vehicleId, (db) =>
      this.submitVehicleIn(principal, vehicleId, db),
    );
  }
  private async submitVehicleIn(principal: Principal, vehicleId: string, db: Tx) {
    const driverId = this.driver(principal);
    await this.assertSubmissionAllowed(driverId, db);
    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, driverId },
      include: { documents: true },
    });
    if (!vehicle)
      throw new AppError(ErrorCode.VEHICLE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Vehicle not found');
    if (!(EDITABLE_VEHICLE as readonly string[]).includes(vehicle.status))
      return this.conflict(ErrorCode.VEHICLE_INVALID_STATE, 'Vehicle cannot be submitted now');
    const latest = new Map<string, { status: string; scannedAt: Date | null }>();
    for (const document of vehicle.documents.sort((a, b) => b.version - a.version))
      if (!latest.has(document.documentType))
        latest.set(document.documentType, {
          status: document.status,
          scannedAt: document.scannedAt,
        });
    if (
      this.vehicleRequirements(vehicle.category).length === 0 ||
      !this.vehicleRequirements(vehicle.category).every(
        (type) =>
          latest.get(type)?.status === 'VERIFIED' ||
          (latest.get(type)?.status === 'QUARANTINED' && latest.get(type)?.scannedAt !== null),
      )
    )
      return this.conflict(
        ErrorCode.VEHICLE_INVALID_STATE,
        'All required vehicle documents must be uploaded and scanned',
      );
    return db.vehicle.update({
      where: { id: vehicleId },
      data: { status: 'SUBMITTED', rejectionReason: null },
    });
  }
  async initiateVehicleDocument(
    principal: Principal,
    vehicleId: string,
    input: CreateDocumentRequest,
  ) {
    return this.withOnboardingLock(principal, 'VEHICLE', vehicleId, (db) =>
      this.initiateVehicleDocumentIn(principal, vehicleId, input, db),
    );
  }
  private async initiateVehicleDocumentIn(
    principal: Principal,
    vehicleId: string,
    input: CreateDocumentRequest,
    db: Tx,
  ) {
    this.storage.assertInput(input.contentType, input.sizeBytes);
    this.storage.assertOperational();
    const driverId = this.driver(principal);
    await this.assertSubmissionAllowed(driverId, db);
    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, driverId, status: { in: ['DRAFT', 'REJECTED'] } },
    });
    if (!vehicle)
      throw new AppError(
        ErrorCode.VEHICLE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Editable vehicle not found',
      );
    this.assertAllowedDocumentType(input.documentType, this.vehicleRequirements(vehicle.category));
    const latest = await db.vehicleDocument.findFirst({
      where: { vehicleId, documentType: input.documentType },
      orderBy: { version: 'desc' },
    });
    if (
      latest &&
      latest.storageKey &&
      latest.contentType &&
      latest.sizeBytes &&
      ['UPLOADING', 'SCAN_FAILED', 'STORAGE_UNAVAILABLE'].includes(latest.status) &&
      latest.contentType === input.contentType &&
      latest.sizeBytes === input.sizeBytes
    ) {
      const document =
        latest.status === 'UPLOADING'
          ? latest
          : await db.vehicleDocument.update({
              where: { id: latest.id },
              data: {
                status: 'UPLOADING',
                checksumSha256: null,
                storageVersionId: null,
                storageETag: null,
                guardDutyScanEventId: null,
                uploadedAt: null,
                scannedAt: null,
                rejectionReason: null,
              },
            });
      return {
        document: this.publicDocument(document),
        upload: await this.storage.uploadUrl({
          key: document.storageKey!,
          contentType: document.contentType!,
          sizeBytes: document.sizeBytes!,
          documentId: document.id,
        }),
      };
    }
    const id = randomUUID();
    const key = `onboarding/vehicle/${driverId}/${vehicleId}/${id}`;
    const document = await db.vehicleDocument.create({
      data: {
        id,
        vehicleId,
        documentType: input.documentType,
        version: (latest?.version ?? 0) + 1,
        storageKey: key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        status: 'UPLOADING',
      },
    });
    return {
      document: this.publicDocument(document),
      upload: await this.storage.uploadUrl({
        key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        documentId: id,
      }),
    };
  }
  async completeVehicleDocument(principal: Principal, vehicleId: string, documentId: string) {
    const driverId = this.driver(principal);
    await this.assertSubmissionAllowed(driverId);
    const row = await this.prisma.vehicleDocument.findFirst({
      where: { id: documentId, vehicleId, vehicle: { driverId } },
    });
    if (!row || !row.storageKey || !row.contentType || !row.sizeBytes)
      throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, 'Document not found');
    if (row.status !== 'UPLOADING') {
      if (this.storage.isGuardDutyScanner() && row.storageVersionId)
        await this.guardDuty?.reconcilePendingObject(row.storageKey, row.storageVersionId);
      return this.publicDocument(
        await this.prisma.vehicleDocument.findUniqueOrThrow({ where: { id: row.id } }),
      );
    }
    const descriptor = {
      key: row.storageKey,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      documentId: row.id,
    };
    const verified = await this.storage.verifyUpload(descriptor);
    const storedDescriptor: StoredDocumentDescriptor = { ...descriptor, ...verified };
    const recorded = await this.withOnboardingLock(principal, 'VEHICLE', vehicleId, async (db) => {
      const parent = await db.vehicle.findFirst({
        where: { id: vehicleId, driverId, status: { in: ['DRAFT', 'REJECTED'] } },
      });
      if (!parent) return this.conflict(ErrorCode.VEHICLE_INVALID_STATE, 'Vehicle is not editable');
      const updated = await db.vehicleDocument.updateMany({
        where: { id: row.id, status: 'UPLOADING' },
        data: {
          status: 'QUARANTINED',
          checksumSha256: verified.checksumSha256,
          storageVersionId: verified.storageVersionId,
          storageETag: verified.storageETag,
          uploadedAt: new Date(),
        },
      });
      return updated.count === 1;
    });
    if (!recorded)
      return this.publicDocument(
        await this.prisma.vehicleDocument.findUniqueOrThrow({ where: { id: row.id } }),
      );
    if (this.storage.isGuardDutyScanner()) {
      await this.guardDuty?.reconcilePendingObject(row.storageKey, verified.storageVersionId);
      return this.publicDocument(
        await this.prisma.vehicleDocument.findUniqueOrThrow({ where: { id: row.id } }),
      );
    }
    try {
      const scan = await this.storage.scan(storedDescriptor);
      return this.publicDocument(
        await this.prisma.vehicleDocument.update({
          where: { id: row.id },
          data:
            scan === 'CLEAN'
              ? { status: 'QUARANTINED', scannedAt: new Date() }
              : {
                  status: 'REJECTED',
                  scannedAt: new Date(),
                  rejectionReason: 'Malware scan rejected this file',
                },
        }),
      );
    } catch (error) {
      await this.prisma.vehicleDocument.update({
        where: { id: row.id },
        data: { status: 'SCAN_FAILED', rejectionReason: 'Document scanning failed' },
      });
      throw error;
    }
  }

  async requestReplacement(principal: Principal, input: ReplacementVehicleRequest) {
    const driverId = this.driver(principal);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM drivers WHERE id=${driverId}::uuid FOR UPDATE`;
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: driverId },
        include: { user: true },
      });
      if (driver.user.status !== 'ACTIVE' || driver.approvalStatus !== 'APPROVED')
        return this.conflict(
          ErrorCode.DRIVER_NOT_ELIGIBLE,
          'Only an active approved driver can replace a vehicle',
        );
      const current = await tx.vehicle.findFirst({
        where: { driverId, active: true, status: 'VERIFIED' },
        include: { documents: true },
      });
      const kyc = await tx.kycApplication.findFirst({
        where: { driverId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (
        !current ||
        !kyc ||
        kyc.status !== 'VERIFIED' ||
        (kyc.expiresAt && kyc.expiresAt <= new Date()) ||
        !this.requiredSatisfied(current.documents, this.vehicleRequirements(current.category))
      )
        return this.conflict(
          ErrorCode.DRIVER_NOT_ELIGIBLE,
          'Driver eligibility must be current before replacing a vehicle',
        );
      const pending = await tx.vehicleChangeRequest.findFirst({
        where: { driverId, status: 'PENDING' },
      });
      if (pending)
        throw new AppError(
          ErrorCode.VEHICLE_CHANGE_PENDING,
          HttpStatus.CONFLICT,
          'A vehicle replacement is already pending',
          { requestId: pending.id },
        );
      const replacement = await tx.vehicle.create({
        data: {
          driverId,
          category: input.category,
          registrationNumber: input.registrationNumber.trim().toUpperCase().replace(/\s+/g, ''),
          makeModel: input.makeModel.trim(),
        },
      });
      const request = await tx.vehicleChangeRequest.create({
        data: {
          driverId,
          currentVehicleId: current.id,
          replacementVehicleId: replacement.id,
          reason: input.reason,
        },
      });
      return { request, replacement };
    });
  }

  /**
   * Reads the complete backend eligibility contract from the supplied database snapshot.
   * Assignment uses this with its booking transaction so a suspension, KYC expiry or vehicle
   * revocation cannot be separated from creation of a new backend trip by a stale read.
   */
  async eligibilityIn(driverId: string, db: PrismaService | Tx = this.prisma) {
    const now = new Date();
    const driver = await db.driver.findUnique({
      where: { id: driverId },
      include: {
        user: true,
        kycApplications: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        vehicles: { where: { active: true }, include: { documents: true } },
      },
    });
    if (!driver)
      throw new AppError(ErrorCode.DRIVER_NOT_FOUND, HttpStatus.NOT_FOUND, 'Driver not found');
    const kyc = driver.kycApplications[0];
    const vehicle = driver.vehicles[0];
    const reasons: string[] = [];
    if (driver.user.status !== 'ACTIVE') reasons.push('USER_INACTIVE');
    if (
      driver.approvalStatus !== 'APPROVED' ||
      !driver.approvedAt ||
      !kyc?.verifiedAt ||
      driver.approvedAt < kyc.verifiedAt ||
      !vehicle?.verifiedAt ||
      driver.approvedAt < vehicle.verifiedAt
    )
      reasons.push('DRIVER_NOT_APPROVED');
    if (!kyc || kyc.status !== 'VERIFIED' || (kyc.expiresAt && kyc.expiresAt <= now))
      reasons.push('KYC_NOT_VERIFIED');
    if (!vehicle || vehicle.status !== 'VERIFIED') reasons.push('ACTIVE_VEHICLE_NOT_VERIFIED');
    if (
      driver.profileVersion === 2 &&
      (!this.profileDetails(driver).detailsComplete ||
        this.profileDetails(driver).ageEligible !== true ||
        (driver.licenceExpiresOn && driver.licenceExpiresOn <= now))
    )
      reasons.push('PROFILE_REQUIREMENTS_NOT_MET');
    if (
      !vehicle ||
      !this.requiredSatisfied(vehicle.documents, this.vehicleRequirements(vehicle.category))
    )
      reasons.push('VEHICLE_DOCUMENTS_NOT_VERIFIED');
    return {
      driverId,
      eligible: reasons.length === 0,
      reasons,
      vehicleId: vehicle?.id ?? null,
      checkedAt: now.toISOString(),
    };
  }

  async eligibility(driverId: string) {
    return this.eligibilityIn(driverId);
  }

  /**
   * Internal engine adapter: resolve the backend driver's UUID from the Firebase subject that
   * the engine obtained from a verified token. This closes the identity-mapping gap without
   * trusting a mobile-supplied driver UUID or duplicating eligibility rules in the engine.
   */
  async eligibilityForSubject(subject: string) {
    const identity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_subject: { provider: this.config.auth.provider, subject },
      },
      select: {
        subject: true,
        user: { select: { role: true, driver: { select: { id: true } } } },
      },
    });
    if (!identity || identity.user.role !== 'DRIVER' || !identity.user.driver) {
      throw new AppError(ErrorCode.DRIVER_NOT_FOUND, HttpStatus.NOT_FOUND, 'Driver not found');
    }
    return {
      ...(await this.eligibility(identity.user.driver.id)),
      subject: identity.subject,
    };
  }

  async adminReviewQueue(
    approvalStatus: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | undefined,
    limit: number,
  ) {
    return this.prisma.driver.findMany({
      where: approvalStatus ? { approvalStatus } : undefined,
      take: limit,
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        profileName: true,
        legalName: true,
        approvalStatus: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { phone: true, status: true } },
        kycApplications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            provider: true,
            status: true,
            rejectionReason: true,
            policyVersion: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        vehicles: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            category: true,
            registrationNumber: true,
            makeModel: true,
            status: true,
            active: true,
            rejectionReason: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }
  async adminDriverReview(driverId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        profileName: true,
        profileVersion: true,
        email: true,
        dateOfBirth: true,
        gender: true,
        residentialAddress: true,
        city: true,
        state: true,
        pinCode: true,
        drivingLicenseLast4: true,
        licenceExpiresOn: true,
        licenceVehicleClasses: true,
        legalName: true,
        approvalStatus: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { phone: true, status: true } },
        kycApplications: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            provider: true,
            status: true,
            rejectionReason: true,
            expiresAt: true,
            verifiedAt: true,
            reviewedAt: true,
            policyVersion: true,
            verificationChecklist: true,
            createdAt: true,
            updatedAt: true,
            documents: {
              orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
              select: {
                id: true,
                documentType: true,
                version: true,
                contentType: true,
                sizeBytes: true,
                status: true,
                rejectionReason: true,
                uploadedAt: true,
                scannedAt: true,
                reviewedAt: true,
                createdAt: true,
              },
            },
          },
        },
        vehicles: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            category: true,
            registrationNumber: true,
            makeModel: true,
            status: true,
            active: true,
            rejectionReason: true,
            verifiedAt: true,
            reviewedAt: true,
            createdAt: true,
            updatedAt: true,
            documents: {
              orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
              select: {
                id: true,
                documentType: true,
                version: true,
                contentType: true,
                sizeBytes: true,
                status: true,
                rejectionReason: true,
                uploadedAt: true,
                scannedAt: true,
                reviewedAt: true,
                createdAt: true,
              },
            },
          },
        },
        vehicleChangeRequests: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            currentVehicleId: true,
            replacementVehicleId: true,
            status: true,
            reason: true,
            createdAt: true,
            resolvedAt: true,
          },
        },
      },
    });
    if (!driver)
      throw new AppError(ErrorCode.DRIVER_NOT_FOUND, HttpStatus.NOT_FOUND, 'Driver not found');
    const actions = await this.prisma.adminAction.findMany({
      where: {
        OR: [
          { targetType: 'DRIVER', targetId: driverId },
          { details: { path: ['driverId'], equals: driverId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        actorUserId: true,
        action: true,
        targetType: true,
        targetId: true,
        reason: true,
        details: true,
        createdAt: true,
      },
    });
    return {
      ...driver,
      profile: this.profileDetails(driver),
      auditTrail: actions,
      reviewPolicy: {
        enabled: this.config.manualKyc.enabled,
        version: this.config.manualKyc.policyVersion,
        checklist: this.config.manualKyc.checklist,
        requiredKycDocuments: this.config.manualKyc.requiredDocuments,
        requiredVehicleDocumentsByCategory: Object.fromEntries(
          VEHICLE_CATEGORIES.map((category) => [category, this.vehicleRequirements(category)]),
        ),
      },
    };
  }

  async reviewKyc(
    admin: Principal,
    applicationId: string,
    decision: 'REJECTED' | 'NEEDS_CORRECTION',
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      let application = await tx.kycApplication.findUnique({ where: { id: applicationId } });
      if (!application)
        return this.conflict(ErrorCode.KYC_INVALID_STATE, 'KYC application is not reviewable');
      await tx.$queryRaw`SELECT id FROM drivers WHERE id=${application.driverId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM kyc_applications WHERE id=${applicationId}::uuid FOR UPDATE`;
      application = await tx.kycApplication.findUniqueOrThrow({ where: { id: applicationId } });
      const updated = await tx.kycApplication.updateMany({
        where: { id: applicationId, status: { in: ['PENDING', 'IN_REVIEW', 'VERIFIED'] } },
        data: {
          status: decision,
          rejectionReason: reason,
          reviewedAt: new Date(),
          reviewedByUserId: admin.userId,
        },
      });
      if (updated.count !== 1)
        return this.conflict(ErrorCode.KYC_INVALID_STATE, 'KYC application is not reviewable');
      const driver = await tx.driver.findUnique({
        where: { id: application.driverId },
        select: { approvalStatus: true },
      });
      if (driver?.approvalStatus === 'APPROVED')
        await tx.$executeRaw`SELECT admin_set_driver_status(${application.driverId}::uuid,${'PENDING'},${admin.userId}::uuid,${reason})`;
      await tx.adminAction.create({
        data: {
          actorUserId: admin.userId,
          action: `KYC_${decision}`,
          targetType: 'KYC_APPLICATION',
          targetId: applicationId,
          reason,
          details: {
            driverId: application.driverId,
            previousStatus: application.status,
            policyVersion: this.config.manualKyc.policyVersion,
          },
        },
      });
      return tx.kycApplication.findUniqueOrThrow({ where: { id: applicationId } });
    });
  }
  async reviewDocument(
    admin: Principal,
    kind: 'KYC' | 'VEHICLE',
    documentId: string,
    decision: 'VERIFIED' | 'REJECTED',
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      let targetDriverId: string;
      let result: unknown;
      if (kind === 'KYC') {
        const doc = await tx.kycDocument.findUnique({
          where: { id: documentId },
          include: { application: true },
        });
        if (
          !doc ||
          doc.status !== 'QUARANTINED' ||
          !doc.scannedAt ||
          doc.application.status !== 'IN_REVIEW'
        )
          return this.conflict(
            ErrorCode.KYC_INVALID_STATE,
            'Only clean submitted KYC documents can be reviewed',
          );
        targetDriverId = doc.application.driverId;
        const updated = await tx.kycDocument.updateMany({
          where: { id: documentId, status: 'QUARANTINED' },
          data: {
            status: decision,
            rejectionReason: decision === 'REJECTED' ? reason : null,
            reviewedAt: now,
            reviewedByUserId: admin.userId,
          },
        });
        if (updated.count !== 1)
          return this.conflict(ErrorCode.KYC_INVALID_STATE, 'Document was already reviewed');
        result = await tx.kycDocument.findUniqueOrThrow({ where: { id: documentId } });
      } else {
        const doc = await tx.vehicleDocument.findUnique({
          where: { id: documentId },
          include: { vehicle: true },
        });
        if (
          !doc ||
          doc.status !== 'QUARANTINED' ||
          !doc.scannedAt ||
          !['SUBMITTED', 'IN_REVIEW'].includes(doc.vehicle.status)
        )
          return this.conflict(
            ErrorCode.VEHICLE_INVALID_STATE,
            'Only clean submitted vehicle documents can be reviewed',
          );
        targetDriverId = doc.vehicle.driverId;
        const updated = await tx.vehicleDocument.updateMany({
          where: { id: documentId, status: 'QUARANTINED' },
          data: {
            status: decision,
            rejectionReason: decision === 'REJECTED' ? reason : null,
            reviewedAt: now,
            reviewedByUserId: admin.userId,
          },
        });
        if (updated.count !== 1)
          return this.conflict(ErrorCode.VEHICLE_INVALID_STATE, 'Document was already reviewed');
        result = await tx.vehicleDocument.findUniqueOrThrow({ where: { id: documentId } });
      }
      await tx.adminAction.create({
        data: {
          actorUserId: admin.userId,
          action: `${kind}_DOCUMENT_${decision}`,
          targetType: `${kind}_DOCUMENT`,
          targetId: documentId,
          reason,
          details: { driverId: targetDriverId },
        },
      });
      return result;
    });
  }
  async verifyKyc(
    admin: Principal,
    applicationId: string,
    reason: string,
    checklist: Record<string, boolean>,
    legalName: string,
  ) {
    if (!this.config.manualKyc.enabled || !this.config.manualKyc.policyVersion)
      return this.conflict(ErrorCode.KYC_INVALID_STATE, 'Manual KYC policy is disabled');
    const checklistKeys = Object.keys(checklist);
    if (
      checklistKeys.length !== this.config.manualKyc.checklist.length ||
      checklistKeys.some((item) => !this.config.manualKyc.checklist.includes(item)) ||
      !this.config.manualKyc.checklist.every((item) => checklist[item] === true)
    )
      return this.conflict(
        ErrorCode.KYC_INVALID_STATE,
        'The approved verification checklist is incomplete or invalid',
      );
    return this.prisma.$transaction(async (tx) => {
      const owner = await tx.kycApplication.findUnique({
        where: { id: applicationId },
        select: { driverId: true },
      });
      if (!owner)
        return this.conflict(ErrorCode.KYC_INVALID_STATE, 'KYC application cannot be verified');
      await tx.$queryRaw`SELECT id FROM drivers WHERE id=${owner.driverId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM kyc_applications WHERE id=${applicationId}::uuid FOR UPDATE`;
      const app = await tx.kycApplication.findUnique({
        where: { id: applicationId },
        include: { documents: true },
      });
      if (
        !app ||
        app.status !== 'IN_REVIEW' ||
        app.provider !== 'MANUAL_ADMIN_VERIFICATION' ||
        app.policyVersion !== this.config.manualKyc.policyVersion
      )
        return this.conflict(ErrorCode.KYC_INVALID_STATE, 'KYC application cannot be verified');
      if (!this.requiredSatisfied(app.documents, this.config.manualKyc.requiredDocuments))
        return this.conflict(ErrorCode.KYC_INVALID_STATE, 'Required KYC evidence is not verified');
      const now = new Date();
      const result = await tx.kycApplication.update({
        where: { id: applicationId },
        data: {
          status: 'VERIFIED',
          verifiedAt: now,
          reviewedAt: now,
          reviewedByUserId: admin.userId,
          rejectionReason: null,
          verificationChecklist: checklist,
        },
      });
      await tx.$executeRaw`SELECT admin_set_driver_legal_name_after_kyc(${app.driverId}::uuid,${applicationId}::uuid,${admin.userId}::uuid,${legalName.trim()})`;
      await tx.adminAction.create({
        data: {
          actorUserId: admin.userId,
          action: 'KYC_VERIFIED',
          targetType: 'KYC_APPLICATION',
          targetId: applicationId,
          reason,
          details: { policyVersion: this.config.manualKyc.policyVersion, checklist },
        },
      });
      return result;
    });
  }
  async reviewVehicle(
    admin: Principal,
    vehicleId: string,
    decision: 'VERIFIED' | 'REJECTED' | 'IN_REVIEW',
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const owner = await tx.vehicle.findUnique({
        where: { id: vehicleId },
        select: { driverId: true },
      });
      if (!owner)
        return this.conflict(ErrorCode.VEHICLE_INVALID_STATE, 'Vehicle is not reviewable');
      await tx.$queryRaw`SELECT id FROM drivers WHERE id=${owner.driverId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM vehicles WHERE id=${vehicleId}::uuid FOR UPDATE`;
      const vehicle = await tx.vehicle.findUnique({
        where: { id: vehicleId },
        include: { driver: { include: { user: true } }, documents: true },
      });
      if (!vehicle || !['SUBMITTED', 'IN_REVIEW'].includes(vehicle.status))
        return this.conflict(ErrorCode.VEHICLE_INVALID_STATE, 'Vehicle is not reviewable');
      if (
        decision === 'VERIFIED' &&
        !this.requiredSatisfied(vehicle.documents, this.vehicleRequirements(vehicle.category))
      )
        return this.conflict(
          ErrorCode.VEHICLE_INVALID_STATE,
          'Required vehicle documents are not verified',
        );
      const now = new Date();
      if (decision === 'VERIFIED') {
        const change = await tx.vehicleChangeRequest.findFirst({
          where: { replacementVehicleId: vehicleId, status: 'PENDING' },
        });
        if (change) {
          if (
            vehicle.driver.user.status !== 'ACTIVE' ||
            vehicle.driver.approvalStatus !== 'APPROVED'
          )
            return this.conflict(
              ErrorCode.DRIVER_NOT_ELIGIBLE,
              'Driver is not eligible for vehicle replacement',
            );
          const current = await tx.vehicle.findUnique({
            where: { id: change.currentVehicleId },
            include: { documents: true },
          });
          const kyc = await tx.kycApplication.findFirst({
            where: { driverId: vehicle.driverId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          });
          if (
            !current ||
            !current.active ||
            current.status !== 'VERIFIED' ||
            !kyc ||
            kyc.status !== 'VERIFIED' ||
            (kyc.expiresAt && kyc.expiresAt <= now) ||
            !this.requiredSatisfied(current.documents, this.vehicleRequirements(current.category))
          )
            return this.conflict(
              ErrorCode.DRIVER_NOT_ELIGIBLE,
              'Driver eligibility changed during replacement review',
            );
          await tx.vehicle.update({
            where: { id: change.currentVehicleId },
            data: { active: false, status: 'INACTIVE' },
          });
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: {
              active: true,
              status: 'VERIFIED',
              verifiedAt: now,
              reviewedAt: now,
              reviewedByUserId: admin.userId,
              rejectionReason: null,
            },
          });
          await tx.vehicleChangeRequest.update({
            where: { id: change.id },
            data: { status: 'APPROVED', resolvedAt: now },
          });
        } else {
          const active = await tx.vehicle.findFirst({
            where: { driverId: vehicle.driverId, active: true },
          });
          if (active)
            return this.conflict(
              ErrorCode.VEHICLE_CHANGE_REQUIRES_REVERIFICATION,
              'An approved vehicle can only be replaced through a vehicle change request',
            );
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: {
              active: true,
              status: 'VERIFIED',
              verifiedAt: now,
              reviewedAt: now,
              reviewedByUserId: admin.userId,
              rejectionReason: null,
            },
          });
        }
      } else
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: {
            status: decision,
            rejectionReason: decision === 'REJECTED' ? reason : null,
            reviewedAt: now,
            reviewedByUserId: admin.userId,
          },
        });
      await tx.adminAction.create({
        data: {
          actorUserId: admin.userId,
          action: `VEHICLE_${decision}`,
          targetType: 'VEHICLE',
          targetId: vehicleId,
          reason,
          details: { driverId: vehicle.driverId },
        },
      });
      return tx.vehicle.findUniqueOrThrow({
        where: { id: vehicleId },
        include: { documents: true },
      });
    });
  }
  async decideDriver(
    admin: Principal,
    driverId: string,
    decision: 'APPROVE' | 'REJECT' | 'CORRECTION' | 'SUSPEND',
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM drivers WHERE id=${driverId}::uuid FOR UPDATE`;
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        include: {
          user: true,
          kycApplications: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
          },
          vehicles: { where: { active: true }, include: { documents: true } },
        },
      });
      if (!driver)
        throw new AppError(ErrorCode.DRIVER_NOT_FOUND, HttpStatus.NOT_FOUND, 'Driver not found');
      if (decision === 'APPROVE') {
        const kyc = driver.kycApplications[0],
          vehicle = driver.vehicles[0];
        if (
          driver.user.status !== 'ACTIVE' ||
          !driver.profileName ||
          (driver.profileVersion === 2 &&
            (!this.profileDetails(driver).detailsComplete ||
              this.profileDetails(driver).ageEligible !== true ||
              (driver.licenceExpiresOn && driver.licenceExpiresOn <= new Date()))) ||
          !kyc ||
          kyc.status !== 'VERIFIED' ||
          (kyc.expiresAt && kyc.expiresAt <= new Date()) ||
          !vehicle ||
          vehicle.status !== 'VERIFIED' ||
          !this.requiredSatisfied(vehicle.documents, this.vehicleRequirements(vehicle.category))
        )
          return this.conflict(
            ErrorCode.DRIVER_NOT_ELIGIBLE,
            'Driver approval prerequisites are incomplete',
          );
      }
      const status =
        decision === 'APPROVE'
          ? 'APPROVED'
          : decision === 'SUSPEND'
            ? 'SUSPENDED'
            : decision === 'REJECT'
              ? 'REJECTED'
              : 'PENDING';
      // admin_set_driver_status returns void. It is a state-changing audited database function,
      // so use executeRaw rather than asking Prisma to deserialize a void result.
      await tx.$executeRaw`SELECT admin_set_driver_status(${driverId}::uuid,${status},${admin.userId}::uuid,${reason})`;
      return tx.driver.findUniqueOrThrow({ where: { id: driverId } });
    });
  }
  async adminDocumentDownload(admin: Principal, kind: 'KYC' | 'VEHICLE', documentId: string) {
    let document: {
      storageKey: string | null;
      storageVersionId: string | null;
      scannedAt: Date | null;
      status: string;
    } | null;
    let driverId: string | null;
    if (kind === 'KYC') {
      const row = await this.prisma.kycDocument.findUnique({
        where: { id: documentId },
        include: { application: { select: { driverId: true } } },
      });
      document = row;
      driverId = row?.application.driverId ?? null;
    } else {
      const row = await this.prisma.vehicleDocument.findUnique({
        where: { id: documentId },
        include: { vehicle: { select: { driverId: true } } },
      });
      document = row;
      driverId = row?.vehicle.driverId ?? null;
    }
    if (
      !document ||
      !document.storageKey ||
      !document.storageVersionId ||
      !document.scannedAt ||
      !['QUARANTINED', 'VERIFIED'].includes(document.status)
    )
      throw new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, 'Document is unavailable');
    const url = await this.storage.downloadUrl(
      document.storageKey,
      undefined,
      document.storageVersionId,
    );
    await this.prisma.adminAction.create({
      data: {
        actorUserId: admin.userId,
        action: 'DOCUMENT_ACCESSED',
        targetType: `${kind}_DOCUMENT`,
        targetId: documentId,
        reason: 'Authorized onboarding evidence review',
        details: { driverId },
      },
    });
    return {
      url,
      expiresInSeconds: this.config.documents.downloadTtlSeconds,
    };
  }

  async ownerDocumentPreview(principal: Principal, kind: 'KYC' | 'VEHICLE', documentId: string) {
    const driverId = this.driver(principal);
    const document =
      kind === 'KYC'
        ? await this.prisma.kycDocument.findFirst({
            where: { id: documentId, application: { driverId } },
          })
        : await this.prisma.vehicleDocument.findFirst({
            where: { id: documentId, vehicle: { driverId } },
          });
    if (
      !document?.storageKey ||
      !document.storageVersionId ||
      !document.scannedAt ||
      !['QUARANTINED', 'VERIFIED'].includes(document.status)
    )
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'A safe document preview is not available');
    return {
      url: await this.storage.downloadUrl(
        document.storageKey,
        undefined,
        document.storageVersionId,
      ),
      contentType: document.contentType,
      expiresInSeconds: this.config.documents.downloadTtlSeconds,
    };
  }

  async revealLicence(admin: Principal, driverId: string, reason: string) {
    const key = this.config.onboarding.identityEncryptionKey;
    if (!key)
      throw new AppError(
        ErrorCode.KYC_PROVIDER_UNAVAILABLE,
        503,
        'Protected identity access is unavailable',
      );
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { drivingLicenseCiphertext: true },
    });
    if (!driver?.drivingLicenseCiphertext)
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Protected licence not found');
    const number = decryptLicence(driver.drivingLicenseCiphertext, key, driverId);
    await this.prisma.adminAction.create({
      data: {
        actorUserId: admin.userId,
        action: 'DRIVER_LICENCE_ACCESSED',
        targetType: 'DRIVER',
        targetId: driverId,
        reason,
        details: { driverId },
      },
    });
    return { drivingLicenseNumber: number };
  }
}
