import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Prisma } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentStorageService, type StoredDocumentDescriptor } from './document-storage.service';

type DocumentKind = 'KYC' | 'VEHICLE';
type ScanResult = 'NO_THREATS_FOUND' | 'THREATS_FOUND' | 'UNSUPPORTED' | 'ACCESS_DENIED' | 'FAILED';

interface GuardDutyObjectScanEvent {
  readonly id: string;
  readonly source: 'aws.guardduty';
  readonly account: string;
  readonly region: string;
  readonly ['detail-type']: 'GuardDuty Malware Protection Object Scan Result';
  readonly detail: {
    readonly scanStatus: string;
    readonly resourceType: 'S3_OBJECT';
    readonly s3ObjectDetails: {
      readonly bucketName: string;
      readonly objectKey: string;
      readonly eTag: string;
      readonly versionId: string;
    };
    readonly scanResultDetails: { readonly scanResultStatus: ScanResult };
  };
}

interface DocumentMatch {
  readonly kind: DocumentKind;
  readonly id: string;
  readonly descriptor: StoredDocumentDescriptor;
}

/**
 * Accepts only authenticated EventBridge deliveries, then independently verifies a clean result
 * from the immutable S3 version and GuardDuty-managed object tag. Event payloads alone never make
 * an uploaded document trusted.
 */
@Injectable()
export class GuardDutyScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async receive(token: string | undefined, payload: unknown): Promise<{ duplicate: boolean }> {
    const scanner = this.config.documents.scanner;
    if (!scanner || scanner.kind !== 'guardduty') {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'GuardDuty event delivery is disabled',
      );
    }
    if (!token || !safeEqual(token, scanner.eventToken)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'Invalid GuardDuty event authorization',
      );
    }
    const event = parseEvent(payload);
    const storage = this.config.documents.storage;
    if (
      event.account !== scanner.awsAccountId ||
      event.region !== scanner.region ||
      event.detail.s3ObjectDetails.bucketName !== storage?.bucket
    ) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'GuardDuty event is for an unexpected AWS resource',
      );
    }

    const existing = await this.prisma.documentScanEvent.findUnique({
      where: { eventId: event.id },
      select: { id: true },
    });
    if (existing) return { duplicate: true };

    const matched = await this.match(event);
    const clean =
      event.detail.scanStatus === 'COMPLETED' &&
      event.detail.scanResultDetails.scanResultStatus === 'NO_THREATS_FOUND';
    if (clean && matched) {
      // Fails closed on an unavailable bucket, missing/changed version, or absent managed tag.
      await this.storage.assertGuardDutyClean(matched.descriptor);
    }
    try {
      await this.persist(event, matched, clean);
    } catch (error) {
      if (isUniqueViolation(error)) return { duplicate: true };
      throw error;
    }
    return { duplicate: false };
  }

  private async match(event: GuardDutyObjectScanEvent): Promise<DocumentMatch | null> {
    const object = event.detail.s3ObjectDetails;
    const [kyc, vehicle] = await Promise.all([
      this.prisma.kycDocument.findFirst({
        where: { storageKey: object.objectKey, storageVersionId: object.versionId },
      }),
      this.prisma.vehicleDocument.findFirst({
        where: { storageKey: object.objectKey, storageVersionId: object.versionId },
      }),
    ]);
    if (kyc && vehicle) throw new Error('Document storage key collision');
    if (kyc) return documentMatch('KYC', kyc, object.eTag);
    if (vehicle) return documentMatch('VEHICLE', vehicle, object.eTag);
    return null;
  }

  private async persist(
    event: GuardDutyObjectScanEvent,
    matched: DocumentMatch | null,
    clean: boolean,
  ): Promise<void> {
    const object = event.detail.s3ObjectDetails;
    const result = event.detail.scanResultDetails.scanResultStatus;
    await this.prisma.$transaction(async (tx) => {
      const audit = await tx.documentScanEvent.create({
        data: {
          eventId: event.id,
          source: event.source,
          awsAccountId: event.account,
          region: event.region,
          bucket: object.bucketName,
          objectKey: object.objectKey,
          objectVersionId: object.versionId,
          objectETag: normalizeETag(object.eTag),
          scanStatus: event.detail.scanStatus,
          scanResult: result,
          documentKind: matched?.kind ?? null,
          documentId: matched?.id ?? null,
          outcome: matched ? 'RECEIVED' : 'STALE_OR_UNKNOWN',
          detail: event as unknown as Prisma.InputJsonValue,
        },
      });
      if (!matched) return;
      const update = {
        guardDutyScanEventId: event.id,
        scannedAt: new Date(),
        ...(clean
          ? { status: 'QUARANTINED' as const, rejectionReason: null }
          : {
              status: result === 'THREATS_FOUND' ? ('REJECTED' as const) : ('SCAN_FAILED' as const),
              rejectionReason:
                result === 'THREATS_FOUND'
                  ? 'Malware scan rejected this file'
                  : 'Malware scan did not produce a trusted clean result',
            }),
      };
      const where = {
        id: matched.id,
        storageVersionId: matched.descriptor.storageVersionId,
        storageETag: matched.descriptor.storageETag,
        status: 'QUARANTINED' as const,
        guardDutyScanEventId: null,
      };
      const changed =
        matched.kind === 'KYC'
          ? await tx.kycDocument.updateMany({ where, data: update })
          : await tx.vehicleDocument.updateMany({ where, data: update });
      if (changed.count !== 1) {
        await tx.documentScanEvent.update({
          where: { id: audit.id },
          data: { outcome: 'STALE_OR_ALREADY_PROCESSED', processedAt: new Date() },
        });
        return;
      }
      await tx.documentScanEvent.update({
        where: { id: audit.id },
        data: { outcome: clean ? 'CLEAN_VERIFIED' : 'NOT_CLEAN', processedAt: new Date() },
      });
      await tx.adminAction.create({
        data: {
          actorUserId: null,
          action: clean ? 'DOCUMENT_GUARDDUTY_CLEAN' : 'DOCUMENT_GUARDDUTY_NOT_CLEAN',
          targetType: `${matched.kind}_DOCUMENT`,
          targetId: matched.id,
          reason: `GuardDuty scan result: ${result}`,
          details: {
            eventId: event.id,
            versionId: object.versionId,
            scanStatus: event.detail.scanStatus,
          },
        },
      });
    });
  }
}

function documentMatch(
  kind: DocumentKind,
  row: {
    id: string;
    storageKey: string | null;
    storageVersionId: string | null;
    storageETag: string | null;
    contentType: string | null;
    sizeBytes: number | null;
    checksumSha256: string | null;
  },
  eventETag: string,
): DocumentMatch | null {
  if (
    !row.storageKey ||
    !row.storageVersionId ||
    !row.storageETag ||
    !row.contentType ||
    !row.sizeBytes ||
    !row.checksumSha256
  )
    return null;
  if (normalizeETag(eventETag) !== row.storageETag) return null;
  return {
    kind,
    id: row.id,
    descriptor: {
      key: row.storageKey,
      storageVersionId: row.storageVersionId,
      storageETag: row.storageETag,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      checksumSha256: row.checksumSha256,
      documentId: row.id,
    },
  };
}

function parseEvent(value: unknown): GuardDutyObjectScanEvent {
  const event = value as GuardDutyObjectScanEvent;
  const object = event?.detail?.s3ObjectDetails;
  const result = event?.detail?.scanResultDetails?.scanResultStatus;
  if (
    !event ||
    event.source !== 'aws.guardduty' ||
    event['detail-type'] !== 'GuardDuty Malware Protection Object Scan Result' ||
    event.detail?.resourceType !== 'S3_OBJECT' ||
    !valid(event.id, 150) ||
    !/^\d{12}$/.test(event.account ?? '') ||
    !valid(event.region, 80) ||
    !valid(object?.bucketName, 255) ||
    !valid(object?.objectKey, 500) ||
    !valid(object?.versionId, 1024) ||
    !valid(object?.eTag, 128) ||
    !['NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED'].includes(
      result,
    )
  ) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      HttpStatus.BAD_REQUEST,
      'Malformed GuardDuty scan event',
    );
  }
  return event;
}

function valid(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function normalizeETag(value: string): string {
  return value.replace(/^"|"$/g, '').trim();
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
