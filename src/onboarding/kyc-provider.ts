export type NormalizedKycResult =
  'PENDING' | 'VERIFIED' | 'REJECTED' | 'NEEDS_CORRECTION' | 'EXPIRED';
export interface KycSession {
  readonly referenceId: string;
  readonly redirectUrl?: string;
  readonly expiresAt?: Date;
}
export interface VerifiedKycEvent {
  readonly eventId: string;
  readonly referenceId: string;
  readonly occurredAt: Date;
  readonly result: NormalizedKycResult;
  readonly safeMetadata: Readonly<Record<string, unknown>>;
}
/** Future adapters own credentials, request signing, webhook authentication and normalization. */
export abstract class KycProvider {
  abstract readonly name: string;
  abstract createSession(input: { driverId: string; applicationId: string }): Promise<KycSession>;
  abstract getStatus(referenceId: string): Promise<NormalizedKycResult>;
  abstract verifyWebhook(input: {
    rawBody: Buffer;
    headers: Readonly<Record<string, string | undefined>>;
  }): Promise<VerifiedKycEvent>;
}
