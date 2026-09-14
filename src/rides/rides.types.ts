export interface RideLocation {
  latitude: number;
  longitude: number;
  address?: string;
  receiver?: {
    name?: string;
    phone?: string;
  };
}

export type RideStatus = 'REQUESTED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

export interface RideRequest {
  id: string;
  customerId: string;
  pickup: RideLocation;
  drop: RideLocation;          // backward compat: first drop
  drops: RideLocation[];       // all drops in order
  vehicleType?: string;
  weight?: number;             // in kg
  fare?: number;               // total fare in INR
  totalDistanceKm?: number;    // total distance
  legs?: any[];                // multi-leg breakdown
  otp?: string;                // legacy pickup OTP
  stopOtps?: string[];         // per-stop OTPs
  status: RideStatus;
  requestedDriverId: string;
  assignedDriverId?: string;
  createdAt: string;
  updatedAt: string;
}

export class CreateRideDto {
  customerId: string;
  driverId: string;
  pickup: RideLocation;
  drop?: RideLocation;         // single drop (backward compat)
  drops?: RideLocation[];      // multi-drop array
  vehicleType?: string;
  weight?: number;             // in kg
  fare?: number;               // pre-calculated fare from client
}
