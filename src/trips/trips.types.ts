export type TripStatus =
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'PICKUP_VERIFIED'
  | 'IN_TRANSIT'
  | 'DROP_PROGRESS'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

export type StopStatus = 'PENDING' | 'IN_TRANSIT' | 'ARRIVED' | 'DELIVERED';

export interface StopReceiver {
  name?: string;
  phone?: string;
}

export interface TripStop {
  id: string;
  sequence: number;          // 1-based: 1, 2, 3...
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  receiver?: StopReceiver;   // who is receiving at this stop
  status: StopStatus;
  otp: string;               // unique 4-digit OTP per stop — NEVER exposed in GET responses
  otpVerified?: boolean;
  deliveryProof?: {
    type: 'PHOTO';
    uri: string;
    submittedAt: string;
  };
  distanceFromPreviousStopKm?: number;
  fareFromPreviousStop?: number;
  arrivedAt?: string;
  deliveredAt?: string;
}

/**
 * OTP-scrubbed stop — safe to return to any client (driver or customer).
 * The server retains the real OTP on TripStop internally for validation.
 */
export interface TripStopPublic {
  id: string;
  sequence: number;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  receiver?: StopReceiver;
  status: StopStatus;
  otpVerified?: boolean;
  deliveryProof?: {
    type: 'PHOTO';
    uri: string;
    submittedAt: string;
  };
  distanceFromPreviousStopKm?: number;
  fareFromPreviousStop?: number;
  arrivedAt?: string;
  deliveredAt?: string;
}

export interface Trip {
  id: string;
  rideId: string;
  customerId: string;
  driverId: string;
  
  pickup: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  
  // Kept for backward compatibility (= stops[0].location)
  drop: {
    latitude: number;
    longitude: number;
    address?: string;
  };

  stops: TripStop[];           // ordered array of all drops — OTP stored internally
  currentStopIndex: number;    // 0-based index into stops[]
  
  status: TripStatus;
  weight?: number;   // in kg
  fare?: number;     // total fare in INR
  totalDistanceKm?: number;
  otp?: string;      // legacy: pickup OTP (kept for backward compat — NOT leaked in GET)
  
  createdAt: string;
  updatedAt: string;
  
  arrivedAt?: string;
  pickupVerifiedAt?: string;
  startedAt?: string;
  deliveredAt?: string;
  completedAt?: string;
  
  cancelledAt?: string;
  cancelledBy?: 'CUSTOMER' | 'DRIVER';
  cancellationReason?: string;
}
