import { getAuth } from '@react-native-firebase/auth';
import type { Asset } from 'react-native-image-picker';
import { env } from '../../config/env';

export type DriverApprovalStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUSPENDED';
export type DocumentStatus =
  | 'UPLOADING'
  | 'QUARANTINED'
  | 'SCAN_FAILED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'STORAGE_UNAVAILABLE';

export interface OnboardingDocument {
  readonly id: string;
  readonly documentType: string;
  readonly version: number;
  readonly status: DocumentStatus;
  readonly rejectionReason?: string | null;
  readonly createdAt: string;
}

export interface KycApplication {
  readonly id: string;
  readonly provider: string;
  readonly status:
    | 'PENDING'
    | 'IN_REVIEW'
    | 'VERIFIED'
    | 'REJECTED'
    | 'NEEDS_CORRECTION'
    | 'EXPIRED'
    | 'PROVIDER_UNAVAILABLE';
  readonly rejectionReason?: string | null;
  readonly documents: readonly OnboardingDocument[];
}

export interface OnboardingVehicle {
  readonly id: string;
  readonly category: VehicleCategory;
  readonly registrationNumber: string;
  readonly makeModel: string;
  readonly status:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'IN_REVIEW'
    | 'VERIFIED'
    | 'REJECTED'
    | 'INACTIVE';
  readonly active: boolean;
  readonly rejectionReason?: string | null;
  readonly documents: readonly OnboardingDocument[];
}

export type VehicleCategory =
  | 'TWO_WHEELER'
  | 'THREE_WHEELER'
  | 'FOUR_WHEELER'
  | 'MINI_TRUCK'
  | 'PICKUP_TRUCK';

export interface DriverOnboardingSummary {
  readonly driverId: string;
  readonly approvalStatus: DriverApprovalStatus;
  readonly profileComplete: boolean;
  readonly profileName: string | null;
  readonly eligible: boolean;
  readonly eligibilityReasons: readonly string[];
  readonly next:
    | 'PROFILE'
    | 'KYC'
    | 'KYC_REVIEW'
    | 'VEHICLE'
    | 'VEHICLE_REVIEW'
    | 'FINAL_REVIEW'
    | 'APPROVED';
  readonly kyc: KycApplication | null;
  readonly vehicles: readonly OnboardingVehicle[];
  readonly activeVehicle: OnboardingVehicle | null;
  readonly requiredDocuments: {
    readonly kyc: readonly string[];
    readonly vehicle: readonly string[];
  };
  readonly latestDecision: {
    readonly action: string;
    readonly reason: string | null;
    readonly createdAt: string;
  } | null;
}

interface UploadInitiation {
  readonly document: OnboardingDocument;
  readonly upload: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresInSeconds: number;
  };
}

interface VehicleInput {
  readonly category: VehicleCategory;
  readonly registrationNumber: string;
  readonly makeModel: string;
}

const parseError = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as {
    message?: unknown;
    error?: { message?: unknown } | string;
  };
  if (
    typeof value.error === 'object' &&
    typeof value.error?.message === 'string'
  )
    return value.error.message;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error === 'string') return value.error;
  return fallback;
};

export class DriverOnboardingService {
  private static instance: DriverOnboardingService;

  static getInstance(): DriverOnboardingService {
    if (!this.instance) this.instance = new DriverOnboardingService();
    return this.instance;
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: object,
  ): Promise<T> {
    const user = getAuth().currentUser;
    if (!user)
      throw new Error(
        'Your sign-in session has expired. Please sign in again.',
      );
    if (!env.PAYMENTS_API_BASE_URL)
      throw new Error(
        'Account service is not configured. Please contact support.',
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${env.PAYMENTS_API_BASE_URL}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          parseError(payload, 'The onboarding request could not be completed.'),
        );
      return payload as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError')
        throw new Error('The onboarding request timed out. Please try again.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  getSummary(): Promise<DriverOnboardingSummary> {
    return this.request('/v1/drivers/me/onboarding');
  }
  updateProfile(name: string): Promise<unknown> {
    return this.request('/v1/drivers/me/onboarding/profile', 'PATCH', { name });
  }
  startKyc(): Promise<KycApplication> {
    return this.request('/v1/drivers/me/onboarding/kyc', 'POST');
  }
  submitKyc(applicationId: string): Promise<unknown> {
    return this.request(
      `/v1/drivers/me/onboarding/kyc/${applicationId}/submit`,
      'POST',
    );
  }
  createVehicle(input: VehicleInput): Promise<OnboardingVehicle> {
    return this.request('/v1/drivers/me/onboarding/vehicles', 'POST', input);
  }
  updateVehicle(
    vehicleId: string,
    input: VehicleInput,
  ): Promise<OnboardingVehicle> {
    return this.request(
      `/v1/drivers/me/onboarding/vehicles/${vehicleId}`,
      'PATCH',
      input,
    );
  }
  submitVehicle(vehicleId: string): Promise<unknown> {
    return this.request(
      `/v1/drivers/me/onboarding/vehicles/${vehicleId}/submit`,
      'POST',
    );
  }
  requestReplacement(
    input: VehicleInput & { readonly reason: string },
  ): Promise<unknown> {
    return this.request(
      '/v1/drivers/me/onboarding/vehicle-replacements',
      'POST',
      input,
    );
  }

  async uploadKycDocument(
    applicationId: string,
    documentType: string,
    asset: Asset,
  ): Promise<void> {
    await this.upload(
      `/v1/drivers/me/onboarding/kyc/${applicationId}/documents`,
      documentId =>
        `/v1/drivers/me/onboarding/kyc/${applicationId}/documents/${documentId}/complete`,
      documentType,
      asset,
    );
  }

  async uploadVehicleDocument(
    vehicleId: string,
    documentType: string,
    asset: Asset,
  ): Promise<void> {
    await this.upload(
      `/v1/drivers/me/onboarding/vehicles/${vehicleId}/documents`,
      documentId =>
        `/v1/drivers/me/onboarding/vehicles/${vehicleId}/documents/${documentId}/complete`,
      documentType,
      asset,
    );
  }

  private async upload(
    initPath: string,
    completePath: (documentId: string) => string,
    documentType: string,
    asset: Asset,
  ): Promise<void> {
    if (!asset.uri) throw new Error('The selected document could not be read.');
    const contentType = asset.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const fileResponse = await fetch(asset.uri);
    if (!fileResponse.ok)
      throw new Error('The selected document could not be opened.');
    const blob = await fileResponse.blob();
    const sizeBytes = asset.fileSize ?? blob.size;
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1)
      throw new Error('The selected document is empty.');
    const initiation = await this.request<UploadInitiation>(initPath, 'POST', {
      documentType,
      contentType,
      sizeBytes,
    });
    const uploadResponse = await fetch(initiation.upload.url, {
      method: 'PUT',
      headers: { ...initiation.upload.headers },
      body: blob,
    });
    if (!uploadResponse.ok)
      throw new Error('Secure document upload failed. Please try again.');
    await this.request(completePath(initiation.document.id), 'POST');
  }
}
