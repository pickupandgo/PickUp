import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { RidesService } from './rides.service';
import { CreateRideDto } from './rides.types';

@Controller()
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @Post('rides')
  createRide(@Body() dto: CreateRideDto) {
    const ride = this.ridesService.createRide(dto);
    return {
      success: true,
      ride: {
        id: ride.id,
        status: ride.status,
        requestedDriverId: ride.requestedDriverId,
        fare: ride.fare,
        weight: ride.weight,
        otp: ride.otp,          // pickup OTP
        drops: ride.drops,      // all drop locations
        stopOtps: ride.stopOtps, // per-stop OTPs (customer sees these)
      },
    };
  }

  @Get('rides/:rideId')
  getRideStatus(@Param('rideId') rideId: string) {
    const ride = this.ridesService.findById(rideId);
    return {
      success: true,
      ride: {
        id: ride.id,
        status: ride.status,
        assignedDriverId: ride.assignedDriverId,
        requestedDriverId: ride.requestedDriverId,
        fare: ride.fare,
        weight: ride.weight,
        otp: ride.otp,
        pickup: ride.pickup,
        drop: ride.drop,
        drops: ride.drops,
        stopOtps: ride.stopOtps,
        vehicleType: ride.vehicleType,
      },
    };
  }

  @Get('rides/:rideId/trip')
  getRideTrip(@Param('rideId') rideId: string) {
    const trip = this.ridesService.getTripForRide(rideId);
    return { success: true, trip };
  }

  @Get('ride-requests/:driverId')
  getPendingRequests(@Param('driverId') driverId: string) {
    const requests = this.ridesService.findPendingForDriver(driverId);
    return {
      success: true,
      requests: requests.map((r) => ({
        rideId: r.id,
        customerId: r.customerId,
        pickup: r.pickup,
        drop: r.drop,
        drops: r.drops,       // all drops for driver
        vehicleType: r.vehicleType,
        weight: r.weight,
        fare: r.fare,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

  @Post('rides/:rideId/accept')
  acceptRide(
    @Param('rideId') rideId: string,
    @Body('driverId') driverId: string,
  ) {
    if (!driverId) {
      throw new BadRequestException('driverId is required');
    }

    const ride = this.ridesService.acceptRide(rideId, driverId);
    return {
      success: true,
      ride: {
        id: ride.id,
        status: ride.status,
        assignedDriverId: ride.assignedDriverId,
        fare: ride.fare,
        weight: ride.weight,
        pickup: ride.pickup,
        drop: ride.drop,
        drops: ride.drops,
        // Driver does NOT get OTPs - they receive them verbally at each stop
      },
    };
  }

  @Post('rides/:rideId/cancel')
  cancelRide(@Param('rideId') rideId: string) {
    const ride = this.ridesService.cancelRide(rideId);
    return {
      success: true,
      ride: { id: ride.id, status: ride.status },
    };
  }

  @Post('rides/:rideId/reject')
  rejectRide(
    @Param('rideId') rideId: string,
    @Body('driverId') driverId: string,
  ) {
    if (!driverId) {
      throw new BadRequestException('driverId is required');
    }

    const ride = this.ridesService.rejectRide(rideId, driverId);
    return {
      success: true,
      ride: { id: ride.id, status: ride.status },
    };
  }

  @Post('rides/:rideId/verify-otp')
  verifyOtp(
    @Param('rideId') rideId: string,
    @Body('otp') otp: string,
  ) {
    if (!otp) {
      throw new BadRequestException('otp is required');
    }
    const result = this.ridesService.verifyOtp(rideId, otp);
    return { success: true, valid: result.valid };
  }
}
