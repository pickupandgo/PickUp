import { Controller, Get, Post, Query, Body, BadRequestException } from '@nestjs/common';
import { FareService } from './fare.service';

@Controller('fare')
export class FareController {
  constructor(private readonly fareService: FareService) {}

  // Legacy single-drop fare estimate (GET)
  @Get('estimate')
  estimate(
    @Query('pickupLat') pickupLat: string,
    @Query('pickupLng') pickupLng: string,
    @Query('dropLat') dropLat: string,
    @Query('dropLng') dropLng: string,
    @Query('weight') weight: string,
    @Query('vehicleType') vehicleType?: string,
  ) {
    const pLat = parseFloat(pickupLat);
    const pLng = parseFloat(pickupLng);
    const dLat = parseFloat(dropLat);
    const dLng = parseFloat(dropLng);
    const weightKg = weight ? parseFloat(weight) : 10;

    if (isNaN(pLat) || isNaN(pLng) || isNaN(dLat) || isNaN(dLng)) {
      throw new BadRequestException('Valid pickup and drop coordinates are required');
    }

    const result = this.fareService.estimate(pLat, pLng, dLat, dLng, weightKg, vehicleType);
    return { success: true, ...result };
  }

  // Multi-drop fare estimate (POST)
  @Post('estimate-multi')
  estimateMultiDrop(
    @Body('pickup') pickup: { latitude: number; longitude: number; address?: string },
    @Body('drops') drops: { latitude: number; longitude: number; address?: string }[],
    @Body('weight') weight?: number,
    @Body('vehicleType') vehicleType?: string,
  ) {
    if (!pickup || typeof pickup.latitude !== 'number' || typeof pickup.longitude !== 'number') {
      throw new BadRequestException('Valid pickup location is required');
    }
    if (!drops || !Array.isArray(drops) || drops.length === 0) {
      throw new BadRequestException('At least one drop location is required');
    }
    if (drops.length > 5) {
      throw new BadRequestException('Maximum 5 drop locations allowed');
    }

    const weightKg = weight || 10;
    const result = this.fareService.estimateMultiDrop(pickup, drops, weightKg, vehicleType);
    return { success: true, ...result };
  }
}
