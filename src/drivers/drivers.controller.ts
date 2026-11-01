import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Header,
  BadRequestException,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import { CurrentSubject } from '../auth/decorators';
import { assertSameIdentity } from '../auth/identity';
import type { DriverFix } from './location-policy';

/**
 * Every route needs a verified Firebase token (global guard). A driver changes only their own
 * presence: the :id in the path must be the signed-in driver.
 */
@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get()
  async findAll(@CurrentSubject() subject: string) {
    return {
      success: true,
      drivers: [await this.driversService.positionFor(subject, subject)],
    };
  }

  @Get('preview')
  @Header('Cache-Control', 'no-store')
  async preview(
    @CurrentSubject() subject: string,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('vehicleCategory') vehicleCategory: string,
    @Query('radius') radius?: string,
  ) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusKm = radius === undefined ? 5 : Number(radius);
    if (
      !lat?.trim() ||
      !lng?.trim() ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      throw new BadRequestException('Valid latitude and longitude required');
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 10)
      throw new BadRequestException('Radius must be between 0 and 10 km');
    if (
      !['TWO_WHEELER', 'THREE_WHEELER', 'MINI_TRUCK', 'PICKUP_TRUCK'].includes(
        vehicleCategory,
      )
    )
      throw new BadRequestException('Supported vehicle category required');
    return {
      success: true,
      ...(await this.driversService.previewNearby(subject, {
        latitude,
        longitude,
        radiusKm,
        vehicleCategory,
      })),
    };
  }

  @Get('nearby')
  async findNearby(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius: string,
    @Query('vehicleType') vehicleType?: string,
  ) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusKm = radius ? parseFloat(radius) : 20; // Default 20km

    if (isNaN(latitude) || latitude < -90 || latitude > 90) {
      throw new BadRequestException('Invalid latitude');
    }
    if (isNaN(longitude) || longitude < -180 || longitude > 180) {
      throw new BadRequestException('Invalid longitude');
    }
    if (isNaN(radiusKm) || radiusKm <= 0) {
      throw new BadRequestException('Invalid radius');
    }

    const drivers = await this.driversService.findNearby({
      latitude,
      longitude,
      radiusKm,
      vehicleType,
    });

    return {
      success: true,
      search: { latitude, longitude, radiusKm, vehicleType },
      drivers,
    };
  }

  @Get(':id')
  async findOne(@CurrentSubject() subject: string, @Param('id') id: string) {
    const driver = await this.driversService.positionFor(id, subject);
    return {
      success: true,
      driver,
    };
  }

  @Patch(':id/availability')
  async updateAvailability(
    @CurrentSubject() subject: string,
    @Param('id') id: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    assertSameIdentity(subject, id, 'id');
    if (typeof isAvailable !== 'boolean') {
      throw new BadRequestException('isAvailable must be a boolean');
    }

    const driver = await this.driversService.updateAvailability(
      id,
      isAvailable,
    );
    return {
      success: true,
      driver: {
        id: driver.id,
        isAvailable: driver.isAvailable,
      },
    };
  }

  @Patch(':id/location')
  async updateLocation(
    @CurrentSubject() subject: string,
    @Param('id') id: string,
    @Body() fix: DriverFix,
  ) {
    assertSameIdentity(subject, id, 'id');
    const driver = await this.driversService.updateLocation(id, fix);
    return {
      success: true,
      driver,
    };
  }

  @Post(':id/rate')
  rateDriver(@Param('id') id: string, @Body('rating') rating: number) {
    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be a number between 1 and 5');
    }
    const driver = this.driversService.rateDriver(id, rating);
    return {
      success: true,
      rating: driver.rating,
      totalRatings: driver.totalRatings,
    };
  }

  @Patch(':id/vehicle')
  updateVehicle(
    @CurrentSubject() subject: string,
    @Param('id') id: string,
    @Body('vehicleType') vehicleType: string,
  ) {
    assertSameIdentity(subject, id, 'id');
    if (!vehicleType) {
      throw new BadRequestException('vehicleType is required');
    }
    const driver = this.driversService.updateVehicleType(id, vehicleType);
    return {
      success: true,
      driver: {
        id: driver.id,
        vehicleType: driver.vehicleType,
      },
    };
  }
}
