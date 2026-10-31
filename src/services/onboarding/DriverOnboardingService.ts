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
  readonly uploadedAt?: string | null;
  readonly scannedAt?: string | null;
  readonly reviewedAt?: string | null;
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
  readonly profile?: DriverProfile;
  readonly availableVehicleCategories?: readonly VehicleCategory[];
  readonly selectedVehicleCategory?: VehicleCategory | null;
  readonly capabilities?: {
    readonly manualKycEnabled: boolean;
    readonly documentUploadsEnabled: boolean;
    readonly maxDocumentBytes: number;
    readonly allowedContentTypes: readonly string[];
    readonly licenceNumberEnabled: boolean;
  };
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
    readonly vehicleByCategory?: Readonly<
      Partial<Record<VehicleCategory, readonly string[]>>
    >;
  };
  readonly latestDecision: {
    readonly action: string;
    readonly reason: string | null;
    readonly createdAt: string;
  } | null;
}

export interface DriverProfile {
  readonly name: string | null;
  readonly phone: string;
  readonly dateOfBirth: string | null;
  readonly email: string | null;
  readonly gender: string | null;
  readonly residentialAddress: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly pinCode: string | null;
  readonly detailsComplete: boolean;
  readonly age: number | null;
  readonly ageEligible: boolean | null;
  readonly minimumAge: number | null;
  readonly licenceLast4: string | null;
  readonly licenceExpiresOn: string | null;
  readonly licenceVehicleClasses: readonly string[];
}
export interface ProfileInput {
  readonly profileVersion: 2;
  readonly name: string;
  readonly dateOfBirth: string;
  readonly email: string;
  readonly gender?: string;
  readonly residentialAddress: string;
  readonly city: string;
  readonly state: string;
  readonly pinCode: string;
  readonly drivingLicenseNumber?: string;
  readonly licenceExpiresOn?: string;
  readonly licenceVehicleClasses?: readonly string[];
}
export interface UploadProgress {
  readonly phase: 'PREPARING' | 'UPLOADING' | 'CONFIRMING';
  readonly percent: number | null;
}

interface UploadInitiation {
  readonly document: OnboardingDocument;
  readonly upload: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresInSeconds: number;
  };
}

export interface VehicleInput {
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
  updateProfile(input: string | ProfileInput): Promise<unknown> {
    return this.request(
      '/v1/drivers/me/onboarding/profile',
      'PATCH',
      typeof input === 'string' ? { name: input } : input,
    );
  }
  saveVehicleCategory(category: VehicleCategory): Promise<unknown> {
    return this.request('/v1/drivers/me/onboarding/vehicle-category', 'PATCH', {
      category,
    });
  }
  previewDocument(
    kind: 'KYC' | 'VEHICLE',
    id: string,
  ): Promise<{ url: string; contentType: string; expiresInSeconds: number }> {
    return this.request(
      `/v1/drivers/me/onboarding/documents/${kind}/${id}/preview`,
    );
  }
  startKyc(): Promise<KycApplication> {
    return this.request('/v1/drivers/me/onboarding/kyc', 'POST');
  }
  retryDocumentCompletion(
    kind: 'KYC' | 'VEHICLE',
    ownerId: string,
    documentId: string,
  ): Promise<unknown> {
    return this.request(
      `/v1/drivers/me/onboarding/${
        kind === 'KYC' ? 'kyc' : 'vehicles'
      }/${ownerId}/documents/${documentId}/complete`,
      'POST',
    );
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
    onProgress?: (progress: UploadProgress) => void,
    limits?: { maxBytes: number; allowedContentTypes: readonly string[] },
  ): Promise<void> {
    await this.upload(
      `/v1/drivers/me/onboarding/kyc/${applicationId}/documents`,
      documentId =>
        `/v1/drivers/me/onboarding/kyc/${applicationId}/documents/${documentId}/complete`,
      documentType,
      asset,
      onProgress,
      limits,
    );
  }

  async uploadVehicleDocument(
    vehicleId: string,
    documentType: string,
    asset: Asset,
    onProgress?: (progress: UploadProgress) => void,
    limits?: { maxBytes: number; allowedContentTypes: readonly string[] },
  ): Promise<void> {
    await this.upload(
      `/v1/drivers/me/onboarding/vehicles/${vehicleId}/documents`,
      documentId =>
        `/v1/drivers/me/onboarding/vehicles/${vehicleId}/documents/${documentId}/complete`,
      documentType,
      asset,
      onProgress,
      limits,
    );
  }

  private async upload(
    initPath: string,
    completePath: (documentId: string) => string,
    documentType: string,
    asset: Asset,
    onProgress?: (progress: UploadProgress) => void,
    limits?: { maxBytes: number; allowedContentTypes: readonly string[] },
  ): Promise<void> {
    if (!asset.uri) throw new Error('The selected document could not be read.');
    if (!/^(file|content):\/\//.test(asset.uri))
      throw new Error('Select a photograph from the camera or device gallery.');
    if (!asset.type || !['image/png', 'image/jpeg'].includes(asset.type))
      throw new Error('Select a JPEG or PNG photograph.');
    const contentType = asset.type;
    if (limits && !limits.allowedContentTypes.includes(contentType))
      throw new Error('This file type is not accepted by the document policy.');
    const maxBytes = limits?.maxBytes ?? 20_000_000;
    if (asset.fileSize && asset.fileSize > maxBytes)
      throw new Error('This file exceeds the allowed document size.');
    onProgress?.({ phase: 'PREPARING', percent: null });
    const fileResponse = await fetch(asset.uri);
    if (!fileResponse.ok)
      throw new Error('The selected document could not be opened.');
    const blob = await fileResponse.blob();
    try {
      const sizeBytes = blob.size;
      if (!Number.isInteger(sizeBytes) || sizeBytes < 1)
        throw new Error('The selected document is empty.');
      if (sizeBytes > maxBytes)
        throw new Error('This file exceeds the allowed document size.');
      const initiation = await this.request<UploadInitiation>(
        initPath,
        'POST',
        {
          documentType,
          contentType,
          sizeBytes,
        },
      );
      const uploadUrl = new URL(initiation.upload.url);
      if (
        uploadUrl.protocol !== 'https:' ||
        uploadUrl.username ||
        uploadUrl.password
      )
        throw new Error('Secure document upload is unavailable.');
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', initiation.upload.url);
        xhr.timeout = 120_000;
        for (const [header, value] of Object.entries(
          initiation.upload.headers,
        )) {
          // Native transport calculates Content-Length from the actual Blob.
          if (header.toLowerCase() !== 'content-length')
            xhr.setRequestHeader(header, value);
        }
        xhr.upload.onprogress = event =>
          onProgress?.({
            phase: 'UPLOADING',
            percent: event.lengthComputable
              ? Math.min(100, Math.round((event.loaded / event.total) * 100))
              : null,
          });
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error('Secure document upload failed. Please retry.'));
        xhr.onerror = () =>
          reject(new Error('Upload connection failed. Please retry.'));
        xhr.ontimeout = () =>
          reject(new Error('Document upload timed out. Please retry.'));
        xhr.onabort = () => reject(new Error('Document upload was cancelled.'));
        onProgress?.({ phase: 'UPLOADING', percent: 0 });
        xhr.send(blob);
      });
      onProgress?.({ phase: 'CONFIRMING', percent: null });
      await this.request(completePath(initiation.document.id), 'POST');
    } finally {
      // Release React Native's native Blob allocation, including on upload/init errors.
      (blob as Blob & { close?: () => void }).close?.();
    }
  }
}
