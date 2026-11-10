import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentStorageService } from '../onboarding/document-storage.service';
import { AppError, forbidden } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { InitiateProof, ProofBinding } from './delivery-proofs.dto';

@Injectable()
export class DeliveryProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorageService,
  ) {}

  private async assigned(input: ProofBinding, writing: boolean) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: input.paymentTripId,
        driver: {
          user: {
            status: 'ACTIVE',
            authIdentities: { some: { provider: 'firebase', subject: input.subject } },
          },
        },
        booking: { stops: { some: { sequence: input.sequence } } },
      },
      select: { status: true },
    });
    if (!trip) throw forbidden('Delivery evidence is restricted to the assigned driver');
    if (writing && trip.status !== 'DROP_PROGRESS')
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        409,
        'Delivery evidence requires an active drop',
      );
  }

  async initiate(input: InitiateProof) {
    await this.assigned(input, true);
    if (
      !['image/jpeg', 'image/png'].includes(input.contentType) ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > 5 * 1024 * 1024
    )
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Use a JPEG or PNG photo up to 5 MB');
    this.storage.assertInput(input.contentType, input.sizeBytes);
    this.storage.assertOperational();
    const id = randomUUID();
    const key = `delivery-proofs/${input.paymentTripId}/${input.sequence}/${id}`;
    const descriptor = {
      key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      documentId: id,
    };
    const upload = await this.storage.uploadUrl(descriptor);
    await this.prisma.deliveryProof.create({
      data: {
        id,
        paymentTripId: input.paymentTripId,
        engineTripId: input.engineTripId,
        engineStopId: input.engineStopId,
        sequence: input.sequence,
        ownerSubject: input.subject,
        key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      },
    });
    return { proofId: id, upload };
  }

  private async bound(id: string, input: ProofBinding) {
    const proof = await this.prisma.deliveryProof.findFirst({
      where: {
        id,
        paymentTripId: input.paymentTripId,
        engineTripId: input.engineTripId,
        engineStopId: input.engineStopId,
        sequence: input.sequence,
        ownerSubject: input.subject,
      },
    });
    if (!proof)
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        404,
        'Delivery evidence was not found for this stop',
      );
    return proof;
  }

  async complete(id: string, input: ProofBinding) {
    await this.assigned(input, true);
    const proof = await this.bound(id, input);
    if (proof.verifiedAt) return { proofId: id, ready: true };
    const descriptor = { ...proof, documentId: id };
    const verified = await this.storage.verifyUpload(descriptor);
    // Pin both verification and scan to the same immutable object version.
    const stored = { ...descriptor, ...verified };
    if (this.storage.isGuardDutyScanner()) await this.storage.assertGuardDutyClean(stored);
    else if ((await this.storage.scan(stored)) !== 'CLEAN')
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        422,
        'Delivery photo did not pass validation',
      );
    await this.prisma.deliveryProof.updateMany({
      where: { id, verifiedAt: null },
      data: { ...verified, verifiedAt: new Date() },
    });
    return { proofId: id, ready: true };
  }

  async read(id: string, input: ProofBinding) {
    await this.assigned(input, false);
    const proof = await this.bound(id, input);
    if (!proof.verifiedAt || !proof.storageVersionId)
      throw new AppError(ErrorCode.VALIDATION_FAILED, 409, 'Photo upload has not been verified');
    return {
      proofId: id,
      ready: true,
      url: await this.storage.downloadUrl(proof.key, 60, proof.storageVersionId),
    };
  }
}
