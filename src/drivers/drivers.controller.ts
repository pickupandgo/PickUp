import { Controller, Get, Post, Patch, Param, Body, Query, BadRequestException } from '@nestjs/common';
import { DriversService } from './drivers.service';

@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get()
  findAll() {
    return {
      success: true,
      drivers: this.driversService.findAll(),
    };
  }

  @Get('nearby')
  findNearby(
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

    const drivers = this.driversService.findNearby({
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
  findOne(@Param('id') id: string) {
    const driver = this.driversService.findById(id);
    return {
      success: true,
      driver,
    };
  }


  @Patch(':id/availability')
  updateAvailability(
    @Param('id') id: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    if (typeof isAvailable !== 'boolean') {
      throw new BadRequestException('isAvailable must be a boolean');
    }
    
    const driver = this.driversService.updateAvailability(id, isAvailable);
    return {
      success: true,
      driver: {
        id: driver.id,
        isAvailable: driver.isAvailable,
      },
    };
  }

  @Patch(':id/location')
  updateLocation(
    @Param('id') id: string,
    @Body('latitude') latitude: number,
    @Body('longitude') longitude: number,
  ) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
       throw new BadRequestException('Latitude and longitude must be numbers');
    }

    const driver = this.driversService.updateLocation(id, latitude, longitude);
    return {
      success: true,
      driver: {
        id: driver.id,
        latitude: driver.latitude,
        longitude: driver.longitude,
      },
    };
  }

  @Post(':id/rate')
  rateDriver(
    @Param('id') id: string,
    @Body('rating') rating: number,
  ) {
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
    @Param('id') id: string,
    @Body('vehicleType') vehicleType: string,
  ) {
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
