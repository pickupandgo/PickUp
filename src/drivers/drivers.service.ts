import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Driver, NearbyDriverResult, NearbySearchParams } from './drivers.types';
import { MOCK_DRIVERS } from '../data/mock-drivers';
import { haversineDistance } from '../utils/distance';

@Injectable()
export class DriversService {
  private drivers: Driver[] = [...MOCK_DRIVERS];

  findAll(): Driver[] {
    return this.drivers;
  }

  findById(id: string): Driver {
    let driver = this.drivers.find(d => d.id === id);
    if (!driver) {
      // Lazily create driver for the prototype
      // Deterministically pick a vehicle based on the last char of the ID
      const vehicles = ['2 Wheeler', '3 Wheeler', 'Mini Truck', 'Pickup Truck'];
      const vIndex = id.charCodeAt(id.length - 1) % vehicles.length;

      driver = {
        id,
        name: `Driver ${id.slice(-4)}`,
        vehicleType: vehicles[vIndex],
        latitude: 26.2389,
        longitude: 73.0243,
        isAvailable: false,
      };
      this.drivers.push(driver);
    }
    return driver;
  }

  updateAvailability(id: string, isAvailable: boolean): Driver {
    const driver = this.findById(id);
    driver.isAvailable = isAvailable;
    driver.lastSeen = Date.now();
    return driver;
  }

  updateLocation(id: string, latitude: number, longitude: number): Driver {
    if (latitude < -90 || latitude > 90) {
        throw new BadRequestException('Invalid latitude');
    }
    if (longitude < -180 || longitude > 180) {
        throw new BadRequestException('Invalid longitude');
    }
    
    const driver = this.findById(id);
    driver.latitude = latitude;
    driver.longitude = longitude;
    driver.lastSeen = Date.now();
    return driver;
  }

  updateVehicleType(id: string, vehicleType: string): Driver {
    const allowed = ['2 Wheeler', '3 Wheeler', '4 Wheeler', 'Mini Truck', 'Pickup Truck'];
    if (!allowed.includes(vehicleType)) {
      throw new BadRequestException(`Invalid vehicle type. Allowed: ${allowed.join(', ')}`);
    }
    const driver = this.findById(id);
    driver.vehicleType = vehicleType;
    driver.lastSeen = Date.now();
    return driver;
  }

  findNearby(params: NearbySearchParams): NearbyDriverResult[] {
    const { latitude, longitude, radiusKm, vehicleType } = params;
    const STALE_MS = 60_000; // 60 seconds - driver must have pinged in last 60s
    const now = Date.now();

    // 1. Filter Available Drivers that are also recently active
    let availableDrivers = this.drivers.filter(d => 
      d.isAvailable && d.lastSeen && (now - d.lastSeen) < STALE_MS
    );

    // 2. Filter by vehicleType if specified
    if (vehicleType) {
      availableDrivers = availableDrivers.filter(
        d => d.vehicleType.toLowerCase() === vehicleType.toLowerCase()
      );
    }

    // 2. Calculate Distance
    const driversWithDistance = availableDrivers.map(driver => {
      const distanceKm = haversineDistance(
        latitude,
        longitude,
        driver.latitude,
        driver.longitude,
      );
      const etaMinutes = Math.max(1, Math.ceil((distanceKm / 25) * 60)); // 25 km/h city speed
      return { ...driver, distanceKm, etaMinutes };
    });

    // 3. Remove Drivers Outside Radius
    const nearbyDrivers = driversWithDistance.filter(
      driver => driver.distanceKm <= radiusKm,
    );

    // 4. Sort Nearest → Farthest
    nearbyDrivers.sort((a, b) => a.distanceKm - b.distanceKm);

    return nearbyDrivers;
  }

  rateDriver(driverId: string, rating: number): Driver {
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    const driver = this.findById(driverId);
    const currentTotal = driver.totalRatings || 0;
    const currentRating = driver.rating || 0;
    driver.totalRatings = currentTotal + 1;
    // Weighted average
    driver.rating = Math.round(((currentRating * currentTotal + rating) / driver.totalRatings) * 10) / 10;
    return driver;
  }
}
