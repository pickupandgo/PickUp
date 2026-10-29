import { Injectable, BadRequestException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Driver,
  NearbyDriverResult,
  NearbySearchParams,
} from './drivers.types';
import { MOCK_DRIVERS } from '../data/mock-drivers';
import { haversineDistance } from '../utils/distance';
import { PrismaService } from '../prisma/prisma.service';
import { engineError } from '../common/errors';
import { PaymentBackendClient } from '../payment-backend/payment-backend.client';

export type DriverEligibilityResult =
  | { readonly kind: 'ELIGIBLE' }
  | { readonly kind: 'INELIGIBLE' }
  | { readonly kind: 'UNAVAILABLE' };

/**
 * Driver presence (online, location, vehicle) stays in memory: it is live state that drivers
 * re-send after a restart. Whether a driver is busy comes from the database (an active trip), so
 * a restart never makes a driver on a trip look free.
 */
@Injectable()
export class DriversService {
  private drivers: Driver[] = [...MOCK_DRIVERS];
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backend: PaymentBackendClient,
  ) {}

  findAll(): Driver[] {
    return this.drivers;
  }

  findById(id: string): Driver {
    let driver = this.drivers.find((d) => d.id === id);
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

  async updateAvailability(id: string, isAvailable: boolean): Promise<Driver> {
    if (isAvailable) {
      await this.requireEligibleForNewWork(id);
    }
    return this.setAvailability(id, isAvailable);
  }

  /** A post-trip local presence update never authorizes work; offers re-check the backend. */
  markAvailable(id: string): void {
    this.setAvailability(id, true);
  }

  /** Remove a driver from local dispatch without touching an in-progress trip. */
  markUnavailable(id: string): void {
    this.setAvailability(id, false);
  }

  private setAvailability(id: string, isAvailable: boolean): Driver {
    const driver = this.findById(id);
    driver.isAvailable = isAvailable;
    driver.lastSeen = Date.now();
    return driver;
  }

  /**
   * The only eligibility decision used by the engine for new work. It deliberately has no cache:
   * a suspension, KYC expiry or vehicle revocation takes effect on the next offer/assignment.
   */
  async checkEligibility(id: string): Promise<DriverEligibilityResult> {
    const outcome = await this.backend.getDriverEligibilityForSubject(
      id,
      `eng-elig-${randomUUID()}`,
    );
    if (outcome.kind === 'OK') {
      if (outcome.value.eligible) {
        return { kind: 'ELIGIBLE' };
      }
      this.markUnavailable(id);
      return { kind: 'INELIGIBLE' };
    }

    // A refused identity lookup is not evidence of eligibility. A bad key, timeout, network
    // failure and an unreadable response are all unavailable and also fail closed.
    this.markUnavailable(id);
    if (outcome.kind === 'UNAVAILABLE') {
      this.logger.error({
        alert: 'DRIVER_ELIGIBILITY_UNAVAILABLE',
        msg: 'The backend eligibility check failed closed',
        status: outcome.status,
        code: outcome.code,
      });
      return { kind: 'UNAVAILABLE' };
    }
    return { kind: 'INELIGIBLE' };
  }

  async requireEligibleForNewWork(id: string): Promise<void> {
    const eligibility = await this.checkEligibility(id);
    if (eligibility.kind === 'ELIGIBLE') {
      return;
    }
    if (eligibility.kind === 'UNAVAILABLE') {
      throw engineError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DRIVER_ELIGIBILITY_UNAVAILABLE',
        'Driver eligibility could not be confirmed. Try again shortly.',
      );
    }
    throw engineError(
      HttpStatus.FORBIDDEN,
      'DRIVER_NOT_ELIGIBLE',
      'This driver is not currently eligible for new trips.',
    );
  }

  /** True while the driver has a trip that is neither completed nor cancelled. */
  async hasActiveTrip(id: string): Promise<boolean> {
    const active = await this.prisma.engineTrip.findFirst({
      where: {
        driverSubject: id,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: { id: true },
    });
    return active !== null;
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
    const allowed = [
      '2 Wheeler',
      '3 Wheeler',
      '4 Wheeler',
      'Mini Truck',
      'Pickup Truck',
    ];
    if (!allowed.includes(vehicleType)) {
      throw new BadRequestException(
        `Invalid vehicle type. Allowed: ${allowed.join(', ')}`,
      );
    }
    const driver = this.findById(id);
    driver.vehicleType = vehicleType;
    driver.lastSeen = Date.now();
    return driver;
  }

  async findNearby(params: NearbySearchParams): Promise<NearbyDriverResult[]> {
    const { latitude, longitude, radiusKm, vehicleType } = params;
    const STALE_MS = 60_000; // 60 seconds - driver must have pinged in last 60s
    const now = Date.now();

    // 1. Filter Available Drivers that are also recently active
    let availableDrivers = this.drivers.filter(
      (d) => d.isAvailable && d.lastSeen && now - d.lastSeen < STALE_MS,
    );

    // 2. Filter by vehicleType if specified
    if (vehicleType) {
      availableDrivers = availableDrivers.filter(
        (d) => d.vehicleType.toLowerCase() === vehicleType.toLowerCase(),
      );
    }

    // A driver on a trip is never offered another booking, whatever the app says.
    if (availableDrivers.length > 0) {
      const busy = await this.prisma.engineTrip.findMany({
        where: {
          driverSubject: { in: availableDrivers.map((d) => d.id) },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        select: { driverSubject: true },
      });
      const busyIds = new Set(busy.map((trip) => trip.driverSubject));
      availableDrivers = availableDrivers.filter((d) => !busyIds.has(d.id));
    }

    // 2. Calculate Distance
    const driversWithDistance = availableDrivers.map((driver) => {
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
      (driver) => driver.distanceKm <= radiusKm,
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
    driver.rating =
      Math.round(
        ((currentRating * currentTotal + rating) / driver.totalRatings) * 10,
      ) / 10;
    return driver;
  }
}
