import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentPrincipal, DriverOnly } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import {
  CreateDocumentRequest,
  CreateVehicleRequest,
  ReplacementVehicleRequest,
  UpdateDriverProfileRequest,
} from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

@Controller({ path: 'drivers/me/onboarding', version: '1' })
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}
  @Get() @DriverOnly() summary(@CurrentPrincipal() principal: Principal) {
    return this.onboarding.summary(principal);
  }
  @Patch('profile') @DriverOnly() profile(
    @CurrentPrincipal() principal: Principal,
    @Body() body: UpdateDriverProfileRequest,
  ) {
    return this.onboarding.updateProfile(principal, body.name);
  }
  @Post('kyc') @DriverOnly() startKyc(@CurrentPrincipal() principal: Principal) {
    return this.onboarding.startKyc(principal);
  }
  @Post('kyc/:applicationId/submit') @DriverOnly() submitKyc(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ) {
    return this.onboarding.submitKyc(principal, applicationId);
  }
  @Post('kyc/:applicationId/documents') @DriverOnly() initiateKycDocument(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: CreateDocumentRequest,
  ) {
    return this.onboarding.initiateKycDocument(principal, applicationId, body);
  }
  @Post('kyc/:applicationId/documents/:documentId/complete') @DriverOnly() completeKycDocument(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.onboarding.completeKycDocument(principal, applicationId, documentId);
  }
  @Post('vehicles') @DriverOnly() createVehicle(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateVehicleRequest,
  ) {
    return this.onboarding.createVehicle(principal, body);
  }
  @Patch('vehicles/:vehicleId') @DriverOnly() updateVehicle(
    @CurrentPrincipal() principal: Principal,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() body: CreateVehicleRequest,
  ) {
    return this.onboarding.updateVehicle(principal, vehicleId, body);
  }
  @Post('vehicles/:vehicleId/submit') @DriverOnly() submitVehicle(
    @CurrentPrincipal() principal: Principal,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.onboarding.submitVehicle(principal, vehicleId);
  }
  @Post('vehicles/:vehicleId/documents') @DriverOnly() initiateVehicleDocument(
    @CurrentPrincipal() principal: Principal,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() body: CreateDocumentRequest,
  ) {
    return this.onboarding.initiateVehicleDocument(principal, vehicleId, body);
  }
  @Post('vehicles/:vehicleId/documents/:documentId/complete') @DriverOnly() completeVehicleDocument(
    @CurrentPrincipal() principal: Principal,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.onboarding.completeVehicleDocument(principal, vehicleId, documentId);
  }
  @Post('vehicle-replacements') @DriverOnly() replaceVehicle(
    @CurrentPrincipal() principal: Principal,
    @Body() body: ReplacementVehicleRequest,
  ) {
    return this.onboarding.requestReplacement(principal, body);
  }
}
