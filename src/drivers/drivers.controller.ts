import { Body, Controller, Get, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentIdentity, CurrentPrincipal, DriverOnly, SignedIn } from '../auth/decorators';
import type { Principal, SignedInIdentity } from '../auth/principal';
import { DriverAccountResponse, RegisterDriverRequest } from './drivers.dto';
import { DriversService } from './drivers.service';

/** The signed-in driver's own account and registration. */
@ApiTags('drivers')
@Controller({ path: 'drivers', version: '1' })
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  /**
   * Registers the signed-in driver, or returns the existing account (201 when created, 200
   * when it already existed).
   */
  @Post('me')
  @SignedIn()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(
    @CurrentIdentity() identity: SignedInIdentity,
    @Body() body: RegisterDriverRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DriverAccountResponse> {
    const { account, created } = await this.drivers.register(identity, {
      legalName: body?.name,
      vehicleType: body?.vehicleType,
      vehicleMakeModel: body?.vehicleMakeModel,
      vehicleRegistrationNumber: body?.vehicleRegistrationNumber,
      drivingLicenseNumber: body?.drivingLicenseNumber,
    });
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return account;
  }

  @Post('register')
  @SignedIn()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async registerAlias(
    @CurrentIdentity() identity: SignedInIdentity,
    @Body() body: RegisterDriverRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DriverAccountResponse> {
    return this.register(identity, body, response);
  }

  @Get('me')
  @DriverOnly()
  get(@CurrentPrincipal() principal: Principal): Promise<DriverAccountResponse> {
    return this.drivers.get(principal);
  }
}
