import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { RideRequest, CreateRideDto, RideLocation } from './rides.types';
import { DriversService } from '../drivers/drivers.service';
import { TripsService } from '../trips/trips.service';
import { FareService } from '../fare/fare.service';
import { haversineDistance } from '../utils/distance';

@Injectable()
export class RidesService {
  private rides: RideRequest[] = [];
  private rideCounter = 0;

  constructor(
    private readonly driversService: DriversService,
    private readonly tripsService: TripsService,
    private readonly fareService: FareService,
  ) {}

  private generateOtp(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  createRide(dto: CreateRideDto): RideRequest {
    // Validate required fields
    if (!dto.customerId) {
      throw new BadRequestException('customerId is required');
    }
    if (!dto.driverId) {
      throw new BadRequestException('driverId is required');
    }
    if (!dto.pickup || typeof dto.pickup.latitude !== 'number' || typeof dto.pickup.longitude !== 'number') {
      throw new BadRequestException('Valid pickup location is required');
    }

    // Normalize drops: accept either drops[] array or single drop
    let drops: RideLocation[] = [];
    if (dto.drops && dto.drops.length > 0) {
      drops = dto.drops;
    } else if (dto.drop && typeof dto.drop.latitude === 'number' && typeof dto.drop.longitude === 'number') {
      drops = [dto.drop];
    } else {
      throw new BadRequestException('At least one valid drop location is required (use drops[] or drop)');
    }

    // Validate max 5 drops
    if (drops.length > 5) {
      throw new BadRequestException('Maximum 5 drop locations allowed per ride');
    }

    // Validate each drop
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d || typeof d.latitude !== 'number' || typeof d.longitude !== 'number') {
        throw new BadRequestException(`Invalid drop location at index ${i}`);
      }
    }

    // Verify driver exists and is available
    const driver = this.driversService.findById(dto.driverId);
    if (!driver.isAvailable) {
      throw new BadRequestException('Driver is no longer available.');
    }

    // Calculate multi-leg fare
    const weightKg = dto.weight || 10;
    const fareEstimate = this.fareService.estimateMultiDrop(dto.pickup, drops, weightKg, dto.vehicleType);
    const fare = dto.fare || fareEstimate.fare;

    const otp = this.generateOtp();  // pickup OTP
    // Per-stop OTPs
    const stopOtps = drops.map(() => this.generateOtp());

    this.rideCounter++;
    const now = new Date().toISOString();

    const ride: RideRequest = {
      id: `R${this.rideCounter}`,
      customerId: dto.customerId,
      pickup: dto.pickup,
      drop: drops[0],         // backward compat: first drop
      drops,                  // all drops in order
      vehicleType: dto.vehicleType,
      weight: weightKg,
      fare,
      totalDistanceKm: fareEstimate.distanceKm,
      legs: fareEstimate.legs,
      otp,
      stopOtps,
      status: 'REQUESTED',
      requestedDriverId: dto.driverId,
      createdAt: now,
      updatedAt: now,
    };

    this.rides.push(ride);

    // ── Auto-reject timer: 30 seconds ──
    // If driver doesn't accept/reject within 30 sec → auto-reject
    setTimeout(() => {
      if (ride.status === 'REQUESTED') {
        ride.status = 'REJECTED';
        ride.updatedAt = new Date().toISOString();
      }
    }, 30_000);

    return ride;
  }

  findById(rideId: string): RideRequest {
    const ride = this.rides.find((r) => r.id === rideId);
    if (!ride) {
      throw new NotFoundException(`Ride with ID ${rideId} not found`);
    }
    return ride;
  }

  getTripForRide(rideId: string) {
    return this.tripsService.getTripByRideId(rideId);
  }

  findPendingForDriver(driverId: string): RideRequest[] {
    // Refresh driver heartbeat
    const driver = this.driversService.findById(driverId);
    driver.lastSeen = Date.now();

    const RIDE_EXPIRY_MS = 15_000;
    const now = Date.now();

    const pending = this.rides.filter(
      (r) => r.requestedDriverId === driverId && r.status === 'REQUESTED',
    );

    // Auto-expire rides older than 15 seconds
    for (const ride of pending) {
      const age = now - new Date(ride.createdAt).getTime();
      if (age > RIDE_EXPIRY_MS) {
        ride.status = 'CANCELLED';
        ride.updatedAt = new Date().toISOString();
      }
    }

    const valid = pending
      .filter((r) => r.status === 'REQUESTED')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return valid.length > 0 ? [valid[0]] : [];
  }

  cancelRide(rideId: string): RideRequest {
    const ride = this.findById(rideId);

    if (ride.status !== 'REQUESTED') {
      throw new ConflictException(
        `Ride is already ${ride.status}. Cannot cancel.`,
      );
    }

    ride.status = 'CANCELLED';
    ride.updatedAt = new Date().toISOString();

    return ride;
  }

  acceptRide(rideId: string, driverId: string): RideRequest {
    const ride = this.findById(rideId);

    if (ride.status !== 'REQUESTED') {
      throw new ConflictException(
        `Ride is already ${ride.status}. Cannot accept.`,
      );
    }

    if (ride.requestedDriverId !== driverId) {
      throw new BadRequestException(
        'You are not the requested driver for this ride.',
      );
    }

    const driver = this.driversService.findById(driverId);
    if (!driver.isAvailable) {
      throw new ConflictException('Driver is no longer available.');
    }

    ride.status = 'ACCEPTED';
    ride.assignedDriverId = driverId;
    ride.updatedAt = new Date().toISOString();

    // Mark driver as unavailable (busy)
    this.driversService.updateAvailability(driverId, false);

    // Create the trip (with multi-drop stops)
    this.tripsService.createTrip(ride);

    return ride;
  }

  rejectRide(rideId: string, driverId: string): RideRequest {
    const ride = this.findById(rideId);

    if (ride.status !== 'REQUESTED') {
      throw new ConflictException(
        `Ride is already ${ride.status}. Cannot reject.`,
      );
    }

    if (ride.requestedDriverId !== driverId) {
      throw new BadRequestException(
        'You are not the requested driver for this ride.',
      );
    }

    ride.status = 'REJECTED';
    ride.updatedAt = new Date().toISOString();

    return ride;
  }

  verifyOtp(rideId: string, otp: string): { valid: boolean } {
    const ride = this.findById(rideId);
    return { valid: ride.otp === otp };
  }
}
