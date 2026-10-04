// ============================================================
// PICK UP ADMIN PANEL — VEHICLE TYPES
// ============================================================

import type { VehicleCategory } from './driver';

export type VehicleVerificationStatus = 'pending' | 'approved' | 'rejected';
export type VehicleOperationalStatus = 'enabled' | 'disabled';

export interface VehicleDocument {
  id: string;
  type: 'rc' | 'insurance' | 'puc' | 'permit';
  label: string;
  status: 'valid' | 'expired' | 'pending' | 'missing';
  expiryDate?: string;
  documentNumber?: string;
}

export interface Vehicle {
  id: string;                             // e.g. VEH-001
  registrationNumber: string;             // e.g. RJ19AB1234
  category: VehicleCategory;
  make: string;                           // e.g. Bajaj, Mahindra
  model: string;                          // e.g. RE, Bolero Pickup
  year: number;
  color: string;
  capacity: string;                       // e.g. "500 kg", "2 ton"
  driverId: string;
  driverName: string;
  driverPhone: string;
  verificationStatus: VehicleVerificationStatus;
  operationalStatus: VehicleOperationalStatus;
  verifiedAt?: string;
  verifiedBy?: string;
  registeredAt: string;
  documents: VehicleDocument[];
  imageUrls: string[];                    // mock placeholder paths
}

export interface VehicleFilters {
  search: string;
  category: VehicleCategory | 'all';
  verificationStatus: VehicleVerificationStatus | 'all';
  operationalStatus: VehicleOperationalStatus | 'all';
}

export { VehicleCategory };
