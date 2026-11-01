import {
  Injectable,
  BadRequestException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
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
import { DriverLocationStore } from './driver-location.store';
import { DriverFix, validateFix } from './location-policy';

export type DriverEligibilityResult =
  | { readonly kind: 'ELIGIBLE'; readonly vehicleCategory: string | null }
  | { readonly kind: 'INELIGIBLE' }
  | { readonly kind: 'UNAVAILABLE' };

/**
 * Dispatch presence/vehicle metadata remain local. Latest GPS is shared in PostgreSQL and
 * expires independently. Busy status comes from durable trips, including after a restart.
 */
@Injectable()
export class DriversService {
  private readonly previewSecret = randomBytes(32);
  private readonly previewBudgets = new Map<
    string,
    { start: number; requests: number }
  >();
  private drivers: Driver[] = [...MOCK_DRIVERS];
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backend: PaymentBackendClient,
    private readonly locations: DriverLocationStore,
  ) {}

  findAll(): Driver[] {
    return this.drivers;
  }

  findById(id: string): Driver {
    let driver = this.drivers.find((d) => d.id === id);
    if (!driver) {
      // Preserve legacy display metadata; dispatch eligibility/category comes from the backend.
      const vehicles = ['2 Wheeler', '3 Wheeler', 'Mini Truck', 'Pickup Truck'];
      const vehicleIndex = id.charCodeAt(id.length - 1) % vehicles.length;
      driver = {
        id,
        name: `Driver ${id.slice(-4)}`,
        vehicleType: vehicles[vehicleIndex],
        latitude: Number.NaN, // Internal metadata only; never returned as a GPS position.
        longitude: Number.NaN,
        isAvailable: false,
      };
      this.drivers.push(driver);
    }
    return driver;
  }

  async updateAvailability(id: string, isAvailable: boolean): Promise<Driver> {
    if (isAvailable) {
      await this.requireEligibleForNewWork(id);
      if (await this.hasActiveTrip(id)) {
        return this.setAvailability(id, false);
      }
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
      if (outcome.value.eligible && !outcome.value.vehicleCategory) {
        this.logger.error({
          alert: 'DRIVER_ELIGIBILITY_CONTRACT_INCOMPLETE',
          msg: 'Eligible driver has no verified vehicle category',
        });
        return { kind: 'UNAVAILABLE' };
      }
      if (outcome.value.eligible) {
        return {
          kind: 'ELIGIBLE',
          vehicleCategory: outcome.value.vehicleCategory,
        };
      }
      this.markUnavailable(id);
      return { kind: 'INELIGIBLE' };
    }

    // A refused identity lookup is not evidence of eligibility. A bad key, timeout, network
    // failure and an unreadable response are all unavailable and also fail closed.
    if (outcome.kind === 'UNAVAILABLE') {
      this.logger.error({
        alert: 'DRIVER_ELIGIBILITY_UNAVAILABLE',
        msg: 'The backend eligibility check failed closed',
        status: outcome.status,
        code: outcome.code,
      });
      return { kind: 'UNAVAILABLE' };
    }
    this.markUnavailable(id);
    return { kind: 'INELIGIBLE' };
  }

  async requireEligibleForNewWork(
    id: string,
    vehicleCategory?: string,
  ): Promise<void> {
    const eligibility = await this.checkEligibility(id);
    if (
      eligibility.kind === 'ELIGIBLE' &&
      (!vehicleCategory || eligibility.vehicleCategory === vehicleCategory)
    ) {
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

  async updateLocation(id: string, fix: DriverFix) {
    validateFix(fix);
    const trip = await this.prisma.engineTrip.findFirst({
      where: {
        driverSubject: id,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: { id: true },
    });
    if (fix.tripId && fix.tripId !== trip?.id) {
      throw engineError(
        HttpStatus.FORBIDDEN,
        'TRIP_ACCESS_DENIED',
        'Trip ownership could not be confirmed',
      );
    }
    // An assigned trip proves the driver's identity/ownership. New-work eligibility remains
    // mandatory outside a trip; expired KYC must not strand tracking of an existing trip.
    if (!trip) await this.requireEligibleForNewWork(id);
    if (trip) this.markUnavailable(id);
    const accepted = await this.locations.put(id, fix);
    return { id, accepted, capturedAt: fix.capturedAt };
  }

  async positionFor(id: string, viewer: string) {
    if (viewer !== id) {
      const allowed = await this.prisma.engineTrip.findFirst({
        where: {
          driverSubject: id,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          booking: { customerSubject: viewer },
        },
        select: { id: true },
      });
      if (!allowed)
        throw engineError(
          HttpStatus.FORBIDDEN,
          'LOCATION_ACCESS_DENIED',
          'Driver location is not accessible',
        );
    }
    const [position] = await this.locations.fresh(id);
    if (!position)
      throw engineError(
        HttpStatus.NOT_FOUND,
        'LOCATION_UNAVAILABLE',
        'A current driver position is unavailable',
      );
    const metadata = this.findById(id);
    return {
      ...metadata,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: position.accuracy,
      capturedAt: Number(position.capturedAt),
      receivedAt: position.receivedAt.toISOString(),
      lastSeen: Number(position.capturedAt),
      locationStatus: 'LIVE' as const,
    };
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

  /** Display-only snapshot. Never selects/assigns a driver or exposes their identity. */
  async previewNearby(viewer: string, params: NearbySearchParams) {
    const now = Date.now();
    for (const [key, budget] of this.previewBudgets) {
      if (now - budget.start >= 60_000) this.previewBudgets.delete(key);
    }
    let budget = this.previewBudgets.get(viewer);
    if (!budget) {
      if (this.previewBudgets.size >= 10_000)
        throw engineError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'PREVIEW_BUSY',
          'Vehicle preview is temporarily unavailable.',
        );
      budget = { start: now, requests: 0 };
      this.previewBudgets.set(viewer, budget);
    }
    if (++budget.requests > 12)
      throw engineError(
        HttpStatus.TOO_MANY_REQUESTS,
        'PREVIEW_RATE_LIMITED',
        'Please wait before refreshing nearby vehicles.',
      );
    const candidates = await this.findNearby({ ...params, preview: true });
    const [positions, trips] = await Promise.all([
      this.locations.fresh(),
      candidates.length
        ? this.prisma.engineTrip.findMany({
            where: {
              driverSubject: { in: candidates.map((driver) => driver.id) },
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
            },
            select: { driverSubject: true },
          })
        : Promise.resolve([]),
    ]);
    const fresh = new Map(
      positions.map((position) => [position.subject, position]),
    );
    const busy = new Set(trips.map((trip) => trip.driverSubject));
    const generatedAt = Date.now();
    const vehicles = candidates
      .flatMap((driver) => {
        const fix = fresh.get(driver.id);
        if (
          !fix ||
          busy.has(driver.id) ||
          !this.drivers.find((item) => item.id === driver.id)?.isAvailable ||
          generatedAt - Number(fix.capturedAt) > 60_000
        )
          return [];
        const distance = haversineDistance(
          params.latitude,
          params.longitude,
          fix.latitude,
          fix.longitude,
        );
        if (distance > params.radiusKm) return [];
        return [
          {
            key: createHmac('sha256', this.previewSecret)
              .update(viewer + '\0' + driver.id)
              .digest('hex')
              .slice(0, 20),
            latitude: Math.round(fix.latitude * 10_000) / 10_000,
            longitude: Math.round(fix.longitude * 10_000) / 10_000,
            vehicleCategory: params.vehicleCategory!,
            capturedAt: Number(fix.capturedAt),
            distance,
          },
        ];
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 30)
      .map((vehicle) => ({
        key: vehicle.key,
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
        vehicleCategory: vehicle.vehicleCategory,
        capturedAt: vehicle.capturedAt,
      }));
    return { generatedAt, vehicles };
  }

  async findNearby(params: NearbySearchParams): Promise<NearbyDriverResult[]> {
    const { latitude, longitude, radiusKm, vehicleType } = params;
    const STALE_MS = 60_000; // 60 seconds - driver must have pinged in last 60s
    const now = Date.now();

    // 1. Filter Available Drivers that are also recently active
    let availableDrivers = this.drivers.filter(
      (d) => d.isAvailable && d.lastSeen && now - d.lastSeen < STALE_MS,
    );
    const fresh = new Map(
      (await this.locations.fresh()).map((position) => [
        position.subject,
        position,
      ]),
    );
    availableDrivers = availableDrivers
      .filter((driver) => {
        if (fresh.has(driver.id)) return true;
        this.markUnavailable(driver.id);
        return false;
      })
      .map((driver) => {
        const position = fresh.get(driver.id)!;
        return {
          ...driver,
          latitude: position.latitude,
          longitude: position.longitude,
          lastSeen: Number(position.capturedAt),
        };
      });

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

    if (!params.vehicleCategory) return nearbyDrivers;
    if (params.preview) {
      const eligible: NearbyDriverResult[] = [];
      let unavailable = false;
      const deadline = Date.now() + 6_000;
      const candidates = nearbyDrivers.slice(0, 30);
      for (
        let index = 0;
        index < candidates.length && Date.now() < deadline;
        index += 4
      ) {
        const batch = candidates.slice(index, index + 4);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcomes = await Promise.race([
            Promise.all(
              batch.map((candidate) => this.checkEligibility(candidate.id)),
            ),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error('Preview deadline')),
                Math.max(1, deadline - Date.now()),
              );
            }),
          ]);
          outcomes.forEach((outcome, offset) => {
            if (outcome.kind === 'UNAVAILABLE') unavailable = true;
            if (
              outcome.kind === 'ELIGIBLE' &&
              outcome.vehicleCategory === params.vehicleCategory
            )
              eligible.push(batch[offset]);
          });
        } catch {
          unavailable = true;
          break;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      if (!eligible.length && (unavailable || Date.now() >= deadline))
        throw engineError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'DRIVER_ELIGIBILITY_UNAVAILABLE',
          'Nearby vehicles could not be verified.',
        );
      return eligible;
    }
    const verified: NearbyDriverResult[] = [];
    let unavailable = false;
    for (const candidate of nearbyDrivers) {
      const eligibility = await this.checkEligibility(candidate.id);
      if (eligibility.kind === 'UNAVAILABLE') unavailable = true;
      if (
        eligibility.kind === 'ELIGIBLE' &&
        eligibility.vehicleCategory === params.vehicleCategory
      ) {
        verified.push(candidate);
      }
    }
    if (!verified.length && unavailable)
      throw engineError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DRIVER_ELIGIBILITY_UNAVAILABLE',
        'Driver eligibility is temporarily unavailable.',
      );
    return verified;
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
