// ============================================================
// PICK UP ADMIN PANEL — DRIVER TYPES
// ============================================================

export type DriverStatus = 'pending' | 'approved' | 'suspended' | 'blocked';
export type KYCStatus = 'pending' | 'approved' | 'rejected';
export type OnlineStatus = 'online' | 'offline';
export type EligibilityStatus = 'eligible' | 'ineligible';

export interface Driver {
  id: string;                     // e.g. DRV-001
  name: string;
  phone: string;
  email?: string;
  registeredAt: string;
  status: DriverStatus;
  kycStatus: KYCStatus;
  onlineStatus: OnlineStatus;
  eligibility: EligibilityStatus;
  eligibilityReason?: string;     // populated when ineligible
  language: 'Hindi' | 'English' | 'Hindi & English';
  city: string;
  vehicleId: string;              // references Vehicle.id
  vehicleNumber: string;
  vehicleCategory: VehicleCategory;
  walletBalance: number;          // INR
  minimumBalance: number;         // INR
  totalTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  lastTripDate?: string;
  kycId: string;                  // references KYCRecord.id
}

export interface DriverFilters {
  search: string;
  status: DriverStatus | 'all';
  kycStatus: KYCStatus | 'all';
  eligibility: EligibilityStatus | 'all';
  onlineStatus: OnlineStatus | 'all';
  vehicleCategory: VehicleCategory | 'all';
}

// Re-export for convenience
export type VehicleCategory =
  | '2-Wheeler'
  | '3-Wheeler'
  | 'Mini Truck'
  | 'Pickup'
  | 'JCB'
  | 'Crane';
