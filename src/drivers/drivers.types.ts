export interface Driver {
  id: string;
  name: string;
  vehicleType: string;
  latitude: number;
  longitude: number;
  isAvailable: boolean;
  lastSeen?: number; // timestamp (Date.now()) of last activity
  rating?: number;   // average rating 1-5
  totalRatings?: number; // count of ratings received
}

export interface NearbyDriverResult extends Driver {
  distanceKm: number;
  etaMinutes: number;
}

export interface NearbySearchParams {
  latitude: number;
  longitude: number;
  radiusKm: number;
  vehicleType?: string; // optional filter — only return drivers of this vehicle type
}
