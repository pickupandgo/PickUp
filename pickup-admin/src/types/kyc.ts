// ============================================================
// PICK UP ADMIN PANEL — KYC TYPES
// ============================================================

import type { KYCStatus } from './driver';

export type DocumentStatus = 'verified' | 'pending' | 'rejected';
export type DocumentType =
  | 'aadhaar'
  | 'driving_licence'
  | 'pan'
  | 'vehicle_rc'
  | 'vehicle_insurance'
  | 'vehicle_puc';

export interface KYCDocument {
  id: string;
  type: DocumentType;
  label: string;
  status: DocumentStatus;
  submittedAt: string;
  verifiedAt?: string;
  rejectionReason?: string;
  // In production: URL from S3. For mock: placeholder image path or descriptive text
  previewUrl?: string;
  documentNumber?: string;       // e.g. Aadhaar last 4 digits (masked)
}

export interface KYCRecord {
  id: string;                    // e.g. KYC-001
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehicleNumber: string;
  vehicleCategory: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;           // admin name
  status: KYCStatus;
  rejectionReason?: string;
  correctionRequested?: boolean;
  documents: KYCDocument[];
}

export interface KYCFilters {
  search: string;
  status: KYCStatus | 'all';
}
