import { Injectable } from '@nestjs/common';
import { haversineDistance } from '../utils/distance';

export interface FareEstimate {
  fare: number;         // total fare in INR (rounded)
  distanceKm: number;
  durationMin: number;  // estimated duration in minutes
  baseFare: number;
  perKmCharge: number;
  weightMultiplier: number;
  breakdown: {
    base: number;
    distance: number;
    weightSurcharge: number;
  };
}

export interface MultiDropFareEstimate extends FareEstimate {
  totalStops: number;
  legs: {
    from: string;
    to: string;
    distanceKm: number;
    fare: number;
  }[];
}

interface LocationLike {
  latitude: number;
  longitude: number;
  address?: string;
}

@Injectable()
export class FareService {
  private readonly BASE_FARE = 30;          // INR
  private readonly PER_KM_RATE = 12;        // INR per km
  private readonly SPEED_KMH = 25;          // assumed average speed in city
  private readonly EXTRA_STOP_FEE = 10;     // INR per additional stop

  // Vehicle type fare multipliers
  private readonly VEHICLE_MULTIPLIERS: Record<string, number> = {
    '2 Wheeler':    0.8,
    '2wheeler':     0.8,
    '3 Wheeler':    1.0,
    '3wheeler':     1.0,
    '4 Wheeler':    1.3,
    '4wheeler':     1.3,
    'Mini Truck':   1.6,
    'minitruck':    1.6,
    'Pickup Truck': 2.0,
    'pickuptruck':  2.0,
  };

  getVehicleMultiplier(vehicleType?: string): number {
    if (!vehicleType) return 1.0;
    const key = vehicleType.toLowerCase().replace(/\s+/g, '');
    return this.VEHICLE_MULTIPLIERS[vehicleType] ?? this.VEHICLE_MULTIPLIERS[key] ?? 1.0;
  }

  private getWeightMultiplier(weightKg: number): number {
    if (weightKg <= 5) return 1.0;
    if (weightKg <= 10) return 1.2;
    if (weightKg <= 25) return 1.5;
    if (weightKg <= 50) return 2.0;
    return 3.0;  // 100kg+
  }

  // Single leg estimation (backward compat)
  estimate(
    pickupLat: number,
    pickupLng: number,
    dropLat: number,
    dropLng: number,
    weightKg: number = 10,
    vehicleType?: string,
  ): FareEstimate {
    const distanceKm = haversineDistance(pickupLat, pickupLng, dropLat, dropLng);
    const durationMin = Math.ceil((distanceKm / this.SPEED_KMH) * 60);
    const weightMultiplier = this.getWeightMultiplier(weightKg);
    const vehicleMultiplier = this.getVehicleMultiplier(vehicleType);

    const base = this.BASE_FARE;
    const distanceCharge = distanceKm * this.PER_KM_RATE;
    const subtotal = base + distanceCharge;
    const weightSurcharge = subtotal * (weightMultiplier - 1);
    const totalFare = Math.ceil((subtotal + weightSurcharge) * vehicleMultiplier);

    return {
      fare: totalFare,
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationMin,
      baseFare: this.BASE_FARE,
      perKmCharge: this.PER_KM_RATE,
      weightMultiplier,
      breakdown: {
        base: Math.ceil(base * vehicleMultiplier),
        distance: Math.ceil(distanceCharge * vehicleMultiplier),
        weightSurcharge: Math.ceil(weightSurcharge * vehicleMultiplier),
      },
    };
  }

  // Multi-drop fare estimation
  estimateMultiDrop(
    pickup: LocationLike,
    drops: LocationLike[],
    weightKg: number = 10,
    vehicleType?: string,
  ): MultiDropFareEstimate {
    const weightMultiplier = this.getWeightMultiplier(weightKg);
    const vehicleMultiplier = this.getVehicleMultiplier(vehicleType);

    // Calculate legs: pickup → drop1 → drop2 → drop3...
    const points: LocationLike[] = [pickup, ...drops];
    let totalDistanceKm = 0;
    const legs: MultiDropFareEstimate['legs']  = [];

    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      const legDistance = haversineDistance(from.latitude, from.longitude, to.latitude, to.longitude);
      totalDistanceKm += legDistance;

      const fromLabel = i === 0 ? (from.address || 'Pickup') : (from.address || `Drop ${i}`);
      const toLabel = to.address || `Drop ${i + 1}`;

      const isFirstLeg = i === 0;
      const legBase = isFirstLeg ? this.BASE_FARE : this.EXTRA_STOP_FEE;
      const legDistanceCharge = legDistance * this.PER_KM_RATE;
      const legSubtotal = legBase + legDistanceCharge;
      const legWeightSurcharge = legSubtotal * (weightMultiplier - 1);
      const legTotalFare = Math.ceil((legSubtotal + legWeightSurcharge) * vehicleMultiplier);

      legs.push({
        from: fromLabel,
        to: toLabel,
        distanceKm: Math.round(legDistance * 10) / 10,
        fare: legTotalFare,
      });
    }

    let sumLegFares = 0;
    let sumLegDistances = 0;
    for (const leg of legs) {
      sumLegFares += leg.fare;
      sumLegDistances += leg.distanceKm;
    }

    const durationMin = Math.ceil((sumLegDistances / this.SPEED_KMH) * 60);
    
    const base = this.BASE_FARE;
    const distanceCharge = sumLegDistances * this.PER_KM_RATE;
    const extraStopCharge = Math.max(0, drops.length - 1) * this.EXTRA_STOP_FEE;
    const subtotal = base + distanceCharge + extraStopCharge;
    const weightSurcharge = subtotal * (weightMultiplier - 1);
    // Use exact sum of leg fares to prevent rounding errors
    const totalFare = sumLegFares;

    return {
      fare: totalFare,
      distanceKm: Math.round(sumLegDistances * 10) / 10,
      durationMin,
      baseFare: this.BASE_FARE,
      perKmCharge: this.PER_KM_RATE,
      weightMultiplier,
      totalStops: drops.length,
      legs,
      breakdown: {
        base: Math.ceil(base + extraStopCharge),
        distance: Math.ceil(distanceCharge),
        weightSurcharge: Math.ceil(weightSurcharge),
      },
    };
  }
}
